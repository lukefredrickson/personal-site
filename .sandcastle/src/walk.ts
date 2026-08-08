// The wave walk: one stack, built in waves, restacked into a chain
//
// Each stack executes in the wave shape: a stack's issues are grouped
// into the topological levels of the blocked-by graph, every issue in a
// level builds in its own sandbox cut from the current chain tip, and a
// finished wave restacks serially into the single linear chain the plan
// promised. The walk owns the sandbox lifecycle and the prune logic; it
// talks to origin only through the restack module's named operations,
// and everything it learns comes back in its StackOutcome — no hidden
// outputs. The run's shared context (sandbox pool, restack lock,
// effects boundary) arrives as parameters, constructed once by the run
// command and shared by every concurrent stack.
//
// Every effect the walk performs — gh queries, sandbox builds, the
// restack module's git surgery — goes through the WalkEffects boundary,
// so the walk itself is a state machine over data: specs drive it with
// fakes and assert on its decisions (ADR 0029). `productionWalkEffects`
// is the real wiring.
//
// Across runs the walk remembers nothing but the PR ledger: every PR on
// a step's branch, any state, decides at step start whether the step is
// complete, rejected, or stale debris (ADR 0034). Branch contents are
// never trusted as progress.

import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { ChildFailure, runCaptured } from "./exec.ts";
import { phaseRule, say, sayError, type StackTag } from "./render.ts";
import {
  branchCarries,
  deleteStaleBranch,
  fetchOrigin,
  gateBranchAncestry,
  originBranchExists,
  resolveOriginTip,
  restackBranch,
  type BranchGate,
  type ConflictResolution,
  type RestackOutcome,
} from "./restack.ts";
import { pruneClosure, waveLevels, type StackStep } from "./stack.ts";

// Hooks run inside the sandbox before the agent starts each iteration.
// npm install ensures the sandbox always has fresh dependencies.
const hooks = {
  sandbox: { onSandboxReady: [{ command: "npm install" }] },
};

// Copy node_modules from the host into the worktree before each sandbox
// starts. Avoids a full npm install from scratch; the hook above handles
// platform-specific binaries and any packages added since the last copy.
const copyToWorktree = ["node_modules"];

// How many sandboxes may run at once, across all stacks and waves
// combined. One global pool, not per-stack: the binding resource
// (containers, paid agents) is machine- and budget-wide.
export const MAX_SANDBOXES = 3;

// How long a sandboxed agent may be console-silent before the library
// kills its run. The 600 s default read healthy agents deep in long tool
// calls as hangs; the `--idle-timeout` CLI flag the library's error
// message suggests does not exist in v0.12.0 — this option is the knob.
const IDLE_TIMEOUT_SECONDS = 1800;

// Counting semaphore. `use` waits for a slot, runs the thunk, and frees
// the slot when it settles. Waiters resume in FIFO order, so a wave
// wider than the cap starts its queued members in level order as slots
// free up. With one slot it is a mutex.
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

// The resume verdict (ADR 0034). An open PR always wins; otherwise the
// newest PR decides — merged means the work landed, closed means the
// operator rejected it. With no PRs at all the branch is either debris
// from a dead run (stale) or absent (fresh); its contents never count.
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

/** What a sandbox build left behind, as the walk judges completeness. */
export interface SandboxBuild {
  /** Commits the implementer produced on the step's branch. */
  readonly commitCount: number;
  /** Implementer stdout — searched for the missing-dependency report. */
  readonly stdout: string;
}

// The walk's entire outward surface. Everything runStack does to the
// world — ask GitHub about PRs, build a branch in a sandbox, drive the
// restack worktree — is a method here, so specs can run the walk against
// fakes and assert on its decisions. The restack methods close over the
// worktree: the walk never sees a path, and "restacking owns git" stays
// structural. Methods throw on failure exactly where the production
// commands would; the walk's catch blocks are the behavior under test.
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
  /** Retarget the branch's PR onto a new base branch. */
  retargetPrBase(branch: string, base: string): void;
  /** Build the step's branch in its own sandbox, cut from `waveBase`. */
  buildInSandbox(step: StackStep, waveBase: string): Promise<SandboxBuild>;
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

// The real wiring: gh on PATH, docker sandboxes, the restack module
// against the run's shared worktree. Each adapter is thin enough to
// review by eye — one command, except buildInSandbox's build-then-review
// sequence — which is the deal ADR 0029 records.
export function productionWalkEffects(worktree: string): WalkEffects {
  return {
    // One query returns the whole ledger; ledgerVerdict reads it. gh
    // reports state uppercase (OPEN/MERGED/CLOSED), matching LedgerPr.
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
    retargetPrBase(branch, base) {
      runCaptured("gh", ["pr", "edit", branch, "--base", base]);
    },
    async buildInSandbox(step, waveBase) {
      // baseBranch cuts the new branch from the wave's base, so each
      // wave builds on every earlier level even though nothing has
      // merged. It's ignored when the branch already exists, which
      // makes a re-run resume accumulated work.
      const sandbox = await sandcastle.createSandbox({
        branch: step.branch,
        baseBranch: waveBase,
        sandbox: docker(),
        hooks,
        copyToWorktree,
      });
      try {
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
        // Only review if the implementer produced commits.
        if (implement.commits.length > 0) {
          await sandbox.run({
            name: `reviewer #${step.issue.number}`,
            maxIterations: 1,
            idleTimeoutSeconds: IDLE_TIMEOUT_SECONDS,
            agent: sandcastle.claudeCode("claude-opus-5"),
            promptFile: "./.sandcastle/prompts/review-prompt.md",
            promptArgs: {
              BRANCH: step.branch,
              BASE_BRANCH: waveBase,
            },
          });
        }
        return {
          commitCount: implement.commits.length,
          stdout: implement.stdout,
        };
      } finally {
        await sandbox.close();
      }
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

// Bind a chain's open PRs into a GitHub stack, bottom-to-top. `gh stack
// link` refuses partial updates, so the full chained membership is passed
// every time — the same call creates a new stack, grows it wave by wave,
// and updates one reshaped by prunes. Returns false instead of throwing:
// a failed link never stops a walk, and the run command decides what a
// failure at run end means.
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
  readonly pruned: readonly PrunedStep[];
  /** Branches left with commits but no PR — warned, not pruned. */
  readonly missingPrs: readonly string[];
  /** Every local-ref move this stack made, for the run-summary audit. */
  readonly localRefMoves: readonly LocalRefMove[];
}

// The run-wide state every concurrent stack shares: one sandbox pool,
// one lock serializing use of the shared restack worktree (it has a
// single HEAD and index), and the effects boundary wrapping it. The run
// command constructs this once and passes it to every walk.
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
  // The tag every line this walk prints carries: [S2] for stack-level
  // lines, [S2·#139] once a line is about one step.
  const tag: StackTag = { stack: stackIndex + 1 };
  const stepTag = (step: StackStep): StackTag => ({
    ...tag,
    issue: step.issue.number,
  });
  phaseRule(`Starting ${label}: ${stack.length} step(s)`, { tag });

  const levels = waveLevels(stack);
  const skipped: StackStep[] = [];
  const skippedMerged: StackStep[] = [];
  const staleRebuilt: StackStep[] = [];
  const resolved: ResolvedStep[] = [];
  const missingPrs: string[] = [];
  const localRefMoves: LocalRefMove[] = [];
  const pruned = new Map<number, string>();
  // Steps in the order they joined the chain — the membership each
  // per-wave link passes to `gh stack link`.
  const chainedSoFar: StackStep[] = [];

  // Pruning removes the step and its dependency-descendants from the
  // remaining walk; descendants record why so the summary reads whole.
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
      `\n✗ #${step.issue.number} pruned — ${reason}.` +
        (descendants.length === 0
          ? ""
          : ` Its dependents ${descendants.map((n) => `#${n}`).join(", ")} ` +
            `are pruned with it.`) +
        ` Issues that never depended on it keep building.`,
      { role: "fail", tag: stepTag(step) },
    );
  };

  // Build one wave member in its own sandbox, drawing a slot from the
  // global pool. Never throws: a crashed agent or sandbox reads as a
  // failure result, which the post-wave pass turns into a prune — the
  // catch keeps the failure contained so its siblings and the other
  // stacks still run.
  const buildStep = async (
    step: StackStep,
    waveBase: string,
    waveBaseSha: string,
    depth: number,
  ): Promise<{
    readonly failure?: string;
    readonly disposition: "skipped-open" | "skipped-merged" | "built" | "rebuilt";
  }> => {
    phaseRule(
      `#${step.issue.number}: ${step.issue.title} ` +
        `(wave ${depth + 1}/${levels.length}: ${waveBase} → ${step.branch})`,
      { tag: stepTag(step) },
    );

    let failure: string | undefined;
    let rebuiltStale = false;
    try {
      // The ledger verdict, taken at step start so it reads GitHub as it
      // is now, not as it was at plan time. Checked before taking a pool
      // slot, so a finished step never queues for one. Inside the try so
      // a flaked `gh` call prunes this step, not the run.
      const ledger = ctx.effects.prLedger(step.branch);
      // Branch existence only matters to an empty ledger (stale debris
      // vs fresh build); the git probe is skipped when any PR exists.
      const branchExists =
        ledger.length > 0 ||
        (await ctx.restackLock.use(() =>
          ctx.effects.originBranchExists(step.branch),
        ));
      const verdict = ledgerVerdict(ledger, branchExists);
      if (verdict.kind === "open") {
        // Complete — but the branch still takes its restack turn, which
        // detects the no-op, so the chain grows through it.
        say(
          `✓ #${step.issue.number} already complete (open PR ` +
            `${verdict.url}) — sandbox skipped.`,
          { role: "success", tag: stepTag(step) },
        );
        return { disposition: "skipped-open" };
      }
      if (verdict.kind === "merged") {
        // Merged work lives in the base branch already, so this step
        // leaves the chain entirely: no restack turn, no link member.
        // The issue stayed open only because the closing keyword missed;
        // close it here rather than rebuild landed work.
        say(
          `✓ #${step.issue.number} already merged (${verdict.url}) — ` +
            `sandbox skipped; closing the issue.`,
          { role: "warn", tag: stepTag(step) },
        );
        try {
          ctx.effects.closeIssueWithComment(
            step.issue.number,
            `Addressed by merged PR ${verdict.url} (Sandcastle resume check).`,
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
        // Rejected or PR-less debris is never resumed: the refs go, the
        // history survives in the closed PRs, and the sandbox rebuilds
        // fresh under the same deterministic name. Under the restack
        // lock — the deletion pushes through the shared worktree.
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

      // The resume ancestry gate: a leftover branch from a dead run may
      // not descend from the base this wave assigns, and the sandbox
      // library would reuse it as-is — smuggling pre-restack ancestry
      // into the chain. Stale refs reset to the base so the sandbox
      // rebuilds fresh; refs the gate must not touch prune the step
      // with the recovery command in the reason. Under the restack lock:
      // the gate reads origin refs and pushes through the shared worktree.
      const gate = await ctx.restackLock.use(() =>
        ctx.effects.gateBranchAncestry(step.branch, waveBaseSha),
      );
      if (gate.kind === "blocked") {
        return { failure: gate.reason, disposition: "built" };
      }
      if (gate.kind === "rebuilt") {
        // A gate reset that moved the local ref is audited in the run
        // summary alongside the restack-time moves — story is the same:
        // the run touched something outside origin.
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
        ctx.effects.buildInSandbox(step, waveBase),
      );

      if (build.commitCount === 0) {
        // The implement prompt's missing-dependency tripwire: an
        // implementer whose tree lacks a foundation the issue's spec
        // references stops with a tagged report instead of blindly
        // re-implementing it. Surfacing the report as the prune
        // reason puts the suspected missing blocked-by edge in the
        // run summary, where the operator can act on it.
        const report = /<missing-dependency>([\s\S]*?)<\/missing-dependency>/.exec(
          build.stdout,
        );
        failure = report
          ? `stopped on a missing dependency: ${report[1]!.trim().replace(/\s+/g, " ")}`
          : "produced no commits";
      }
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }

    if (failure !== undefined) {
      return { failure, disposition: "built" };
    }

    // The stack is only a stack if every layer has its PR. The
    // implementer opens it from inside the sandbox, where a flaked
    // push or `gh pr create` would otherwise pass silently — verify
    // from the host, with the same open-PR test the skip above uses,
    // so a step is "complete" by one definition everywhere. A missing
    // PR doesn't invalidate the chain (the branch still restacks), so
    // warn and keep walking; a re-run treats the step as incomplete
    // and effectively just opens the missing PR. A flaked verification
    // reads as a missing PR: that path already exits non-zero and
    // retains the plan, so the next run re-checks.
    let pr: string | undefined;
    try {
      pr = openPrUrl(ctx.effects, step.branch);
    } catch {
      pr = undefined;
    }
    if (pr !== undefined) {
      say(`\n✓ #${step.issue.number} built: ${pr}`, {
        role: "success",
        tag: stepTag(step),
      });
    } else {
      missingPrs.push(step.branch);
      sayError(
        `\n⚠ #${step.issue.number}: commits exist on ${step.branch} ` +
          `but no PR was found. Continuing — open it manually with ` +
          `gh pr create --draft --head ${step.branch} --base ${waveBase}, ` +
          `or re-run \`npm run sandcastle\` to have the step retried.`,
        { role: "warn", tag: stepTag(step) },
      );
    }
    return { disposition: rebuiltStale ? "rebuilt" : "built" };
  };

  // The chain tip this stack is growing: starts at the trunk, advances
  // to each branch as it joins the chain. origin/<trunk> was fetched
  // once before the stacks launched.
  let tipName = stack[0]!.base;
  let tipSha = await ctx.restackLock.use(() =>
    ctx.effects.resolveOriginTip(tipName),
  );

  for (const [depth, level] of levels.entries()) {
    const waveBase = tipName;
    // The sha the wave's sandboxes are cut from — later the replay
    // window's start, so each branch's restack replays only the commits
    // the branch itself added on top of this sha.
    const waveBaseSha = tipSha;

    // -- Build phase: every survivor of this wave concurrently, capped
    // by the global pool, all cut from the same base — the current
    // chain tip. Same-level steps never depend on each other, so no
    // same-wave prune could have changed what a sibling builds.
    const survivors = level.filter((step) => {
      const already = pruned.get(step.issue.number);
      if (already === undefined) return true;
      say(`\n– #${step.issue.number} not built: ${already}.`, {
        role: "dim",
        tag: stepTag(step),
      });
      return false;
    });
    const results = await Promise.all(
      survivors.map((step) => buildStep(step, waveBase, waveBaseSha, depth)),
    );

    // The wave barrier: prunes land only after every member has
    // finished, in level order, so the pruned set and its recorded
    // reasons are the same whichever sandbox finished first.
    const toRestack: StackStep[] = [];
    for (const [j, step] of survivors.entries()) {
      const { failure, disposition } = results[j]!;
      if (failure !== undefined) {
        prune(step, failure);
        continue;
      }
      // A merged step's work already sits inside its base branch, so it
      // takes no restack turn and never advances the tip.
      if (disposition === "skipped-merged") {
        skippedMerged.push(step);
        continue;
      }
      if (disposition === "skipped-open") skipped.push(step);
      if (disposition === "rebuilt") staleRebuilt.push(step);
      toRestack.push(step);
    }

    // -- Restack phase: serial, in ascending issue-number order (the
    // level's own order), each sibling onto the tip the previous one
    // left. The first sibling built from the wave base itself, so its
    // turn is the no-op case. Under the worktree lock, since another
    // stack may be taking its restack turn right now.
    if (toRestack.length === 0) continue;
    await ctx.restackLock.use(async () => {
      phaseRule(
        `Restacking wave ${depth + 1}/${levels.length} of ${label} onto ${waveBase}`,
        { tag },
      );
      // The build phase pushed new branches; make origin refs current.
      // The tip itself never moves during a build phase — trunk was
      // resolved once up front and every later tip sha is one this
      // stack's own force-pushes produced.
      ctx.effects.fetchOrigin();

      for (const step of toRestack) {
        // A branch's history carries its whole chain as of when it was
        // built, not just its dependencies. If a step chained on a
        // previous run got pruned on this one, any branch cut on top of
        // it would smuggle the pruned commits back into its own PR when
        // rebased (or spuriously replay their conflict) — prune it too,
        // naming the contamination, and let a re-run rebuild it clean.
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

        // The force-push may have moved the operator's matching local
        // branch under lease; report every move for the audit trail, and
        // every skip with its recovery command.
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

        // Keep every PR based on its actual predecessor in the chain, so
        // review diffs stay per-issue even after prunes reshaped the walk.
        // Idempotent, so the no-op path retargets too.
        try {
          ctx.effects.retargetPrBase(step.branch, tipName);
        } catch {
          sayError(
            `⚠ could not retarget the PR base of ${step.branch} — fix with ` +
              `gh pr edit ${step.branch} --base ${tipName}.`,
            { role: "warn", tag: stepTag(step) },
          );
        }

        chainedSoFar.push(step);
        tipName = step.branch;
        tipSha = outcome.sha;
      }
    });

    // Progressive deliverable: the chain so far is linked as soon as
    // this wave has fully restacked, so the stack exists on GitHub
    // while later waves are still building instead of only at run end.
    // On a resume an existing stack can already hold PRs above this
    // wave; gh refuses that partial update, which reads as a warning
    // here — the run-end link with the full membership settles it.
    linkChainedPrs(
      ctx.effects,
      chainedSoFar,
      `${label} through wave ${depth + 1}/${levels.length}`,
      tag,
    );
  }

  // The stack's own closing boundary — with concurrent stacks the next
  // rule on the console may belong to someone else, so each walk marks
  // its end explicitly.
  phaseRule(`Finished ${label}`, { tag });

  // Merged steps are complete but not chained: their branches are gone
  // or landed, so the chain — and the run-end stack link — omits them.
  const merged = new Set(skippedMerged.map((s) => s.issue.number));
  return {
    stack,
    chained: stack.filter(
      (s) => !pruned.has(s.issue.number) && !merged.has(s.issue.number),
    ),
    skipped: skipped.filter((s) => !pruned.has(s.issue.number)),
    skippedMerged,
    staleRebuilt: staleRebuilt.filter((s) => !pruned.has(s.issue.number)),
    resolved: resolved.filter((r) => !pruned.has(r.step.issue.number)),
    pruned: stack
      .filter((s) => pruned.has(s.issue.number))
      .map((s) => ({ step: s, reason: pruned.get(s.issue.number)! })),
    missingPrs,
    localRefMoves,
  };
}
