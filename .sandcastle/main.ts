// Sequential stacked-PR orchestration, one stack per blocked-by component
//
// Two entry points over one walk. `plan` computes the stacks and persists
// them; `run` executes a persisted plan and leaves one GitHub stacked-PR
// stack per connected component of the blocked-by graph:
//
//   1. Planning fetches open issues labeled `Sandcastle` and their
//      blocked-by edges, then runs a read-only judgment agent that
//      proposes edge additions and removals (over-tagged backlogs rarely
//      have every real dependency drawn). Host code screens the proposal
//      mechanically — cycle-creating or unknown-issue mutations are
//      dropped with a reason — then partitions the amended graph into
//      connected components and orders each with a deterministic
//      topological sort (stack.ts). The agent has no write authority;
//      grouping and ordering stay pure functions of the (amended) graph.
//      A component of one issue is a plain standalone PR based on main.
//      The result is printed for review and written to the plan file;
//      planning never writes to GitHub.
//   2. Each stack executes in the wave shape. Its issues are grouped
//      into the topological levels of the blocked-by graph (waveLevels):
//      every issue in a level builds in its own sandbox on
//      sandcastle/issue-<n>, cut from the same base — the current stack
//      tip. Level siblings build concurrently, and independent stacks
//      run at the same time, all drawing sandboxes from one global pool
//      capped at MAX_SANDBOXES (3); a wave wider than the cap queues,
//      and a wave only restacks once every member has finished. The
//      implementer pushes the branch and opens a draft PR; if it
//      produced commits, the reviewer runs in the same sandbox. Then
//      the level is restacked serially: siblings rebase onto the
//      growing chain in ascending issue-number order, each rewritten
//      tip is gated with `npm run check` (the semantic-drift tripwire
//      for siblings that built blind to each other), rewritten branches
//      are force-pushed, and each PR's base is retargeted to its actual
//      predecessor. The final artifact is the same single linear chain
//      per component the sequential walk produced — the plan's chain
//      order is level-major precisely so the two coincide. Because the
//      restack is serial and runs only after the whole wave finishes,
//      the final branches, bases, and PR chains never depend on which
//      sandbox finished first — any interleaving the cap permits
//      produces the same chains as a cap-1 run.
//      A step whose branch already has an open PR is complete — progress
//      lives on GitHub, not in local state — so its sandbox is skipped
//      and its restack is a detected no-op; re-running after a partial
//      failure therefore resumes at the first PR-less step. A branch
//      with commits but no PR is incomplete and re-runs: the sandbox
//      picks up the existing branch, finds the work done, and opens the
//      missing PR.
//   3. A conflicting rebase gets one resolver-agent attempt before it
//      prunes: the agent runs in the restack worktree on the
//      in-progress rebase, and its result counts only if host code
//      finds the rebase finished, the tree clean, and `npm run check`
//      passing — then the branch force-pushes and the chain continues
//      as if no conflict occurred. A step that still cannot join the
//      chain — a failed or commit-less build, a conflict the resolver
//      could not fix, or a failed check at its restacked tip — is
//      pruned along with its dependency-descendants (pruneClosure).
//      Siblings and later issues that never depended on it keep
//      building and restack onto the last good tip. Other stacks share
//      nothing with it, so they run regardless. The run exits non-zero
//      if anything was pruned, with a per-stack summary that
//      distinguishes agent-resolved conflicts from pruned subtrees.
//
// Nothing here merges branches or closes issues: each multi-PR stack is
// linked on GitHub with `gh stack link` at run end, the owner reviews each
// PR bottom-up, and merging a PR closes its issue via the closing keyword
// in the PR body.
//
// Usage:
//   npm run sandcastle plan  # compute, print, and persist the plan
//   npm run sandcastle run   # execute the plan file (plans first if none)
//
// Always plan first: it exercises the full real path (issue fetch,
// blocked-by edge fetch, grouping, ordering, branch/base assignment) minus
// side effects, and what it prints is exactly what `run` will execute.
// Re-running `plan` overwrites the plan file — that is the replan gesture.
// `run` consumes the file as-is, with no staleness check.

import { execFileSync } from "node:child_process";
import {
  applyMutationsToGitHub,
  computePlan,
  deletePlan,
  PLAN_FILE,
  printPlan,
  readPlan,
  writePlan,
} from "./plan.ts";
import {
  createRestackWorktree,
  fetchOrigin,
  removeRestackWorktree,
} from "./restack.ts";
import {
  MAX_SANDBOXES,
  openPrUrl,
  runStack,
  Semaphore,
  type StackOutcome,
} from "./walk.ts";

async function planCommand(): Promise<never> {
  const plan = await computePlan();
  writePlan(plan);
  printPlan(plan);
  console.log(
    `\nPlan written to ${PLAN_FILE}; no GitHub writes were made. Execute ` +
      `it with \`npm run sandcastle run\`; re-run \`plan\` to replan.`,
  );
  process.exit(0);
}

async function runCommand(): Promise<never> {
  // Load (or make) the plan to run.
  let plan = readPlan();
  if (plan === undefined) {
    console.log(`No plan file at ${PLAN_FILE} — planning first.\n`);
    plan = await computePlan();
    writePlan(plan);
  } else {
    console.log(
      `Executing the existing plan at ${PLAN_FILE} as-is; re-run \`plan\` ` +
        `first if the backlog has changed.\n`,
    );
  }
  printPlan(plan);

  // An empty plan is still a valid, executable plan — executing it is a
  // no-op that trivially succeeds, so it is consumed like any other plan.
  if (plan.stacks.length === 0) {
    deletePlan();
    console.log("\nNothing needed changing. Plan file deleted.");
    process.exit(0);
  }

  try {
    applyMutationsToGitHub(plan.mutations);
  } catch (error) {
    // A half-applied proposal must not walk: the stacks assume the amended
    // graph. The plan is retained and application is idempotent, so a
    // re-run picks up where this one stopped.
    console.error(
      `\n✗ Failed applying blocked-by mutations: ` +
        `${error instanceof Error ? error.message : String(error)}\n` +
        `Plan retained at ${PLAN_FILE} — fix and re-run \`npm run sandcastle run\`.`,
    );
    process.exit(1);
  }

  // All stacks launch at once and share the sandbox pool; Promise.all
  // keeps `outcomes` in plan order for the summary, whatever order the
  // stacks actually finish in. With concurrent sandboxes the interleaved
  // log needs its lines self-identifying, which is why every walk message
  // names its issue and stack.
  console.log(
    `\nRunning ${plan.stacks.length} stack(s) with a global cap of ` +
      `${MAX_SANDBOXES} concurrent sandbox(es).`,
  );
  let outcomes: StackOutcome[];
  const walkContext = {
    stackCount: plan.stacks.length,
    sandboxPool: new Semaphore(MAX_SANDBOXES),
    restackLock: new Semaphore(1),
    restackWorktree: createRestackWorktree(),
  };
  try {
    // One up-front fetch resolves every stack's trunk; the per-wave
    // fetches pick up the branches each build phase pushes.
    fetchOrigin(walkContext.restackWorktree);
    outcomes = await Promise.all(
      plan.stacks.map((stack, i) => runStack(stack, i, walkContext)),
    );
  } finally {
    removeRestackWorktree();
  }

  // Summarize.
  console.log(`\n=== Run summary ===\n`);
  for (const [i, outcome] of outcomes.entries()) {
    const done =
      outcome.chained.length === 0
        ? "none"
        : outcome.chained.map((s) => `#${s.issue.number}`).join(", ");
    const skippedSuffix =
      outcome.skipped.length === 0
        ? ""
        : `, ${outcome.skipped.length} already complete`;
    if (outcome.pruned.length > 0) {
      console.log(
        `✗ Stack ${i + 1}/${outcomes.length}: ${outcome.chained.length}/` +
          `${outcome.stack.length} step(s) chained (${done}${skippedSuffix}); ` +
          `pruned:`,
      );
      for (const { step, reason } of outcome.pruned) {
        console.log(`    #${step.issue.number} (${step.branch}) — ${reason}`);
      }
    } else {
      console.log(
        `✓ Stack ${i + 1}/${outcomes.length}: all ${outcome.stack.length} ` +
          `step(s) chained (${done}${skippedSuffix})`,
      );
    }
    // The audit trail for the owner: these branches carry conflict
    // resolutions an agent authored, not just replayed commits.
    for (const step of outcome.resolved) {
      console.log(
        `    ↻ #${step.issue.number} (${step.branch}) — rebase conflict ` +
          `agent-resolved; audit the resolution when reviewing.`,
      );
    }
  }

  // The run's deliverable is linked stacks, not just base-chained PRs. Link
  // each multi-PR stack with the gh-stack CLI, full chained membership
  // bottom-to-top: `gh stack link` refuses partial updates, so passing the
  // full set both creates and updates — re-linking on resume is idempotent,
  // and a chain reshaped by prunes updates its existing stack. Standalone
  // PRs need no link. (`gh stack view` cannot verify these links — it reads
  // local tracking state only; `link`-created stacks live on GitHub.)
  const linkFailures: string[] = [];
  for (const [i, outcome] of outcomes.entries()) {
    if (outcome.chained.length < 2) continue;
    const label = `stack ${i + 1}/${outcomes.length}`;
    try {
      const urls = outcome.chained.map((step) => {
        const url = openPrUrl(step.branch);
        if (url === undefined) {
          throw new Error(`no open PR on ${step.branch}`);
        }
        return url;
      });
      execFileSync("gh", ["stack", "link", ...urls], {
        stdio: ["ignore", "inherit", "inherit"],
      });
      console.log(`✓ ${label}: ${urls.length} PRs linked via gh stack link.`);
    } catch (error) {
      linkFailures.push(label);
      console.error(
        `⚠ ${label}: gh stack link failed — ` +
          `${error instanceof Error ? error.message : String(error)}. ` +
          `Re-run \`npm run sandcastle run\` to re-link, or link by hand ` +
          `with gh stack link <bottom PR> … <top PR>.`,
      );
    }
  }

  const prunedCount = outcomes.filter((o) => o.pruned.length > 0).length;
  const missingPrs = outcomes.flatMap((o) => o.missingPrs);

  if (missingPrs.length > 0) {
    console.error(
      `\n${missingPrs.length} branch(es) have commits but no PR: ` +
        missingPrs.join(", "),
    );
  }

  if (prunedCount > 0 || missingPrs.length > 0 || linkFailures.length > 0) {
    // Keep the plan: a resume re-executes identical walks — steps with open
    // PRs skip their sandboxes and no-op their restacks, so each stack picks
    // back up at its first incomplete step and pruned work gets retried.
    console.error(
      `\nPlan retained at ${PLAN_FILE} — re-run \`npm run sandcastle run\` ` +
        `to resume the same walks.`,
    );
    process.exit(1);
  }

  deletePlan();
  console.log(
    `\nAll done; plan file deleted. Stacks are linked on GitHub — review ` +
      `each one bottom-up, merge the bottom PR first, and let ` +
      `auto-retargeting handle the rest.`,
  );
  process.exit(0);
}

const command = process.argv[2];

if (command !== "plan" && command !== "run") {
  const hint =
    command === "--dry-run"
      ? ` (--dry-run is retired; \`plan\` replaces it)`
      : command === undefined
        ? ""
        : ` (unknown command "${command}")`;
  console.error(`Usage: npm run sandcastle <plan|run>${hint}`);
  process.exit(1);
}

await (command === "plan" ? planCommand() : runCommand());
