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
// restack worktree) arrives as parameters, constructed once by the run
// command and shared by every concurrent stack.

import { execFileSync } from "node:child_process";
import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import {
  branchCarries,
  fetchOrigin,
  resolveOriginTip,
  restackBranch,
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

// The completion marker. An open PR on a step's branch means the step is
// done — the PR is what the whole walk exists to produce, and it lives on
// GitHub where every run can see it. Closed and merged PRs don't count:
// a merged layer's successor should rebase via the normal review flow,
// and a closed-unmerged PR means the work was rejected, not done.
export function openPrUrl(branch: string): string | undefined {
  const prs = JSON.parse(
    execFileSync(
      "gh",
      ["pr", "list", "--head", branch, "--state", "open", "--json", "url"],
      { encoding: "utf8" },
    ),
  ) as { url: string }[];
  return prs[0]?.url;
}

// Bind a chain's open PRs into a GitHub stack, bottom-to-top. `gh stack
// link` refuses partial updates, so the full chained membership is passed
// every time — the same call creates a new stack, grows it wave by wave,
// and updates one reshaped by prunes. gh's own chatter is suppressed;
// one line reports the result. Returns false instead of throwing: a
// failed link never stops a walk, and the run command decides what a
// failure at run end means.
export function linkChainedPrs(
  chained: readonly StackStep[],
  what: string,
): boolean {
  if (chained.length < 2) return true;
  try {
    const urls = chained.map((step) => {
      const url = openPrUrl(step.branch);
      if (url === undefined) throw new Error(`no open PR on ${step.branch}`);
      return url;
    });
    execFileSync("gh", ["stack", "link", ...urls], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    console.log(`✓ ${what}: ${urls.length} PRs linked on GitHub.`);
    return true;
  } catch (error) {
    const stderr =
      error instanceof Error && "stderr" in error
        ? String((error as { stderr: unknown }).stderr ?? "").trim()
        : "";
    console.error(
      `⚠ ${what}: gh stack link failed — ` +
        `${stderr !== "" ? stderr : error instanceof Error ? error.message : String(error)}. ` +
        `Re-run \`npm run sandcastle run\` to re-link, or link by hand ` +
        `with gh stack link <bottom PR> … <top PR>.`,
    );
    return false;
  }
}

interface PrunedStep {
  readonly step: StackStep;
  readonly reason: string;
}

export interface StackOutcome {
  readonly stack: readonly StackStep[];
  /** Steps whose branch ended up on the final chain. */
  readonly chained: readonly StackStep[];
  /** Chained steps that skipped their sandbox (already had an open PR). */
  readonly skipped: readonly StackStep[];
  /** Chained steps whose rebase conflict the resolver agent fixed. */
  readonly resolved: readonly StackStep[];
  readonly pruned: readonly PrunedStep[];
  /** Branches left with commits but no PR — warned, not pruned. */
  readonly missingPrs: readonly string[];
}

// The run-wide state every concurrent stack shares: one sandbox pool,
// one lock serializing use of the shared restack worktree (it has a
// single HEAD and index), and the worktree itself. The run command
// constructs this once and passes it to every walk.
export interface WalkContext {
  /** How many stacks this run launched — labels progress lines only. */
  readonly stackCount: number;
  readonly sandboxPool: Semaphore;
  readonly restackLock: Semaphore;
  readonly restackWorktree: string;
}

export async function runStack(
  stack: readonly StackStep[],
  stackIndex: number,
  ctx: WalkContext,
): Promise<StackOutcome> {
  const label = `stack ${stackIndex + 1}/${ctx.stackCount}`;
  console.log(`\n=== Starting ${label}: ${stack.length} step(s) ===`);

  const levels = waveLevels(stack);
  const skipped: StackStep[] = [];
  const resolved: StackStep[] = [];
  const missingPrs: string[] = [];
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
    console.error(
      `\n✗ #${step.issue.number} pruned — ${reason}.` +
        (descendants.length === 0
          ? ""
          : ` Its dependents ${descendants.map((n) => `#${n}`).join(", ")} ` +
            `are pruned with it.`) +
        ` Issues that never depended on it keep building.`,
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
    depth: number,
  ): Promise<{
    readonly failure?: string;
    readonly skippedSandbox: boolean;
  }> => {
    console.log(
      `\n=== #${step.issue.number}: ${step.issue.title} ` +
        `(${label}, wave ${depth + 1}/${levels.length}: ${waveBase} → ${step.branch}) ===\n`,
    );

    let failure: string | undefined;
    try {
      // Already complete? Skip the sandbox — but the branch still takes
      // its restack turn, which detects the no-op. Checked before taking
      // a pool slot, so a finished step never queues for one. Inside the
      // try so a flaked `gh` call prunes this step, not the run.
      const existingPr = openPrUrl(step.branch);
      if (existingPr !== undefined) {
        console.log(
          `✓ #${step.issue.number} already complete (open PR ` +
            `${existingPr}) — sandbox skipped.`,
        );
        return { skippedSandbox: true };
      }

      await ctx.sandboxPool.use(async () => {
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
            agent: sandcastle.claudeCode("claude-opus-5"),
            promptFile: "./.sandcastle/implement-prompt.md",
            promptArgs: {
              ISSUE_NUMBER: String(step.issue.number),
              ISSUE_TITLE: step.issue.title,
              BRANCH: step.branch,
              BASE_BRANCH: waveBase,
            },
          });

          if (implement.commits.length === 0) {
            failure = "produced no commits";
          } else {
            // Only review if the implementer produced commits.
            await sandbox.run({
              name: `reviewer #${step.issue.number}`,
              maxIterations: 1,
              agent: sandcastle.claudeCode("claude-opus-5"),
              promptFile: "./.sandcastle/review-prompt.md",
              promptArgs: {
                BRANCH: step.branch,
                BASE_BRANCH: waveBase,
              },
            });
          }
        } finally {
          await sandbox.close();
        }
      });
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }

    if (failure !== undefined) {
      return { failure, skippedSandbox: false };
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
      pr = openPrUrl(step.branch);
    } catch {
      pr = undefined;
    }
    if (pr !== undefined) {
      console.log(`\n✓ #${step.issue.number} built: ${pr}`);
    } else {
      missingPrs.push(step.branch);
      console.error(
        `\n⚠ #${step.issue.number}: commits exist on ${step.branch} ` +
          `but no PR was found. Continuing — open it manually with ` +
          `gh pr create --draft --head ${step.branch} --base ${waveBase}, ` +
          `or re-run \`npm run sandcastle run\` to have the step retried.`,
      );
    }
    return { skippedSandbox: false };
  };

  // The chain tip this stack is growing: starts at the trunk, advances
  // to each branch as it joins the chain. origin/<trunk> was fetched
  // once before the stacks launched.
  let tipName = stack[0]!.base;
  let tipSha = await ctx.restackLock.use(() =>
    resolveOriginTip(ctx.restackWorktree, tipName),
  );

  for (const [depth, level] of levels.entries()) {
    const waveBase = tipName;

    // -- Build phase: every survivor of this wave concurrently, capped
    // by the global pool, all cut from the same base — the current
    // chain tip. Same-level steps never depend on each other, so no
    // same-wave prune could have changed what a sibling builds.
    const survivors = level.filter((step) => {
      const already = pruned.get(step.issue.number);
      if (already === undefined) return true;
      console.log(`\n– #${step.issue.number} not built: ${already}.`);
      return false;
    });
    const results = await Promise.all(
      survivors.map((step) => buildStep(step, waveBase, depth)),
    );

    // The wave barrier: prunes land only after every member has
    // finished, in level order, so the pruned set and its recorded
    // reasons are the same whichever sandbox finished first.
    const toRestack: StackStep[] = [];
    for (const [j, step] of survivors.entries()) {
      const { failure, skippedSandbox } = results[j]!;
      if (failure !== undefined) {
        prune(step, failure);
        continue;
      }
      if (skippedSandbox) skipped.push(step);
      toRestack.push(step);
    }

    // -- Restack phase: serial, in ascending issue-number order (the
    // level's own order), each sibling onto the tip the previous one
    // left. The first sibling built from the wave base itself, so its
    // turn is the no-op case. Under the worktree lock, since another
    // stack may be taking its restack turn right now.
    if (toRestack.length === 0) continue;
    await ctx.restackLock.use(async () => {
      console.log(
        `\n--- Restacking wave ${depth + 1}/${levels.length} of ${label} onto ${waveBase} ---`,
      );
      // The build phase pushed new branches; make origin refs current.
      // The tip itself never moves during a build phase — trunk was
      // resolved once up front and every later tip sha is one this
      // stack's own force-pushes produced.
      fetchOrigin(ctx.restackWorktree);

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
            branchCarries(ctx.restackWorktree, step.branch, s.branch),
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
          outcome = await restackBranch(
            ctx.restackWorktree,
            step.branch,
            tipName,
            tipSha,
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
            outcome.resolvedConflict
              ? `the resolver finished its rebase onto ${tipName} but npm run check failed`
              : `npm run check failed at its tip restacked onto ${tipName}`,
          );
          continue;
        }

        if (outcome.kind === "resolved") resolved.push(step);
        console.log(
          outcome.kind === "restacked"
            ? `✓ ${step.branch} restacked onto ${tipName}: check passed, force-pushed.`
            : outcome.kind === "resolved"
              ? `✓ ${step.branch} restacked onto ${tipName}: conflict ` +
                `agent-resolved, check passed, force-pushed. Audit the ` +
                `resolution when reviewing the PR.`
              : `✓ ${step.branch} already chains from ${tipName} — no-op.`,
        );

        // Keep every PR based on its actual predecessor in the chain, so
        // review diffs stay per-issue even after prunes reshaped the walk.
        // Idempotent, so the no-op path retargets too.
        try {
          execFileSync("gh", ["pr", "edit", step.branch, "--base", tipName], {
            encoding: "utf8",
          });
        } catch {
          console.error(
            `⚠ could not retarget the PR base of ${step.branch} — fix with ` +
              `gh pr edit ${step.branch} --base ${tipName}.`,
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
      chainedSoFar,
      `${label} through wave ${depth + 1}/${levels.length}`,
    );
  }

  return {
    stack,
    chained: stack.filter((s) => !pruned.has(s.issue.number)),
    skipped: skipped.filter((s) => !pruned.has(s.issue.number)),
    resolved: resolved.filter((s) => !pruned.has(s.issue.number)),
    pruned: stack
      .filter((s) => pruned.has(s.issue.number))
      .map((s) => ({ step: s, reason: pruned.get(s.issue.number)! })),
    missingPrs,
  };
}
