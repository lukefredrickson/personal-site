// Sequential stacked-PR orchestration, one stack per blocked-by component
//
// Two entry points over one walk. `plan` computes the stacks and persists
// them; `run` executes a persisted plan and leaves one GitHub stacked-PR
// stack per connected component of the blocked-by graph:
//
//   1. Planning fetches open issues labeled `Sandcastle`, partitions them
//      into the connected components of GitHub's native blocked-by graph,
//      and orders each component with a deterministic topological sort —
//      all in a pure function (stack.ts), no planner agent, no LLM
//      judgment call in the grouping or ordering. A component of one issue
//      is a plain standalone PR based on main. The result is printed for
//      review and written to the plan file; planning never writes to
//      GitHub.
//   2. For each stack, for each issue in order: create a sandbox on
//      sandcastle/issue-<n>, cut from the previous issue's branch (the
//      first in each stack from main). The implementer runs first; it
//      pushes the branch and opens a draft PR based on the previous branch.
//      If it produced commits, the reviewer runs in the same sandbox and
//      pushes any refinements.
//   3. A failed or commit-less step aborts only its own stack — later
//      layers of that stack would build on a missing foundation, but the
//      other stacks share nothing with it, so they still run. The run
//      exits non-zero if any stack aborted, with a per-stack summary.
//
// Nothing here merges branches or closes issues: the owner reviews each PR
// bottom-up (`gh stack` locally) and merging a PR closes its issue via the
// closing keyword in the PR body. See ADR 0018, ADR 0019, and ADR 0020.
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
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { planStacks, type Blocker, type StackIssue, type StackStep } from "./stack.ts";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Hooks run inside the sandbox before the agent starts each iteration.
// npm install ensures the sandbox always has fresh dependencies.
const hooks = {
  sandbox: { onSandboxReady: [{ command: "npm install" }] },
};

// Copy node_modules from the host into the worktree before each sandbox
// starts. Avoids a full npm install from scratch; the hook above handles
// platform-specific binaries and any packages added since the last copy.
const copyToWorktree = ["node_modules"];

// npm scripts always run from the package root, so a root-relative path is
// stable. Gitignored: the plan is local run state, not repo content.
const PLAN_FILE = ".sandcastle/plan.json";

// ---------------------------------------------------------------------------
// The plan file
// ---------------------------------------------------------------------------

// The persisted plan is the proposal contract between planning and
// execution. `mutations` is always empty at this layer: it reserves the
// slot a future judgment agent would fill with proposed backlog mutations,
// so the file shape doesn't change when one arrives. The file's existence
// is the marker that planning ran — a plan with no stacks means planning
// found nothing to change, while a missing file means no plan exists.
interface Plan {
  readonly stacks: readonly (readonly StackStep[])[];
  readonly mutations: readonly unknown[];
}

function readPlan(): Plan | undefined {
  if (!existsSync(PLAN_FILE)) return undefined;
  return JSON.parse(readFileSync(PLAN_FILE, "utf8")) as Plan;
}

function writePlan(plan: Plan): void {
  writeFileSync(PLAN_FILE, JSON.stringify(plan, null, 2) + "\n");
}

function deletePlan(): void {
  unlinkSync(PLAN_FILE);
}

// ---------------------------------------------------------------------------
// Planning: GitHub reads only, no writes
// ---------------------------------------------------------------------------

function computePlan(): Plan {
  const issues: StackIssue[] = JSON.parse(
    execFileSync(
      "gh",
      [
        "issue",
        "list",
        "--state",
        "open",
        "--label",
        "Sandcastle",
        "--limit",
        "100",
        "--json",
        "number,title",
      ],
      { encoding: "utf8" },
    ),
  );

  if (issues.length === 0) {
    return { stacks: [], mutations: [] };
  }

  // Fetch each issue's blocked-by edges — grouping and ordering are derived
  // from them. N+1 API calls; fine at this backlog size.
  const { nameWithOwner } = JSON.parse(
    execFileSync("gh", ["repo", "view", "--json", "nameWithOwner"], {
      encoding: "utf8",
    }),
  ) as { nameWithOwner: string };

  const blockedBy = new Map<number, readonly Blocker[]>(
    issues.map((issue) => [
      issue.number,
      (
        JSON.parse(
          execFileSync(
            "gh",
            [
              "api",
              `repos/${nameWithOwner}/issues/${issue.number}/dependencies/blocked_by`,
            ],
            { encoding: "utf8" },
          ),
        ) as Blocker[]
      ).map(({ number, state }) => ({ number, state })),
    ]),
  );

  return { stacks: planStacks(issues, blockedBy), mutations: [] };
}

function printPlan(plan: Plan): void {
  if (plan.stacks.length === 0) {
    console.log(
      "Empty plan: no open issues labeled Sandcastle, nothing to change.",
    );
    return;
  }

  const issueCount = plan.stacks.reduce((n, stack) => n + stack.length, 0);
  console.log(
    `Planned ${plan.stacks.length} stack(s) covering ${issueCount} issue(s), ` +
      `one draft PR each:\n`,
  );
  for (const [i, stack] of plan.stacks.entries()) {
    const shape =
      stack.length === 1
        ? `standalone PR based on ${stack[0]!.base}`
        : `${stack.length} chained PRs`;
    console.log(`Stack ${i + 1} of ${plan.stacks.length} — ${shape}:`);
    for (const step of stack) {
      console.log(`  #${step.issue.number} ${step.issue.title}`);
      console.log(`      ${step.branch}  ←  based on ${step.base}`);
    }
    console.log();
  }

  console.log("Grouping and order derived from the blocked-by graph.");
}

// ---------------------------------------------------------------------------
// Command dispatch
// ---------------------------------------------------------------------------

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

if (command === "plan") {
  const plan = computePlan();
  writePlan(plan);
  printPlan(plan);
  console.log(
    `\nPlan written to ${PLAN_FILE}; no GitHub writes were made. Execute ` +
      `it with \`npm run sandcastle run\`; re-run \`plan\` to replan.`,
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Load (or make) the plan to run
// ---------------------------------------------------------------------------

let plan = readPlan();
if (plan === undefined) {
  console.log(`No plan file at ${PLAN_FILE} — planning first.\n`);
  plan = computePlan();
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

// ---------------------------------------------------------------------------
// Walk the stacks
// ---------------------------------------------------------------------------

interface StackOutcome {
  readonly stack: readonly StackStep[];
  readonly completed: readonly StackStep[];
  readonly aborted?: { readonly step: StackStep; readonly reason: string };
}

const missingPrs: string[] = [];
const outcomes: StackOutcome[] = [];

for (const [i, stack] of plan.stacks.entries()) {
  console.log(`\n=== Stack ${i + 1}/${plan.stacks.length} ===`);

  const completed: StackStep[] = [];
  let aborted: StackOutcome["aborted"];

  for (const step of stack) {
    console.log(
      `\n=== #${step.issue.number}: ${step.issue.title} (${step.base} → ${step.branch}) ===\n`,
    );

    // A crashed agent or sandbox is the same as a commit-less step from the
    // stack's point of view: this layer is missing, so the stack must stop.
    // The catch keeps the failure contained so the remaining stacks run.
    let abortReason: string | undefined;
    try {
      // baseBranch cuts the new branch from the previous issue's tip, so
      // each layer builds on dependencies that haven't merged yet. It's
      // ignored when the branch already exists, which makes a re-run resume
      // accumulated work.
      const sandbox = await sandcastle.createSandbox({
        branch: step.branch,
        baseBranch: step.base,
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
            BASE_BRANCH: step.base,
          },
        });

        if (implement.commits.length === 0) {
          abortReason = "produced no commits";
        } else {
          // Only review if the implementer produced commits.
          await sandbox.run({
            name: `reviewer #${step.issue.number}`,
            maxIterations: 1,
            agent: sandcastle.claudeCode("claude-opus-5"),
            promptFile: "./.sandcastle/review-prompt.md",
            promptArgs: {
              BRANCH: step.branch,
              BASE_BRANCH: step.base,
            },
          });
        }
      } finally {
        await sandbox.close();
      }
    } catch (error) {
      abortReason = error instanceof Error ? error.message : String(error);
    }

    if (abortReason !== undefined) {
      aborted = { step, reason: abortReason };
      console.error(
        `\n✗ #${step.issue.number} ${abortReason}. Aborting this stack — ` +
          `later issues in it build on this layer. Remaining stacks still run.`,
      );
      break;
    }

    completed.push(step);

    // The stack is only a stack if every layer has its PR. The implementer
    // opens it from inside the sandbox, where a flaked push or `gh pr create`
    // would otherwise pass silently — verify from the host. A missing PR
    // doesn't invalidate later layers (the branches still chain), so warn and
    // keep walking; the owner can open it by hand from the pushed branch.
    try {
      const pr = JSON.parse(
        execFileSync("gh", ["pr", "view", step.branch, "--json", "url"], {
          encoding: "utf8",
        }),
      ) as { url: string };
      console.log(`\n✓ #${step.issue.number} complete: ${pr.url}`);
    } catch {
      missingPrs.push(step.branch);
      console.error(
        `\n⚠ #${step.issue.number}: commits exist on ${step.branch} but no PR ` +
          `was found. Continuing — open it manually with ` +
          `gh pr create --draft --head ${step.branch} --base ${step.base}`,
      );
    }
  }

  outcomes.push({ stack, completed, aborted });
}

// ---------------------------------------------------------------------------
// Summarize
// ---------------------------------------------------------------------------

console.log(`\n=== Run summary ===\n`);
for (const [i, outcome] of outcomes.entries()) {
  const done =
    outcome.completed.length === 0
      ? "none"
      : outcome.completed.map((s) => `#${s.issue.number}`).join(", ");
  if (outcome.aborted) {
    console.log(
      `✗ Stack ${i + 1}/${outcomes.length}: ${outcome.completed.length}/` +
        `${outcome.stack.length} step(s) completed (${done}); aborted at ` +
        `#${outcome.aborted.step.issue.number} (${outcome.aborted.step.branch})` +
        ` — ${outcome.aborted.reason}`,
    );
  } else {
    console.log(
      `✓ Stack ${i + 1}/${outcomes.length}: all ${outcome.stack.length} ` +
        `step(s) completed (${done})`,
    );
  }
}

const abortedCount = outcomes.filter((o) => o.aborted).length;

if (missingPrs.length > 0) {
  console.error(
    `\n${missingPrs.length} branch(es) have commits but no PR: ` +
      missingPrs.join(", "),
  );
}

if (abortedCount > 0 || missingPrs.length > 0) {
  // Keep the plan: a resume re-executes identical walks, and branches
  // that already have commits pick their accumulated work back up.
  console.error(
    `\nPlan retained at ${PLAN_FILE} — re-run \`npm run sandcastle run\` ` +
      `to resume the same walks.`,
  );
  process.exit(1);
}

deletePlan();
console.log(
  `\nAll done; plan file deleted. Review each stack bottom-up: bind its ` +
    `PRs with gh stack, merge the bottom PR first, and let auto-retargeting ` +
    `handle the rest.`,
);
