// Sequential stacked-PR orchestration, one stack per blocked-by component
//
// One command over one walk: bare `npm run sandcastle` plans (unless a
// plan file already exists), pauses for approval, then executes, leaving
// one GitHub stacked-PR stack per connected component of the blocked-by
// graph; `plan` recomputes the plan file without executing:
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
//      At each step start the PR ledger — every PR on the step's
//      branch, any state — is the only cross-run memory (ADR 0034).
//      An open PR means complete: sandbox skipped, restack a detected
//      no-op. Otherwise the newest PR decides — merged means complete
//      (skipped, left out of the chain, its still-open issue closed);
//      closed means the operator rejected the work. A rejected or
//      PR-less branch is stale: deleted, then rebuilt fresh under the
//      same name. Branch contents are never trusted as progress.
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
// Nothing here merges branches, and the one issue-closing write is the
// resume check healing a missed closing keyword (merged PR, open issue).
// Each multi-PR stack is linked on GitHub with `gh stack link` — wave by
// wave as the chain grows, with a full re-link at run end — the owner
// reviews each PR bottom-up, and merging a PR closes its issue via the
// closing keyword in the PR body.
//
// Usage:
//   npm run sandcastle       # plan (if no plan file), approve, execute
//   npm run sandcastle plan  # discard any existing plan and replan; no execution
//
// The bare command is the whole loop: with no plan file it plans, prints,
// and pauses for interactive approval (Enter to execute, Ctrl-C to stop —
// the plan file survives an abort) before walking. With a plan file it
// executes it as-is, no pause: a surviving plan means either a run failed
// midway (a successful run deletes it) or the owner approved-then-aborted,
// and both want resumption, not re-judgment. Planning is what it always
// was — the full real path (issue fetch, blocked-by edge fetch, grouping,
// ordering, branch/base assignment) minus side effects; what it prints is
// exactly what execution will walk. `plan` exists to force a replan when
// the backlog changed under a retained plan.

import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { openRunLog } from "./exec.ts";
import {
  phaseRule,
  RUN_START_BANNER,
  say,
  sayBanner,
  sayError,
  sayHeading,
  stampPrompt,
} from "./render.ts";
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
  preflightGhToken,
  removeRestackWorktree,
} from "./restack.ts";
import {
  linkChainedPrs,
  MAX_SANDBOXES,
  productionWalkEffects,
  runStack,
  Semaphore,
  type StackOutcome,
} from "./walk.ts";

async function planCommand(): Promise<never> {
  sayHeading("PLAN");
  // `plan` is the force-replan gesture: whatever plan exists is stale by
  // declaration, so it goes before the new one is computed.
  if (existsSync(PLAN_FILE)) {
    deletePlan();
    say(`Discarded the existing plan at ${PLAN_FILE} — replanning.\n`);
  }
  const plan = await computePlan();
  writePlan(plan);
  printPlan(plan);
  say(
    `\nPlan written to ${PLAN_FILE}; no GitHub writes were made. Execute ` +
      `it with \`npm run sandcastle\`.`,
  );
  process.exit(0);
}

// The approval gate between judgment and side effects. Enter proceeds;
// Ctrl-C aborts with the plan file intact, so the next bare run executes
// the already-reviewed plan without re-judging (replan with `plan`).
// Non-interactive stdin gets no gate — there is nobody to ask, and
// blocking forever would be worse than the pre-gate behavior.
async function approvePlanOrExit(): Promise<void> {
  phaseRule("approve");
  if (!process.stdin.isTTY) {
    say("stdin is not a TTY — executing without approval pause.");
    return;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question(
    stampPrompt(
      `Press Enter to execute this plan, or Ctrl-C to stop here ` +
        `(the plan stays at ${PLAN_FILE}: \`npm run sandcastle\` executes ` +
        `it, \`npm run sandcastle plan\` replans). `,
    ),
  );
  rl.close();
}

async function runCommand(): Promise<never> {
  // A run that cannot push must fail here, in milliseconds — before
  // planning (which runs an agent) and before any sandbox is created.
  try {
    preflightGhToken();
  } catch (error) {
    sayError(`✗ ${error instanceof Error ? error.message : String(error)}`, {
      role: "fail",
    });
    process.exit(1);
  }

  // Load (or make) the plan to run. Only a freshly computed plan gets the
  // approval gate — an existing file was either already approved or is a
  // failed run's resume state, and both should proceed unprompted.
  sayHeading("PLAN");
  let plan = readPlan();
  const freshlyPlanned = plan === undefined;
  if (plan === undefined) {
    say(`No plan file at ${PLAN_FILE} — planning first.\n`);
    plan = await computePlan();
    writePlan(plan);
  } else {
    say(
      `Resuming the existing plan at ${PLAN_FILE} as-is; run ` +
        `\`npm run sandcastle plan\` first if the backlog has changed.\n`,
    );
  }
  printPlan(plan);

  // An empty plan is still a valid, executable plan — executing it is a
  // no-op that trivially succeeds, so it is consumed like any other plan.
  if (plan.stacks.length === 0) {
    deletePlan();
    say("\nNothing needed changing. Plan file deleted.");
    process.exit(0);
  }

  if (freshlyPlanned) await approvePlanOrExit();

  try {
    applyMutationsToGitHub(plan.mutations);
  } catch (error) {
    // A half-applied proposal must not walk: the stacks assume the amended
    // graph. The plan is retained and application is idempotent, so a
    // re-run picks up where this one stopped.
    sayError(
      `\n✗ Failed applying blocked-by mutations: ` +
        `${error instanceof Error ? error.message : String(error)}\n` +
        `Plan retained at ${PLAN_FILE} — fix and re-run \`npm run sandcastle\`.`,
      { role: "fail" },
    );
    process.exit(1);
  }

  // All stacks launch at once and share the sandbox pool; Promise.all
  // keeps `outcomes` in plan order for the summary, whatever order the
  // stacks actually finish in. With concurrent sandboxes the interleaved
  // log needs its lines self-identifying, which is why every walk message
  // names its issue and stack.
  phaseRule("execute");
  say(
    `Running ${plan.stacks.length} stack(s) with a global cap of ` +
      `${MAX_SANDBOXES} concurrent sandbox(es).`,
  );
  let outcomes: StackOutcome[];
  const effects = productionWalkEffects(createRestackWorktree());
  const walkContext = {
    stackCount: plan.stacks.length,
    sandboxPool: new Semaphore(MAX_SANDBOXES),
    restackLock: new Semaphore(1),
    effects,
  };
  try {
    // One up-front fetch resolves every stack's trunk; the per-wave
    // fetches pick up the branches each build phase pushes.
    effects.fetchOrigin();
    outcomes = await Promise.all(
      plan.stacks.map((stack, i) => runStack(stack, i, walkContext)),
    );
  } finally {
    removeRestackWorktree();
  }

  // Summarize.
  sayHeading("RUN SUMMARY");
  for (const [i, outcome] of outcomes.entries()) {
    const tag = { stack: i + 1 };
    const done =
      outcome.chained.length === 0
        ? "none"
        : outcome.chained.map((s) => `#${s.issue.number}`).join(", ");
    // What the ledger decided, per kind: open-PR skips, merged skips
    // (issue auto-closed, out of the chain), stale rebuilds.
    const notes: string[] = [];
    if (outcome.skipped.length > 0) {
      notes.push(`${outcome.skipped.length} already complete`);
    }
    if (outcome.skippedMerged.length > 0) {
      notes.push(
        `${outcome.skippedMerged.length} skipped as merged (` +
          outcome.skippedMerged.map((s) => `#${s.issue.number}`).join(", ") +
          `)`,
      );
    }
    if (outcome.staleRebuilt.length > 0) {
      notes.push(`${outcome.staleRebuilt.length} rebuilt from stale`);
    }
    const suffix = notes.length === 0 ? "" : `, ${notes.join(", ")}`;
    if (outcome.pruned.length > 0) {
      say(
        `✗ Stack ${i + 1}/${outcomes.length}: ${outcome.chained.length}/` +
          `${outcome.stack.length} step(s) chained (${done}${suffix}); ` +
          `pruned:`,
        { role: "fail", tag },
      );
      for (const { step, reason } of outcome.pruned) {
        say(`    #${step.issue.number} (${step.branch}) — ${reason}`, {
          tag: { ...tag, issue: step.issue.number },
        });
      }
    } else {
      say(
        `✓ Stack ${i + 1}/${outcomes.length}: ${outcome.chained.length}/` +
          `${outcome.stack.length} step(s) chained (${done}${suffix})`,
        { role: "success", tag },
      );
    }
    // The audit trail for the owner: these branches carry conflict
    // resolutions an agent authored (or rerere replayed from one), not
    // just replayed commits.
    for (const { step, via } of outcome.resolved) {
      say(
        via === "agent"
          ? `    ↻ #${step.issue.number} (${step.branch}) — rebase conflict ` +
              `agent-resolved; audit the resolution when reviewing.`
          : `    ↻ #${step.issue.number} (${step.branch}) — rebase conflict ` +
              `auto-resolved from recorded rerere resolutions.`,
        { role: "warn", tag: { ...tag, issue: step.issue.number } },
      );
    }
    // Everything the run touched outside origin: each local branch ref
    // moved to follow a force-push, so the operator can audit their own
    // checkout's state against this list.
    for (const move of outcome.localRefMoves) {
      say(
        `    ↪ local ${move.branch} moved ${move.from.slice(0, 12)} → ` +
          `${move.to.slice(0, 12)} (followed a force-push or a ` +
          `stale-branch rebuild).`,
        { role: "dim", tag },
      );
    }
  }

  // The run's deliverable is linked stacks, not just base-chained PRs.
  // The walks already linked each chain wave by wave as it grew; this
  // final pass re-links every stack with its full chained membership so
  // resumes, prune-reshaped chains, and any per-wave link that failed all
  // settle to the finished state — and a failure *here* is what retains
  // the plan. Standalone PRs need no link. (`gh stack view` cannot verify
  // these links — it reads local tracking state only; `link`-created
  // stacks live on GitHub.)
  const linkFailures: string[] = [];
  for (const [i, outcome] of outcomes.entries()) {
    const label = `stack ${i + 1}/${outcomes.length}`;
    if (!linkChainedPrs(effects, outcome.chained, label, { stack: i + 1 })) {
      linkFailures.push(label);
    }
  }

  const prunedCount = outcomes.filter((o) => o.pruned.length > 0).length;
  const missingPrs = outcomes.flatMap((o) => o.missingPrs);

  if (missingPrs.length > 0) {
    sayError(
      `\n${missingPrs.length} branch(es) have commits but no PR: ` +
        missingPrs.join(", "),
      { role: "warn" },
    );
  }

  if (prunedCount > 0 || missingPrs.length > 0 || linkFailures.length > 0) {
    // Keep the plan: a resume re-executes identical walks — the ledger
    // skips every complete step, so each stack picks back up at its
    // first incomplete step and pruned work gets retried.
    sayError(
      `\nPlan retained at ${PLAN_FILE} — re-run \`npm run sandcastle\` ` +
        `to resume the same walks.`,
      { role: "fail" },
    );
    process.exit(1);
  }

  deletePlan();
  say(
    `\nAll done; plan file deleted. Stacks are linked on GitHub — review ` +
      `each one bottom-up, merge the bottom PR first, and let ` +
      `auto-retargeting handle the rest.`,
    { role: "success" },
  );
  process.exit(0);
}

const command = process.argv[2];

if (command !== "plan" && command !== undefined) {
  const hint =
    command === "run"
      ? ` (\`run\` is retired; plain \`npm run sandcastle\` plans and executes)`
      : command === "--dry-run"
        ? ` (--dry-run is retired; \`plan\` replaces it)`
        : ` (unknown command "${command}")`;
  sayError(`Usage: npm run sandcastle [plan]${hint}`, { role: "fail" });
  process.exit(1);
}

// The run-start banner fires only once the invocation is valid — a usage
// error should not announce a run that never begins.
sayBanner(RUN_START_BANNER);

// Opened before anything can spawn: every child process this invocation
// runs — git probes, npm gates, gh calls — tees its raw output here, so
// the console can summarize without ever losing information.
say(`Raw child-process output tees to ${openRunLog()}.\n`);

await (command === "plan" ? planCommand() : runCommand());
