// Planning: the plan file, the judgment agent, and GitHub edge writes.
// Planning never writes to GitHub. `run` applies the screened mutations
// here — the only host code that writes blocked-by edges (ADR 0018).

import {
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { z } from "zod";
import { runCaptured } from "./exec.ts";
import { runHostAgent } from "./host-agent.ts";
import { say, sayError } from "./render.ts";
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

// Root-relative is stable: npm scripts run from the package root.
// Gitignored — the plan is local run state, not repo content.
export const PLAN_FILE = ".sandcastle/plan.json";

// The proposal contract between planning and execution. `run` applies
// `mutations` to GitHub before the walk; the stacks already assume the
// amended graph. A plan with no stacks means planning found nothing to
// change; a missing file means no plan exists.
export interface Plan {
  readonly stacks: readonly (readonly StackStep[])[];
  readonly mutations: readonly EdgeMutation[];
}

export function readPlan(): Plan | undefined {
  if (!existsSync(PLAN_FILE)) return undefined;
  const plan = JSON.parse(readFileSync(PLAN_FILE, "utf8")) as Plan;
  // A plan without `dependsOn` predates the wave format; guessing the
  // edges would silently mis-prune. A stale format replans, no migration.
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
  // force: deleting an absent plan is a no-op.
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

// The judgment agent runs on the host and only proposes. The harness
// enforces read-only, not the prompt: in -p mode every tool call
// outside --allowedTools is auto-denied (ADR 0018).
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

  say(
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
    // The CLI enforces the schema; the zod parse re-validates here.
    // draft-7: the CLI rejects zod's default 2020-12 dialect.
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

  // No issues: skip the paid judgment agent.
  if (issues.length === 0) {
    return { stacks: [], mutations: [] };
  }

  // Grouping and ordering derive from the blocked-by edges. N+1 API
  // calls is acceptable at this backlog size.
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

  // Judgment, then a mechanical gate: the stacks derive from the graph
  // as amended by the survivors. Rejects log once; they never apply.
  const proposed = await runPlanningAgent(issues, blockedBy);
  const { accepted, rejected, amended } = screenMutations(
    issues,
    blockedBy,
    proposed,
  );
  for (const { mutation, reason } of rejected) {
    sayError(
      `✗ dropped ${describeMutation(mutation)} — ${reason}. ` +
        `(agent's reasoning: ${mutation.reasoning})`,
      { role: "fail" },
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
    say(
      "Empty plan: no open issues labeled Sandcastle, nothing to change.",
    );
    return;
  }

  // Removals get bold: an addition only serializes work, but a removal
  // un-gates it. Color policy: ADR 0032.
  if (plan.mutations.length === 0) {
    say(
      "Planning agent proposed no blocked-by changes — the graph stands " +
        "as the owner drew it.\n",
    );
  } else {
    say(
      `Planning agent proposed ${plan.mutations.length} blocked-by ` +
        `mutation(s), applied to GitHub when this plan runs:\n`,
    );
    for (const mutation of plan.mutations) {
      say(
        `  ${mutation.op === "add" ? "+" : "−"} ${describeMutation(mutation)}`,
        { role: mutation.op === "remove" ? "bold" : "plain" },
      );
      say(`      ${mutation.reasoning}`);
    }
    say("");
  }

  const issueCount = plan.stacks.reduce((n, stack) => n + stack.length, 0);
  say(
    `Planned ${plan.stacks.length} stack(s) covering ${issueCount} issue(s), ` +
      `one draft PR each:\n`,
  );
  for (const [i, stack] of plan.stacks.entries()) {
    const tag = { stack: i + 1 };
    const levels = waveLevels(stack);
    const shape =
      stack.length === 1
        ? `standalone PR based on ${stack[0]!.base}`
        : `${stack.length} chained PRs, built in ${levels.length} wave(s)`;
    say(`Stack ${i + 1} of ${plan.stacks.length} — ${shape}:`, { tag });
    for (const [depth, level] of levels.entries()) {
      if (stack.length > 1) {
        say(`  wave ${depth + 1} — builds from ${level[0]!.base}:`, { tag });
      }
      for (const step of level) {
        const stepTag = { ...tag, issue: step.issue.number };
        say(`    #${step.issue.number} ${step.issue.title}`, { tag: stepTag });
        say(`        ${step.branch}  ←  chains onto ${step.base}`, {
          tag: stepTag,
        });
      }
    }
    say("");
  }

  say(
    "Grouping, waves, and order derived from the blocked-by graph as " +
      "amended above. Each wave's issues build concurrently from the " +
      "wave's base — stacks share one global sandbox pool, capped at " +
      `${MAX_SANDBOXES} — then restack serially into the single chain shown.`,
  );
}

// ---------------------------------------------------------------------------
// Applying the plan's blocked-by mutations to GitHub
// ---------------------------------------------------------------------------

// The one site that writes blocked-by edges (ADR 0018). Application is
// idempotent against the live graph, so a retained plan re-applies
// safely after a failure.
export function applyMutationsToGitHub(
  mutations: readonly EdgeMutation[],
): void {
  if (mutations.length === 0) return;

  const nameWithOwner = repoNameWithOwner();
  say(
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
        say(`  • no-op (edge already present): ${describeMutation(mutation)}`, {
          role: "dim",
        });
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
        say(`  • no-op (edge already absent): ${describeMutation(mutation)}`, {
          role: "dim",
        });
        continue;
      }
      runCaptured("gh", ["api", "-X", "DELETE", `${path}/${existing.id}`]);
    }
    say(`  ✓ applied ${describeMutation(mutation)}`, { role: "success" });
  }
}
