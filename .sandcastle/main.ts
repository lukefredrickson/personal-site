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
//   2. For each stack, for each issue in order: create a sandbox on
//      sandcastle/issue-<n>, cut from the previous issue's branch (the
//      first in each stack from main). The implementer runs first; it
//      pushes the branch and opens a draft PR based on the previous branch.
//      If it produced commits, the reviewer runs in the same sandbox and
//      pushes any refinements. A step whose branch already has an open PR
//      is complete — progress lives on GitHub, not in local state — so its
//      sandbox is skipped, but the step stays in the walk as the base for
//      its successor. Re-running after a partial failure therefore resumes
//      at the first PR-less step of each incomplete stack. A branch with
//      commits but no PR is incomplete and re-runs: the sandbox picks up
//      the existing branch, finds the work done, and opens the missing PR.
//   3. A failed or commit-less step aborts only its own stack — later
//      layers of that stack would build on a missing foundation, but the
//      other stacks share nothing with it, so they still run. The run
//      exits non-zero if any stack aborted, with a per-stack summary.
//
// Nothing here merges branches or closes issues: the owner reviews each PR
// bottom-up (`gh stack` locally) and merging a PR closes its issue via the
// closing keyword in the PR body. See ADR 0018 through ADR 0022.
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
import { z } from "zod";
import {
  planStacks,
  screenMutations,
  type Blocker,
  type EdgeMutation,
  type StackIssue,
  type StackStep,
} from "./stack.ts";

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
// execution. `mutations` holds the judgment agent's screened blocked-by
// edge changes — `run` applies them to GitHub before walking the stacks,
// which were already derived from the graph as amended by them. The
// file's existence is the marker that planning ran — a plan with no
// stacks means planning found nothing to change, while a missing file
// means no plan exists.
interface Plan {
  readonly stacks: readonly (readonly StackStep[])[];
  readonly mutations: readonly EdgeMutation[];
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
// The planning agent: judgment in, proposal out, no write authority
// ---------------------------------------------------------------------------

const PLAN_PROMPT_FILE = ".sandcastle/plan-prompt.md";

const proposalSchema = z.object({
  mutations: z.array(
    z.object({
      op: z.enum(["add", "remove"]),
      blocked: z.int(),
      blocker: z.int(),
      reasoning: z.string(),
    }),
  ),
});

// The judgment agent runs on the host, not in a sandbox: it needs nothing
// a sandbox provides (no branch, no worktree, no npm install) and it must
// not write anyway. Read-only is enforced by the harness, not the prompt:
// in -p mode every tool call outside --allowedTools is auto-denied, and
// the only shell commands allowed are read-only gh subcommands. The
// prompt tells it to fan exploration out to subagents (which inherit the
// same tool restrictions) so its own context stays for judgment.
function runPlanningAgent(
  issues: readonly StackIssue[],
  blockedBy: ReadonlyMap<number, readonly Blocker[]>,
): EdgeMutation[] {
  const prompt = readFileSync(PLAN_PROMPT_FILE, "utf8")
    .replace("{{ISSUES_JSON}}", JSON.stringify(issues, null, 2))
    .replace(
      "{{BLOCKED_BY_JSON}}",
      JSON.stringify(
        Object.fromEntries(
          [...blockedBy].map(([n, blockers]) => [
            n,
            blockers.map((b) => b.number),
          ]),
        ),
        null,
        2,
      ),
    );

  console.log(
    "Running the planning agent (claude-fable-5, read-only) over the " +
      "blocked-by graph…",
  );
  const output = execFileSync(
    "claude",
    [
      "-p",
      "--model",
      "claude-fable-5",
      "--output-format",
      "json",
      "--allowedTools",
      "Read",
      "Glob",
      "Grep",
      "Task",
      "Agent",
      "Bash(gh issue view:*)",
      "Bash(gh issue list:*)",
      "--disallowedTools",
      "Write",
      "Edit",
      "NotebookEdit",
    ],
    {
      encoding: "utf8",
      input: prompt,
      stdio: ["pipe", "pipe", "inherit"],
      maxBuffer: 32 * 1024 * 1024,
      timeout: 30 * 60 * 1000,
    },
  );

  const result = JSON.parse(output) as {
    is_error?: boolean;
    result?: string;
  };
  if (result.is_error || typeof result.result !== "string") {
    throw new Error(`Planning agent failed: ${JSON.stringify(result)}`);
  }

  // The prompt forbids code fences, but strip them anyway — a fenced
  // proposal is still a proposal.
  const text = result.result
    .trim()
    .replace(/^```(?:json)?\s*/, "")
    .replace(/\s*```$/, "");
  return proposalSchema.parse(JSON.parse(text)).mutations;
}

// ---------------------------------------------------------------------------
// Planning: GitHub reads only, no writes
// ---------------------------------------------------------------------------

function repoNameWithOwner(): string {
  const { nameWithOwner } = JSON.parse(
    execFileSync("gh", ["repo", "view", "--json", "nameWithOwner"], {
      encoding: "utf8",
    }),
  ) as { nameWithOwner: string };
  return nameWithOwner;
}

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

  // Nothing to judge and nothing to stack — skip the (paid) planning
  // agent entirely.
  if (issues.length === 0) {
    return { stacks: [], mutations: [] };
  }

  // Fetch each issue's blocked-by edges — grouping and ordering are derived
  // from them. N+1 API calls; fine at this backlog size.
  const nameWithOwner = repoNameWithOwner();

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

  // Judgment, then a mechanical gate: the agent proposes edge changes,
  // screenMutations drops anything cycle-creating or out-of-walk, and the
  // stacks are derived from the graph as amended by the survivors. The
  // rejects are logged here, once, at proposal time — they are not part
  // of the plan because they will never be applied.
  const proposed = runPlanningAgent(issues, blockedBy);
  const { accepted, rejected, amended } = screenMutations(
    issues,
    blockedBy,
    proposed,
  );
  for (const { mutation, reason } of rejected) {
    console.error(
      `✗ dropped ${describeMutation(mutation)} — ${reason}. ` +
        `(agent's reasoning: ${mutation.reasoning})`,
    );
  }

  return { stacks: planStacks(issues, amended), mutations: accepted };
}

function describeMutation(mutation: EdgeMutation): string {
  return mutation.op === "add"
    ? `add: #${mutation.blocked} blocked by #${mutation.blocker}`
    : `remove: #${mutation.blocked} no longer blocked by #${mutation.blocker}`;
}

function printPlan(plan: Plan): void {
  if (plan.stacks.length === 0) {
    console.log(
      "Empty plan: no open issues labeled Sandcastle, nothing to change.",
    );
    return;
  }

  // The agent's surviving proposal, before the stacks it reshaped.
  // Removals get ANSI bold: an addition only serializes work, but a
  // removal un-gates it, so it deserves the harder look.
  if (plan.mutations.length === 0) {
    console.log(
      "Planning agent proposed no blocked-by changes — the graph stands " +
        "as the owner drew it.\n",
    );
  } else {
    console.log(
      `Planning agent proposed ${plan.mutations.length} blocked-by ` +
        `mutation(s), applied to GitHub when this plan runs:\n`,
    );
    for (const mutation of plan.mutations) {
      const line = `  ${mutation.op === "add" ? "+" : "−"} ${describeMutation(mutation)}`;
      // Bold only when stdout is a terminal; piped output keeps the "−"
      // marker without escape-code garbage.
      const bold = mutation.op === "remove" && process.stdout.isTTY;
      console.log(bold ? `\x1b[1m${line}\x1b[22m` : line);
      console.log(`      ${mutation.reasoning}`);
    }
    console.log();
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

  console.log(
    "Grouping and order derived from the blocked-by graph as amended above.",
  );
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
// Apply the plan's blocked-by mutations to GitHub, then walk the stacks
// ---------------------------------------------------------------------------

// Only host code ever writes edges — the planning agent proposed these,
// screening accepted them, and this is the first moment they touch
// GitHub. Application is idempotent against the live graph (adding a
// present edge or removing an absent one is a logged no-op), so re-running
// a retained plan after a failure re-applies safely.
function applyMutationsToGitHub(mutations: readonly EdgeMutation[]): void {
  if (mutations.length === 0) return;

  const nameWithOwner = repoNameWithOwner();
  console.log(
    `\nApplying ${mutations.length} blocked-by mutation(s) to GitHub:`,
  );
  for (const mutation of mutations) {
    const path = `repos/${nameWithOwner}/issues/${mutation.blocked}/dependencies/blocked_by`;
    const current = JSON.parse(
      execFileSync("gh", ["api", path], { encoding: "utf8" }),
    ) as { id: number; number: number }[];
    const existing = current.find((b) => b.number === mutation.blocker);

    if (mutation.op === "add") {
      if (existing) {
        console.log(`  • no-op (edge already present): ${describeMutation(mutation)}`);
        continue;
      }
      // POST takes the blocking issue's database id, not its number.
      const { id } = JSON.parse(
        execFileSync(
          "gh",
          ["api", `repos/${nameWithOwner}/issues/${mutation.blocker}`],
          { encoding: "utf8" },
        ),
      ) as { id: number };
      execFileSync(
        "gh",
        ["api", "-X", "POST", path, "-F", `issue_id=${id}`],
        { encoding: "utf8" },
      );
    } else {
      if (!existing) {
        console.log(`  • no-op (edge already absent): ${describeMutation(mutation)}`);
        continue;
      }
      execFileSync("gh", ["api", "-X", "DELETE", `${path}/${existing.id}`], {
        encoding: "utf8",
      });
    }
    console.log(`  ✓ applied ${describeMutation(mutation)}`);
  }
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

// ---------------------------------------------------------------------------
// Walk the stacks
// ---------------------------------------------------------------------------

// The completion marker. An open PR on a step's branch means the step is
// done — the PR is what the whole walk exists to produce, and it lives on
// GitHub where every run can see it. Closed and merged PRs don't count:
// a merged layer's successor should rebase via the normal review flow,
// and a closed-unmerged PR means the work was rejected, not done.
function openPrUrl(branch: string): string | undefined {
  const prs = JSON.parse(
    execFileSync(
      "gh",
      ["pr", "list", "--head", branch, "--state", "open", "--json", "url"],
      { encoding: "utf8" },
    ),
  ) as { url: string }[];
  return prs[0]?.url;
}

interface StackOutcome {
  readonly stack: readonly StackStep[];
  readonly completed: readonly StackStep[];
  /** Steps skipped because their branch already had an open PR. */
  readonly skipped: readonly StackStep[];
  readonly aborted?: { readonly step: StackStep; readonly reason: string };
}

const missingPrs: string[] = [];
const outcomes: StackOutcome[] = [];

for (const [i, stack] of plan.stacks.entries()) {
  console.log(`\n=== Stack ${i + 1}/${plan.stacks.length} ===`);

  const completed: StackStep[] = [];
  const skipped: StackStep[] = [];
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
      // Already complete? Skip the sandbox but keep the step in the walk —
      // its successor still chains from this branch. Inside the try so a
      // flaked `gh` call aborts this stack, not the whole run.
      const existingPr = openPrUrl(step.branch);
      if (existingPr !== undefined) {
        skipped.push(step);
        console.log(
          `✓ #${step.issue.number} already complete (open PR ${existingPr}) ` +
            `— skipping.`,
        );
        continue;
      }

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
    // would otherwise pass silently — verify from the host, with the same
    // open-PR test the skip above uses, so a step is "complete" by one
    // definition everywhere. A missing PR doesn't invalidate later layers
    // (the branches still chain), so warn and keep walking; a re-run treats
    // the step as incomplete and effectively just opens the missing PR.
    // A flaked verification reads as a missing PR: the warning path already
    // exits non-zero and retains the plan, so the next run re-checks.
    let pr: string | undefined;
    try {
      pr = openPrUrl(step.branch);
    } catch {
      pr = undefined;
    }
    if (pr !== undefined) {
      console.log(`\n✓ #${step.issue.number} complete: ${pr}`);
    } else {
      missingPrs.push(step.branch);
      console.error(
        `\n⚠ #${step.issue.number}: commits exist on ${step.branch} but no PR ` +
          `was found. Continuing — open it manually with ` +
          `gh pr create --draft --head ${step.branch} --base ${step.base}, ` +
          `or re-run \`npm run sandcastle run\` to have the step retried.`,
      );
    }
  }

  outcomes.push({ stack, completed, skipped, aborted });
}

// ---------------------------------------------------------------------------
// Summarize
// ---------------------------------------------------------------------------

console.log(`\n=== Run summary ===\n`);
for (const [i, outcome] of outcomes.entries()) {
  const doneSteps = [...outcome.skipped, ...outcome.completed];
  const done =
    doneSteps.length === 0
      ? "none"
      : doneSteps.map((s) => `#${s.issue.number}`).join(", ");
  const skippedSuffix =
    outcome.skipped.length === 0
      ? ""
      : `, ${outcome.skipped.length} already complete`;
  if (outcome.aborted) {
    console.log(
      `✗ Stack ${i + 1}/${outcomes.length}: ${doneSteps.length}/` +
        `${outcome.stack.length} step(s) complete (${done}${skippedSuffix}); ` +
        `aborted at #${outcome.aborted.step.issue.number} ` +
        `(${outcome.aborted.step.branch}) — ${outcome.aborted.reason}`,
    );
  } else {
    console.log(
      `✓ Stack ${i + 1}/${outcomes.length}: all ${outcome.stack.length} ` +
        `step(s) complete (${done}${skippedSuffix})`,
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
  // Keep the plan: a resume re-executes identical walks, skipping every
  // step that already has an open PR, so each incomplete stack picks back
  // up at its first PR-less step.
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
