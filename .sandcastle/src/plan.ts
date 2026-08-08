// Planning: the plan file, the judgment agent, and GitHub edge writes
//
// Planning fetches open issues labeled `Sandcastle` and their blocked-by
// edges, runs a read-only judgment agent that proposes edge additions and
// removals, screens the proposal mechanically, and derives the stacks
// from the amended graph. The persisted plan is the proposal contract
// between planning and execution: planning never writes to GitHub, and
// `run` applies the accepted mutations here — the only host code that
// ever writes blocked-by edges — before walking the stacks.

import {
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { z } from "zod";
import { runCaptured } from "./exec.ts";
import { runHostAgent } from "./host-agent.ts";
import {
  planStacks,
  screenMutations,
  waveLevels,
  type Blocker,
  type EdgeMutation,
  type StackIssue,
  type StackStep,
} from "./stack.ts";
import { MAX_SANDBOXES } from "./walk.ts";

// ---------------------------------------------------------------------------
// The plan file
// ---------------------------------------------------------------------------

// npm scripts always run from the package root, so a root-relative path is
// stable. Gitignored: the plan is local run state, not repo content.
export const PLAN_FILE = ".sandcastle/plan.json";

// The persisted plan is the proposal contract between planning and
// execution. `mutations` holds the judgment agent's screened blocked-by
// edge changes — `run` applies them to GitHub before walking the stacks,
// which were already derived from the graph as amended by them. The
// file's existence is the marker that planning ran — a plan with no
// stacks means planning found nothing to change, while a missing file
// means no plan exists.
export interface Plan {
  readonly stacks: readonly (readonly StackStep[])[];
  readonly mutations: readonly EdgeMutation[];
}

export function readPlan(): Plan | undefined {
  if (!existsSync(PLAN_FILE)) return undefined;
  const plan = JSON.parse(readFileSync(PLAN_FILE, "utf8")) as Plan;
  // Wave execution needs each step's walk-internal dependencies; a plan
  // written before the wave format lacks them, and guessing would
  // silently mis-prune. Replanning is cheap and the plan file is local
  // run state, so a stale format is a re-plan, not a migration.
  if (plan.stacks.flat().some((step) => !Array.isArray(step.dependsOn))) {
    throw new Error(
      `${PLAN_FILE} predates the wave format — re-run \`npm run sandcastle plan\`.`,
    );
  }
  return plan;
}

export function writePlan(plan: Plan): void {
  writeFileSync(PLAN_FILE, JSON.stringify(plan, null, 2) + "\n");
}

export function deletePlan(): void {
  // force: deleting an absent plan is a no-op, so the force-replan path
  // needs no existence check of its own.
  rmSync(PLAN_FILE, { force: true });
}

// ---------------------------------------------------------------------------
// The planning agent: judgment in, proposal out, no write authority
// ---------------------------------------------------------------------------

const PLAN_PROMPT_FILE = ".sandcastle/prompts/plan-prompt.md";

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
async function runPlanningAgent(
  issues: readonly StackIssue[],
  blockedBy: ReadonlyMap<number, readonly Blocker[]>,
): Promise<EdgeMutation[]> {
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
  const result = await runHostAgent({
    role: "plan",
    model: "claude-fable-5",
    prompt,
    allowedTools: [
      "Read",
      "Glob",
      "Grep",
      "Task",
      "Agent",
      "Bash(gh issue view:*)",
      "Bash(gh issue list:*)",
    ],
    disallowedTools: ["Write", "Edit", "NotebookEdit"],
    // Schema-enforced by the CLI: the agent delivers the proposal through
    // a StructuredOutput tool call, so a prose preamble in its final
    // message can't corrupt the result. The zod parse re-validates on
    // this side of the process boundary. draft-7, not zod's default
    // 2020-12 dialect — the CLI's validator rejects the latter.
    jsonSchema: z.toJSONSchema(proposalSchema, { target: "draft-7" }),
  });

  return proposalSchema.parse(JSON.parse(result)).mutations;
}

// ---------------------------------------------------------------------------
// Planning: GitHub reads only, no writes
// ---------------------------------------------------------------------------

function repoNameWithOwner(): string {
  const { nameWithOwner } = JSON.parse(
    runCaptured("gh", ["repo", "view", "--json", "nameWithOwner"]),
  ) as { nameWithOwner: string };
  return nameWithOwner;
}

export async function computePlan(): Promise<Plan> {
  const issues: StackIssue[] = JSON.parse(
    runCaptured("gh", [
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
    ]),
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
          runCaptured("gh", [
            "api",
            `repos/${nameWithOwner}/issues/${issue.number}/dependencies/blocked_by`,
          ]),
        ) as Blocker[]
      ).map(({ number, state }) => ({ number, state })),
    ]),
  );

  // Judgment, then a mechanical gate: the agent proposes edge changes,
  // screenMutations drops anything cycle-creating or out-of-walk, and the
  // stacks are derived from the graph as amended by the survivors. The
  // rejects are logged here, once, at proposal time — they are not part
  // of the plan because they will never be applied.
  const proposed = await runPlanningAgent(issues, blockedBy);
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
    : `remove: #${mutation.blocked} unblocked from #${mutation.blocker}`;
}

export function printPlan(plan: Plan): void {
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
    const levels = waveLevels(stack);
    const shape =
      stack.length === 1
        ? `standalone PR based on ${stack[0]!.base}`
        : `${stack.length} chained PRs, built in ${levels.length} wave(s)`;
    console.log(`Stack ${i + 1} of ${plan.stacks.length} — ${shape}:`);
    for (const [depth, level] of levels.entries()) {
      if (stack.length > 1) {
        console.log(`  wave ${depth + 1} — builds from ${level[0]!.base}:`);
      }
      for (const step of level) {
        console.log(`    #${step.issue.number} ${step.issue.title}`);
        console.log(`        ${step.branch}  ←  chains onto ${step.base}`);
      }
    }
    console.log();
  }

  console.log(
    "Grouping, waves, and order derived from the blocked-by graph as " +
      "amended above. Each wave's issues build concurrently from the " +
      "wave's base — stacks share one global sandbox pool, capped at " +
      `${MAX_SANDBOXES} — then restack serially into the single chain shown.`,
  );
}

// ---------------------------------------------------------------------------
// Applying the plan's blocked-by mutations to GitHub
// ---------------------------------------------------------------------------

// Only host code ever writes edges — the planning agent proposed these,
// screening accepted them, and this is the first moment they touch
// GitHub. Application is idempotent against the live graph (adding a
// present edge or removing an absent one is a logged no-op), so re-running
// a retained plan after a failure re-applies safely.
export function applyMutationsToGitHub(
  mutations: readonly EdgeMutation[],
): void {
  if (mutations.length === 0) return;

  const nameWithOwner = repoNameWithOwner();
  console.log(
    `\nApplying ${mutations.length} blocked-by mutation(s) to GitHub:`,
  );
  for (const mutation of mutations) {
    const path = `repos/${nameWithOwner}/issues/${mutation.blocked}/dependencies/blocked_by`;
    const current = JSON.parse(runCaptured("gh", ["api", path])) as {
      id: number;
      number: number;
    }[];
    const existing = current.find((b) => b.number === mutation.blocker);

    if (mutation.op === "add") {
      if (existing) {
        console.log(`  • no-op (edge already present): ${describeMutation(mutation)}`);
        continue;
      }
      // POST takes the blocking issue's database id, not its number.
      const { id } = JSON.parse(
        runCaptured("gh", [
          "api",
          `repos/${nameWithOwner}/issues/${mutation.blocker}`,
        ]),
      ) as { id: number };
      runCaptured("gh", ["api", "-X", "POST", path, "-F", `issue_id=${id}`]);
    } else {
      if (!existing) {
        console.log(`  • no-op (edge already absent): ${describeMutation(mutation)}`);
        continue;
      }
      runCaptured("gh", ["api", "-X", "DELETE", `${path}/${existing.id}`]);
    }
    console.log(`  ✓ applied ${describeMutation(mutation)}`);
  }
}
