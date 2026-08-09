// The wave walk of one stack: sandbox lifecycle, prune logic, and the
// serial restack of each finished wave. Every effect goes through the
// WalkEffects boundary, so the walk is a state machine over data
// (ADR 0029). Across runs the walk remembers nothing but the PR ledger
// (ADR 0034). Pipeline: .sandcastle/docs/pipeline.md.

import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { ChildFailure, runCaptured } from "./exec.ts";
import { stackRule, say, sayError, type StackTag } from "./render.ts";
import {
  branchCarries,
  deleteStaleBranch,
  fetchOrigin,
  gateBranchAncestry,
  originBranchExists,
  pushBranch,
  resolveOriginTip,
  restackBranch,
  type BranchGate,
  type ConflictResolution,
  type RestackOutcome,
} from "./restack.ts";
import { pruneClosure, waveLevels, type StackStep } from "./stack.ts";

// Runs inside the sandbox before each agent iteration; npm install
// keeps the sandbox's dependencies fresh.
const hooks = {
  sandbox: { onSandboxReady: [{ command: "npm install" }] },
};

// Seed each sandbox worktree with the host's node_modules; the hook
// above trues up platform binaries and newly added packages.
const copyToWorktree = ["node_modules"];

// One global pool across all stacks: the binding resource (containers,
// paid agents) is machine- and budget-wide (ADR 0018).
export const MAX_SANDBOXES = 3;

// The library's 600 s default reads long tool calls as hangs, and its
// suggested --idle-timeout flag does not exist in v0.12.0.
const IDLE_TIMEOUT_SECONDS = 1800;

// Live sandbox handles, for main.ts's SIGINT close. Containers carry no
// issue number, so only these handles can close them (#170).
export const liveSandboxes = new Set<{ close(): Promise<unknown> }>();

// Counting semaphore: `use` waits for a slot, runs the thunk, frees
// the slot. Waiters resume in FIFO order. One slot makes it a mutex.
export class Semaphore {
  #free: number;
  readonly #waiters: (() => void)[] = [];

  constructor(slots: number) {
    this.#free = slots;
  }

  async use<T>(fn: () => T | Promise<T>): Promise<T> {
    if (this.#free > 0) {
      this.#free -= 1;
    } else {
      await new Promise<void>((resolve) => this.#waiters.push(resolve));
    }
    try {
      return await fn();
    } finally {
      const next = this.#waiters.shift();
      if (next === undefined) {
        this.#free += 1;
      } else {
        next();
      }
    }
  }
}

/** One PR whose head is a step's branch — an entry in its PR ledger. */
export interface LedgerPr {
  readonly state: "OPEN" | "MERGED" | "CLOSED";
  readonly url: string;
  /** ISO creation time — recency decides when nothing is open. */
  readonly createdAt: string;
}

type LedgerVerdict =
  | { readonly kind: "open"; readonly url: string }
  | { readonly kind: "merged"; readonly url: string }
  | { readonly kind: "stale"; readonly why: string }
  | { readonly kind: "fresh" };

// The resume verdict (ADR 0034): an open PR wins; otherwise the newest
// PR decides — merged is complete, closed is rejected. With no PRs the
// branch is stale (dead-run leftovers) or fresh; contents never count.
function ledgerVerdict(
  ledger: readonly LedgerPr[],
  branchExists: boolean,
): LedgerVerdict {
  const open = ledger.find((pr) => pr.state === "OPEN");
  if (open !== undefined) return { kind: "open", url: open.url };
  const newest = [...ledger].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )[0];
  if (newest?.state === "MERGED") return { kind: "merged", url: newest.url };
  if (newest !== undefined) {
    return {
      kind: "stale",
      why: `its newest PR ${newest.url} was closed without merging`,
    };
  }
  if (branchExists) return { kind: "stale", why: "it has commits but no PR" };
  return { kind: "fresh" };
}

/** URL of the branch's open PR, if any — the completion marker. */
function openPrUrl(
  effects: WalkEffects,
  branch: string,
): string | undefined {
  return effects.prLedger(branch).find((pr) => pr.state === "OPEN")?.url;
}

/** What the implement effect left behind. */
export interface SandboxBuild {
  /** Commits the implementer produced on the step's branch this run. */
  readonly commitCount: number;
  /** Implementer stdout — carries the missing-dependency and pr-body markers. */
  readonly stdout: string;
}

// The implementer emits the PR body between <pr-body> markers; the
// host guarantees the closing keyword, so merging closes the issue.
function draftPrBody(stdout: string, issueNumber: number): string {
  const body =
    /<pr-body>([\s\S]*?)<\/pr-body>/.exec(stdout)?.[1]?.trim() ?? "";
  const closes = `Closes #${issueNumber}`;
  if (body === "") return closes;
  return body.startsWith(closes) ? body : `${closes}\n\n${body}`;
}

// The walk's entire outward surface (ADR 0029): specs run the walk
// against fakes and assert on its decisions. The restack methods close
// over the worktree, so "restacking owns git" stays structural.
// Methods throw on failure exactly where the production commands would.
export interface WalkEffects {
  /** Every PR whose head is the branch, any state — the step's ledger. */
  prLedger(branch: string): LedgerPr[];
  /** Whether origin/<branch> exists — stale debris vs a fresh build. */
  originBranchExists(branch: string): boolean;
  /** Delete the branch's origin ref and any local ref (restack-owned). */
  deleteStaleBranch(branch: string): void;
  /** Close the issue with a comment naming the merged PR. */
  closeIssueWithComment(issueNumber: number, comment: string): void;
  /** Bind the PR urls into a GitHub stack, bottom-to-top. */
  linkPrStack(urls: readonly string[]): void;
  /** Current base of the branch's open PR; undefined when unreadable. */
  prBase(branch: string): string | undefined;
  /** Retarget the branch's PR onto a new base branch. */
  retargetPrBase(branch: string, base: string): void;
  /** Run the implementer on the step's branch in its own sandbox, cut from `waveBase`. */
  implementInSandbox(step: StackStep, waveBase: string): Promise<SandboxBuild>;
  /** Run the reviewer over the branch's diff from `waveBase`, in its own sandbox. */
  reviewInSandbox(step: StackStep, waveBase: string): Promise<void>;
  /** Push the branch's local ref to origin (restack-owned). */
  pushBranch(branch: string): void;
  /** Open the step's draft PR — the completion marker. Returns its URL. */
  createDraftPr(
    branch: string,
    base: string,
    title: string,
    body: string,
  ): string;
  fetchOrigin(): void;
  resolveOriginTip(branch: string): string;
  gateBranchAncestry(branch: string, baseSha: string): BranchGate;
  restackBranch(
    branch: string,
    tipName: string,
    tipSha: string,
    windowSha: string,
  ): Promise<RestackOutcome>;
  branchCarries(outer: string, inner: string): boolean;
}

// One agent run in the step's own sandbox: create, run, always close.
// baseBranch cuts the branch from the wave's base; the library ignores
// it when the branch exists, so a re-run resumes.
async function runInStepSandbox<T>(
  step: StackStep,
  waveBase: string,
  run: (
    sandbox: Awaited<ReturnType<typeof sandcastle.createSandbox>>,
  ) => Promise<T>,
): Promise<T> {
  const sandbox = await sandcastle.createSandbox({
    branch: step.branch,
    baseBranch: waveBase,
    sandbox: docker(),
    hooks,
    copyToWorktree,
  });
  liveSandboxes.add(sandbox);
  try {
    return await run(sandbox);
  } finally {
    liveSandboxes.delete(sandbox);
    await sandbox.close();
  }
}

// The real wiring: gh on PATH, docker sandboxes, the restack module
// against the run's shared worktree. Adapters stay thin (ADR 0029).
export function productionWalkEffects(worktree: string): WalkEffects {
  return {
    // One query returns the whole ledger. gh reports state uppercase,
    // matching LedgerPr.
    prLedger(branch) {
      return JSON.parse(
        runCaptured("gh", [
          "pr",
          "list",
          "--head",
          branch,
          "--state",
          "all",
          "--json",
          "state,url,createdAt",
        ]),
      ) as LedgerPr[];
    },
    originBranchExists: (branch) => originBranchExists(worktree, branch),
    deleteStaleBranch: (branch) => deleteStaleBranch(worktree, branch),
    closeIssueWithComment(issueNumber, comment) {
      runCaptured("gh", [
        "issue",
        "close",
        String(issueNumber),
        "--comment",
        comment,
      ]);
    },
    linkPrStack(urls) {
      // gh's own chatter is captured; the walk reports the result.
      runCaptured("gh", ["stack", "link", ...urls]);
    },
    prBase(branch) {
      try {
        const pr = JSON.parse(
          runCaptured("gh", ["pr", "view", branch, "--json", "baseRefName"]),
        ) as { baseRefName: string };
        return pr.baseRefName;
      } catch {
        return undefined;
      }
    },
    retargetPrBase(branch, base) {
      runCaptured("gh", ["pr", "edit", branch, "--base", base]);
    },
    implementInSandbox(step, waveBase) {
      return runInStepSandbox(step, waveBase, async (sandbox) => {
        const implement = await sandbox.run({
          name: `implementer #${step.issue.number}`,
          maxIterations: 100,
          idleTimeoutSeconds: IDLE_TIMEOUT_SECONDS,
          agent: sandcastle.claudeCode("claude-opus-5"),
          promptFile: "./.sandcastle/prompts/implement-prompt.md",
          promptArgs: {
            ISSUE_NUMBER: String(step.issue.number),
            ISSUE_TITLE: step.issue.title,
            BRANCH: step.branch,
            BASE_BRANCH: waveBase,
          },
        });
        return {
          commitCount: implement.commits.length,
          stdout: implement.stdout,
        };
      });
    },
    async reviewInSandbox(step, waveBase) {
      // The branch exists by now, so the sandbox re-enters it with the
      // implementer's synced commits.
      await runInStepSandbox(step, waveBase, (sandbox) =>
        sandbox.run({
          name: `reviewer #${step.issue.number}`,
          maxIterations: 1,
          idleTimeoutSeconds: IDLE_TIMEOUT_SECONDS,
          agent: sandcastle.claudeCode("claude-opus-5"),
          promptFile: "./.sandcastle/prompts/review-prompt.md",
          promptArgs: {
            BRANCH: step.branch,
            BASE_BRANCH: waveBase,
          },
        }),
      );
    },
    pushBranch: (branch) => pushBranch(worktree, branch),
    createDraftPr(branch, base, title, body) {
      return runCaptured("gh", [
        "pr",
        "create",
        "--draft",
        "--head",
        branch,
        "--base",
        base,
        "--title",
        title,
        "--body",
        body,
      ]).trim();
    },
    fetchOrigin: () => fetchOrigin(worktree),
    resolveOriginTip: (branch) => resolveOriginTip(worktree, branch),
    gateBranchAncestry: (branch, baseSha) =>
      gateBranchAncestry(worktree, branch, baseSha),
    restackBranch: (branch, tipName, tipSha, windowSha) =>
      restackBranch(worktree, branch, tipName, tipSha, windowSha),
    branchCarries: (outer, inner) => branchCarries(worktree, outer, inner),
  };
}

// Bind a chain's open PRs into a GitHub stack, bottom-to-top. `gh
// stack link` refuses partial updates, so every call passes the full
// chained membership. Returns false instead of throwing: a failed link
// never stops a walk.
export function linkChainedPrs(
  effects: WalkEffects,
  chained: readonly StackStep[],
  what: string,
  tag?: StackTag,
): boolean {
  if (chained.length < 2) return true;
  try {
    const urls = chained.map((step) => {
      const url = openPrUrl(effects, step.branch);
      if (url === undefined) throw new Error(`no open PR on ${step.branch}`);
      return url;
    });
    effects.linkPrStack(urls);
    say(`✓ ${what}: ${urls.length} PRs linked on GitHub.`, {
      role: "success",
      tag,
    });
    return true;
  } catch (error) {
    const stderr = error instanceof ChildFailure ? error.stderr.trim() : "";
    sayError(
      `⚠ ${what}: gh stack link failed — ` +
        `${stderr !== "" ? stderr : error instanceof Error ? error.message : String(error)}. ` +
        `Re-run \`npm run sandcastle\` to re-link, or link by hand ` +
        `with gh stack link <bottom PR> … <top PR>.`,
      { role: "warn", tag },
    );
    return false;
  }
}

interface PrunedStep {
  readonly step: StackStep;
  readonly reason: string;
}

export interface ResolvedStep {
  readonly step: StackStep;
  /** What finished the conflicted rebase: recorded rerere hunks or the agent. */
  readonly via: ConflictResolution;
}

/** One local branch ref the run moved to follow a force-push. */
export interface LocalRefMove {
  readonly branch: string;
  readonly from: string;
  readonly to: string;
}

export interface StackOutcome {
  readonly stack: readonly StackStep[];
  /** Steps whose branch ended up on the final chain. */
  readonly chained: readonly StackStep[];
  /** Chained steps that skipped their sandbox (already had an open PR). */
  readonly skipped: readonly StackStep[];
  /** Steps skipped because their newest PR is merged — issue auto-closed. */
  readonly skippedMerged: readonly StackStep[];
  /** Chained steps whose stale branch was deleted and rebuilt fresh. */
  readonly staleRebuilt: readonly StackStep[];
  /** Chained steps whose rebase conflict rerere or the resolver fixed. */
  readonly resolved: readonly ResolvedStep[];
  /** Steps whose build produced no commits — spliced, not failed (ADR 0039). */
  readonly noops: readonly StackStep[];
  readonly pruned: readonly PrunedStep[];
  /** Branches left with commits but no PR — warned, not pruned. */
  readonly missingPrs: readonly string[];
  /** Every local-ref move this stack made, for the run-summary audit. */
  readonly localRefMoves: readonly LocalRefMove[];
}

/**
 * True when the run needs no resume: nothing pruned, every built branch
 * has its PR, every stack linked. No-op skips never count against it.
 */
export function runSucceeded(
  outcomes: readonly StackOutcome[],
  linkFailureCount: number,
): boolean {
  return (
    linkFailureCount === 0 &&
    outcomes.every((o) => o.pruned.length === 0 && o.missingPrs.length === 0)
  );
}

// Run-wide shared state: one sandbox pool, one lock serializing the
// shared restack worktree (one HEAD, one index), the effects boundary.
export interface WalkContext {
  /** How many stacks this run launched — labels progress lines only. */
  readonly stackCount: number;
  readonly sandboxPool: Semaphore;
  readonly restackLock: Semaphore;
  readonly effects: WalkEffects;
}

export async function runStack(
  stack: readonly StackStep[],
  stackIndex: number,
  ctx: WalkContext,
): Promise<StackOutcome> {
  const label = `stack ${stackIndex + 1}/${ctx.stackCount}`;
  // [S2] for stack-level lines, [S2·#139] for step lines (ADR 0032).
  const tag: StackTag = { stack: stackIndex + 1 };
  const stepTag = (step: StackStep): StackTag => ({
    ...tag,
    issue: step.issue.number,
  });
  stackRule(`Starting ${label}: ${stack.length} step(s)`, { tag });

  const levels = waveLevels(stack);
  const skipped: StackStep[] = [];
  const skippedMerged: StackStep[] = [];
  const staleRebuilt: StackStep[] = [];
  const resolved: ResolvedStep[] = [];
  const noops: StackStep[] = [];
  const missingPrs: string[] = [];
  const localRefMoves: LocalRefMove[] = [];
  const pruned = new Map<number, string>();
  // Steps in chain-join order — the membership each per-wave link
  // passes to `gh stack link`.
  const chainedSoFar: StackStep[] = [];

  // A prune removes the step and its dependency-descendants; each
  // descendant records why, so the summary reads whole.
  const prune = (step: StackStep, reason: string): void => {
    const closure = pruneClosure(stack, [step.issue.number]);
    const descendants: number[] = [];
    for (const n of closure) {
      if (pruned.has(n)) continue;
      if (n === step.issue.number) {
        pruned.set(n, reason);
      } else {
        pruned.set(n, `depends on pruned #${step.issue.number}`);
        descendants.push(n);
      }
    }
    sayError(
      `✗ #${step.issue.number} pruned — ${reason}.` +
        (descendants.length === 0
          ? ""
          : ` Its dependents ${descendants.map((n) => `#${n}`).join(", ")} ` +
            `are pruned with it.`) +
        ` Issues that never depended on it keep building.`,
      { role: "fail", tag: stepTag(step) },
    );
  };

  // Build one wave member in its own sandbox. Never throws: a crashed
  // agent or sandbox reads as a failure result, which the post-wave
  // pass turns into a prune; siblings and other stacks keep running.
  const buildStep = async (
    step: StackStep,
    waveBase: string,
    waveBaseSha: string,
    depth: number,
  ): Promise<{
    readonly failure?: string;
    readonly disposition:
      | "skipped-open"
      | "skipped-merged"
      | "built"
      | "rebuilt"
      | "noop";
  }> => {
    // A plain tagged line: dividers are reserved for stack lifecycle
    // (docs/log-grammar.md).
    say(
      `#${step.issue.number}: ${step.issue.title} ` +
        `(wave ${depth + 1}/${levels.length}: ${waveBase} → ${step.branch})`,
      { tag: stepTag(step) },
    );

    let failure: string | undefined;
    let rebuiltStale = false;
    let prBody: string | undefined;
    try {
      // Read at step start, not plan time: the verdict must see GitHub
      // as it is now. Inside the try: a flaked `gh` prunes only this step.
      const ledger = ctx.effects.prLedger(step.branch);
      // Branch existence matters only to an empty ledger; the git probe
      // is skipped when any PR exists.
      const branchExists =
        ledger.length > 0 ||
        (await ctx.restackLock.use(() =>
          ctx.effects.originBranchExists(step.branch),
        ));
      const verdict = ledgerVerdict(ledger, branchExists);
      if (verdict.kind === "open") {
        // Complete — the branch still takes its restack turn, which
        // detects the no-op, so the chain grows through it.
        say(
          `✓ #${step.issue.number} already complete (open PR ` +
            `${verdict.url}) — sandbox skipped.`,
          { role: "success", tag: stepTag(step) },
        );
        return { disposition: "skipped-open" };
      }
      if (verdict.kind === "merged") {
        // Merged work already sits in its base branch: no restack turn,
        // no link member; a missed closing keyword heals here.
        say(
          `✓ #${step.issue.number} already merged (${verdict.url}) — ` +
            `sandbox skipped; closing the issue.`,
          { role: "warn", tag: stepTag(step) },
        );
        try {
          ctx.effects.closeIssueWithComment(
            step.issue.number,
            `Addressed by merged PR ${verdict.url} (Sandcastle resume check)`,
          );
        } catch (error) {
          sayError(
            `⚠ could not close issue #${step.issue.number} — close it ` +
              `manually with gh issue close ${step.issue.number}. ` +
              `(${error instanceof Error ? error.message : String(error)})`,
            { role: "warn", tag: stepTag(step) },
          );
        }
        return { disposition: "skipped-merged" };
      }
      if (verdict.kind === "stale") {
        // Refs go, history survives in the closed PRs (ADR 0034). Under
        // the restack lock — the deletion pushes via the shared worktree.
        await ctx.restackLock.use(() =>
          ctx.effects.deleteStaleBranch(step.branch),
        );
        say(
          `↺ #${step.issue.number}: stale ${step.branch} deleted ` +
            `(${verdict.why}) — rebuilding fresh.`,
          { role: "warn", tag: stepTag(step) },
        );
        rebuiltStale = true;
      }

      // The ancestry gate (ADR 0018) keeps a leftover branch from
      // reusing pre-restack ancestry. Locked: it reads refs and pushes.
      const gate = await ctx.restackLock.use(() =>
        ctx.effects.gateBranchAncestry(step.branch, waveBaseSha),
      );
      if (gate.kind === "blocked") {
        return { failure: gate.reason, disposition: "built" };
      }
      if (gate.kind === "rebuilt") {
        // A gate reset that moved the local ref is audited alongside
        // the restack-time moves.
        if (gate.localMove !== undefined) {
          localRefMoves.push({ branch: step.branch, ...gate.localMove });
        }
        say(
          `↺ #${step.issue.number}: stale ${step.branch} rebuilt — ` +
            `${gate.details.join("; ")}.`,
          { role: "warn", tag: stepTag(step) },
        );
      }

      const build = await ctx.sandboxPool.use(() =>
        ctx.effects.implementInSandbox(step, waveBase),
      );

      // The reviewer decision reads pushed branch state, never this
      // run's commit count (ADR 0036).
      const empty = await ctx.restackLock.use(() => {
        ctx.effects.pushBranch(step.branch);
        return ctx.effects.branchCarries(waveBase, step.branch);
      });

      if (empty) {
        // The missing-dependency tripwire (ADR 0018): the report becomes
        // the prune reason, which puts the suspected edge in the summary.
        const report = /<missing-dependency>([\s\S]*?)<\/missing-dependency>/.exec(
          build.stdout,
        );
        if (report) {
          failure = `stopped on a missing dependency: ${report[1]!.trim().replace(/\s+/g, " ")}`;
        } else {
          // An empty branch equals its wave base: a neutral skip, spliced
          // out of the chain; dependents build from that base (ADR 0039).
          say(
            `○ #${step.issue.number} skipped — no changes to make: all ` +
              `its work already landed in the PRs below it. Close the ` +
              `issue manually once the stack merges.`,
            { tag: stepTag(step) },
          );
          return { disposition: "noop" };
        }
      } else {
        // A reviewer failure lands here and prunes the step before any
        // PR exists (ADR 0036).
        await ctx.sandboxPool.use(() =>
          ctx.effects.reviewInSandbox(step, waveBase),
        );
        await ctx.restackLock.use(() => ctx.effects.pushBranch(step.branch));
        prBody = draftPrBody(build.stdout, step.issue.number);
      }
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }

    if (failure !== undefined) {
      return { failure, disposition: "built" };
    }

    // The draft PR opens only after the review pass (ADR 0036). A
    // failed creation warns — the branch still restacks.
    let pr: string | undefined;
    try {
      pr = ctx.effects.createDraftPr(
        step.branch,
        waveBase,
        step.issue.title,
        prBody ?? `Closes #${step.issue.number}`,
      );
    } catch {
      pr = undefined;
    }
    if (pr !== undefined) {
      say(`✓ #${step.issue.number} built and reviewed: ${pr}`, {
        role: "success",
        tag: stepTag(step),
      });
    } else {
      missingPrs.push(step.branch);
      sayError(
        `⚠ #${step.issue.number}: ${step.branch} is built and reviewed ` +
          `but its draft PR could not be opened. Continuing — open it ` +
          `manually with gh pr create --draft --head ${step.branch} ` +
          `--base ${waveBase}.`,
        { role: "warn", tag: stepTag(step) },
      );
    }
    return { disposition: rebuiltStale ? "rebuilt" : "built" };
  };

  // The chain tip this stack grows: starts at the trunk, advances as
  // branches join. origin/<trunk> was fetched before the stacks launched.
  let tipName = stack[0]!.base;
  let tipSha = await ctx.restackLock.use(() =>
    ctx.effects.resolveOriginTip(tipName),
  );

  for (const [depth, level] of levels.entries()) {
    const waveBase = tipName;
    // The sha the wave's sandboxes are cut from — later the replay
    // window's start (ADR 0018).
    const waveBaseSha = tipSha;

    // -- Build phase: every survivor concurrently, capped by the pool,
    // all cut from the current chain tip. Same-level steps never depend
    // on each other.
    const survivors = level.filter((step) => {
      const already = pruned.get(step.issue.number);
      if (already === undefined) return true;
      say(`– #${step.issue.number} not built: ${already}.`, {
        role: "dim",
        tag: stepTag(step),
      });
      return false;
    });
    const results = await Promise.all(
      survivors.map((step) => buildStep(step, waveBase, waveBaseSha, depth)),
    );

    // The wave barrier (ADR 0018): prunes land after every member
    // finishes, in level order, whichever sandbox finished first.
    const toRestack: StackStep[] = [];
    for (const [j, step] of survivors.entries()) {
      const { failure, disposition } = results[j]!;
      if (failure !== undefined) {
        prune(step, failure);
        continue;
      }
      // A merged step's work already sits in its base branch: no
      // restack turn, tip unchanged.
      if (disposition === "skipped-merged") {
        skippedMerged.push(step);
        continue;
      }
      // A no-op branch equals the tip it was cut from: no restack turn,
      // tip unchanged, dependents keep building (ADR 0039).
      if (disposition === "noop") {
        noops.push(step);
        continue;
      }
      if (disposition === "skipped-open") skipped.push(step);
      if (disposition === "rebuilt") staleRebuilt.push(step);
      toRestack.push(step);
    }

    // -- Restack phase: serial, ascending issue number, each sibling
    // onto the tip the previous one left. Locked — another stack may
    // hold its restack turn now.
    if (toRestack.length === 0) continue;
    await ctx.restackLock.use(async () => {
      say(
        `Restacking wave ${depth + 1}/${levels.length} of ${label} onto ${waveBase}`,
        { tag },
      );
      // The build phase pushed new branches; refresh origin refs. The
      // tip itself never moves during a build phase.
      ctx.effects.fetchOrigin();

      for (const step of toRestack) {
        // A branch cut on top of a step pruned this run would carry the
        // pruned commits back into its own PR — prune it too, named.
        const carrier = stack.find(
          (s) =>
            pruned.has(s.issue.number) &&
            ctx.effects.branchCarries(step.branch, s.branch),
        );
        if (carrier !== undefined) {
          prune(
            step,
            `its branch history contains pruned ${carrier.branch}`,
          );
          continue;
        }

        let outcome: RestackOutcome;
        try {
          outcome = await ctx.effects.restackBranch(
            step.branch,
            tipName,
            tipSha,
            waveBaseSha,
          );
        } catch (error) {
          prune(
            step,
            `restack failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          continue;
        }

        if (outcome.kind === "unpushed") {
          prune(step, `${step.branch} was never pushed to origin`);
          continue;
        }
        if (outcome.kind === "conflict") {
          prune(step, `rebase onto ${tipName} ${outcome.reason}`);
          continue;
        }
        if (outcome.kind === "check-failed") {
          prune(
            step,
            outcome.resolution === "agent"
              ? `the resolver finished its rebase onto ${tipName} but npm run check failed`
              : outcome.resolution === "rerere"
                ? `rerere replayed recorded resolutions onto ${tipName} but npm run check failed`
                : `npm run check failed at its tip restacked onto ${tipName}`,
          );
          continue;
        }

        if (outcome.kind === "resolved") {
          resolved.push({ step, via: outcome.via });
        }
        say(
          outcome.kind === "restacked"
            ? `✓ ${step.branch} restacked onto ${tipName}: check passed, force-pushed.`
            : outcome.kind === "resolved"
              ? outcome.via === "agent"
                ? `✓ ${step.branch} restacked onto ${tipName}: conflict ` +
                  `agent-resolved, check passed, force-pushed. Audit the ` +
                  `resolution when reviewing the PR.`
                : `✓ ${step.branch} restacked onto ${tipName}: conflict ` +
                  `auto-resolved from recorded rerere resolutions, check ` +
                  `passed, force-pushed.`
              : `✓ ${step.branch} already chains from ${tipName} — no-op.`,
          { role: "success", tag: stepTag(step) },
        );

        // Report every local-ref move for the audit trail, and every
        // skip with its recovery command (ADR 0018).
        if (outcome.kind === "restacked" || outcome.kind === "resolved") {
          const { localRef } = outcome;
          if (localRef.kind === "moved") {
            localRefMoves.push({
              branch: step.branch,
              from: localRef.from,
              to: localRef.to,
            });
            say(
              `  ↪ local ${step.branch} followed the force-push ` +
                `(${localRef.from.slice(0, 12)} → ${localRef.to.slice(0, 12)}).`,
              { role: "dim", tag: stepTag(step) },
            );
          } else if (localRef.kind === "skipped") {
            sayError(
              `  ⚠ local ${step.branch} not moved — ${localRef.reason}. ` +
                `Recover with: ${localRef.recovery}`,
              { role: "warn", tag: stepTag(step) },
            );
          }
        }

        // Keep each PR based on its actual chain predecessor, so review
        // diffs stay per-issue after prunes. Check first: a matching
        // base needs no edit; no readable PR means nothing to retarget
        // (the missing-PR warning already covers it) (ADR 0039).
        const currentBase = ctx.effects.prBase(step.branch);
        if (currentBase !== undefined && currentBase !== tipName) {
          try {
            ctx.effects.retargetPrBase(step.branch, tipName);
          } catch {
            sayError(
              `⚠ ${step.branch}'s PR is based on ${currentBase} ` +
                `instead of ${tipName} and retargeting failed — fix ` +
                `with gh pr edit ${step.branch} --base ${tipName}.`,
              { role: "warn", tag: stepTag(step) },
            );
          }
        }

        chainedSoFar.push(step);
        tipName = step.branch;
        tipSha = outcome.sha;
      }
    });

    // The chain links after each wave (ADR 0018). On a resume gh can
    // refuse the subset; the run-end full-membership link settles it.
    linkChainedPrs(
      ctx.effects,
      chainedSoFar,
      `${label} through wave ${depth + 1}/${levels.length}`,
      tag,
    );
  }

  // Each walk marks its own end: with concurrent stacks the next rule
  // on the console can belong to another stack.
  stackRule(`Finished ${label}`, { tag });

  // Merged and no-op steps are complete but not chained: the chain and
  // the run-end stack link omit them.
  const offChain = new Set(
    [...skippedMerged, ...noops].map((s) => s.issue.number),
  );
  return {
    stack,
    chained: stack.filter(
      (s) => !pruned.has(s.issue.number) && !offChain.has(s.issue.number),
    ),
    skipped: skipped.filter((s) => !pruned.has(s.issue.number)),
    skippedMerged,
    staleRebuilt: staleRebuilt.filter((s) => !pruned.has(s.issue.number)),
    resolved: resolved.filter((r) => !pruned.has(r.step.issue.number)),
    noops,
    pruned: stack
      .filter((s) => pruned.has(s.issue.number))
      .map((s) => ({ step: s, reason: pruned.get(s.issue.number)! })),
    missingPrs,
    localRefMoves,
  };
}
