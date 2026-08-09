// CLI entry: `npm run sandcastle` plans (without a plan file), pauses
// for approval, then executes one stacked-PR stack per blocked-by
// component; `npm run sandcastle plan` replans and exits. The pipeline
// is documented in .sandcastle/docs/pipeline.md. Design: ADR 0018;
// resume verdicts: ADR 0034.

import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { openRunLog } from "./exec.ts";
import {
  renderOmittedUmbrellas,
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
  sweepLeakedSandboxWorktrees,
} from "./restack.ts";
import {
  linkChainedPrs,
  liveSandboxes,
  MAX_SANDBOXES,
  productionWalkEffects,
  runStack,
  runSucceeded,
  Semaphore,
  type StackOutcome,
} from "./walk.ts";

// SIGINT kills the process group. The containers and their worktrees
// survive it (#170). The handler closes every live sandbox, then
// exits. Registering it disables Node's default instant exit, so the
// exit call is mandatory. A second Ctrl-C forces the exit.
function closeSandboxesOnSigint(): void {
  let interrupted = false;
  process.on("SIGINT", () => {
    if (interrupted) process.exit(130);
    interrupted = true;
    sayError(
      `Interrupted — closing ${liveSandboxes.size} sandbox(es); ` +
        `Ctrl-C again to force quit.`,
      { role: "warn" },
    );
    void (async () => {
      // New sandboxes can appear while a batch closes; close batches
      // until the set is empty, then exit.
      while (liveSandboxes.size > 0) {
        const batch = [...liveSandboxes];
        await Promise.allSettled(batch.map((s) => s.close()));
        for (const sandbox of batch) liveSandboxes.delete(sandbox);
      }
      process.exit(130);
    })();
  });
}

async function planCommand(): Promise<never> {
  sayHeading("PLAN");
  // Replan: an existing plan file is stale by declaration.
  if (existsSync(PLAN_FILE)) {
    deletePlan();
    say(`Discarded the existing plan at ${PLAN_FILE} — replanning.`);
  }
  const plan = await computePlan();
  writePlan(plan);
  printPlan(plan);
  say(
    `Plan written to ${PLAN_FILE}; no GitHub writes were made. Execute ` +
      `it with \`npm run sandcastle\`.`,
  );
  process.exit(0);
}

// The approval gate between judgment and side effects. Enter proceeds.
// Ctrl-C keeps the plan file, so the next bare run executes it without
// re-judgment. Non-interactive stdin skips the gate: nobody can answer.
// No divider: rules belong to stack lifecycle alone (docs/log-grammar.md).
async function approvePlanOrExit(): Promise<void> {
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
  // A run that cannot push must fail before planning spends an agent run.
  try {
    preflightGhToken();
  } catch (error) {
    sayError(`✗ ${error instanceof Error ? error.message : String(error)}`, {
      role: "fail",
    });
    process.exit(1);
  }

  // Only a fresh plan gets the approval gate: an existing file was
  // already approved or is a failed run's resume state (ADR 0018).
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

  // An empty plan executes as a successful no-op, so it is consumed too.
  if (plan.stacks.length === 0) {
    deletePlan();
    say("Nothing needed changing. Plan file deleted.");
    process.exit(0);
  }

  if (freshlyPlanned) await approvePlanOrExit();

  try {
    applyMutationsToGitHub(plan.mutations);
  } catch (error) {
    // The stacks assume the amended graph, so a half-applied proposal
    // must not walk. Application is idempotent; a re-run resumes it.
    sayError(
      `✗ Failed applying blocked-by mutations: ` +
        `${error instanceof Error ? error.message : String(error)}\n` +
        `Plan retained at ${PLAN_FILE} — fix and re-run \`npm run sandcastle\`.`,
      { role: "fail" },
    );
    process.exit(1);
  }

  // Registered after the approval gate: Ctrl-C during approval still
  // aborts at once, and no sandboxes exist yet.
  closeSandboxesOnSigint();

  // Promise.all keeps `outcomes` in plan order for the summary,
  // whatever order the stacks finish in.
  sayHeading("EXECUTE");
  for (const path of sweepLeakedSandboxWorktrees(".")) {
    say(`↺ removed leaked sandbox worktree ${path} from a dead run.`, {
      role: "warn",
    });
  }
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
    // fetches pick up the branches each build phase pushed.
    effects.fetchOrigin();
    outcomes = await Promise.all(
      plan.stacks.map((stack, i) => runStack(stack, i, walkContext)),
    );
  } finally {
    removeRestackWorktree();
  }

  sayHeading("RUN SUMMARY");
  for (const [i, outcome] of outcomes.entries()) {
    const tag = { stack: i + 1 };
    const done =
      outcome.chained.length === 0
        ? "none"
        : outcome.chained.map((s) => `#${s.issue.number}`).join(", ");
    // The ledger verdicts, per kind: open-PR skips, merged skips, and
    // stale rebuilds (ADR 0034).
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
    if (outcome.noops.length > 0) {
      notes.push(
        `${outcome.noops.length} skipped as no-op (` +
          outcome.noops.map((s) => `#${s.issue.number}`).join(", ") +
          `)`,
      );
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
    // Every no-op leaves its issue open: the reminder rides the summary
    // so the manual close is not lost (#183).
    for (const step of outcome.noops) {
      say(
        `    ○ #${step.issue.number} (${step.branch}) — no changes to ` +
          `make; close the issue manually once the stack merges.`,
        { tag: { ...tag, issue: step.issue.number } },
      );
    }
    // These branches carry authored conflict resolutions, not just
    // replayed commits — the operator audits them at review.
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
    // Each local ref the run moved to follow a force-push, for the
    // operator's audit of their own checkout.
    for (const move of outcome.localRefMoves) {
      say(
        `    ↪ local ${move.branch} moved ${move.from.slice(0, 12)} → ` +
          `${move.to.slice(0, 12)} (followed a force-push or a ` +
          `stale-branch rebuild).`,
        { role: "dim", tag },
      );
    }
  }

  // The plan's omitted umbrellas repeat in the summary (ADR 0039).
  const umbrellaLines = renderOmittedUmbrellas(plan.omittedUmbrellas);
  if (umbrellaLines.length > 0) {
    say("");
    for (const line of umbrellaLines) say(line);
  }

  // The run-end pass re-links each stack with its full membership,
  // which settles resumes, prunes, and failed per-wave links (ADR 0018).
  const linkFailures: string[] = [];
  for (const [i, outcome] of outcomes.entries()) {
    const label = `stack ${i + 1}/${outcomes.length}`;
    if (!linkChainedPrs(effects, outcome.chained, label, { stack: i + 1 })) {
      linkFailures.push(label);
    }
  }

  const missingPrs = outcomes.flatMap((o) => o.missingPrs);

  if (missingPrs.length > 0) {
    sayError(
      `${missingPrs.length} branch(es) have commits but no PR: ` +
        missingPrs.join(", "),
      { role: "warn" },
    );
  }

  // The classification is pure (runSucceeded); this entry only adapts
  // its verdict into the plan lifecycle and the closing line (#183).
  if (!runSucceeded(outcomes, linkFailures.length)) {
    // The retained plan makes a re-run execute identical walks; the
    // ledger skips complete steps, so pruned work retries (ADR 0034).
    sayError(
      `Plan retained at ${PLAN_FILE} — re-run \`npm run sandcastle\` ` +
        `to resume the same walks.`,
      { role: "fail" },
    );
    process.exit(1);
  }

  deletePlan();
  say(
    `All steps complete — plan cleared. Stacks are linked on GitHub — ` +
      `review each one bottom-up, merge the bottom PR first, and let ` +
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

// The banner fires only after the invocation is valid — a usage error
// must not announce a run that never begins.
sayBanner(RUN_START_BANNER);

// Opened before anything spawns: every child process this invocation
// runs tees its raw output here (ADR 0032).
say(`Raw child-process output tees to ${openRunLog()}.`);

await (command === "plan" ? planCommand() : runCommand());
