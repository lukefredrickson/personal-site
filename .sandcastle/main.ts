// Sequential stacked-PR orchestration, one stack per blocked-by component
//
// One run walks the whole backlog and leaves one GitHub stacked-PR stack
// per connected component of the blocked-by graph:
//
//   1. Fetch open issues labeled `Sandcastle`, partition them into the
//      connected components of GitHub's native blocked-by graph, and order
//      each component with a deterministic topological sort — all in a pure
//      function (stack.ts), no planner agent, no LLM judgment call in the
//      grouping or ordering. A component of one issue is a plain standalone
//      PR based on main.
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
// closing keyword in the PR body. See ADR 0018 and ADR 0019.
//
// Usage:
//   npm run sandcastle              # the real, paid walk
//   npm run sandcastle -- --dry-run # print the planned stacks and exit
//
// Always dry-run first: it exercises the full real path (issue fetch,
// blocked-by edge fetch, grouping, ordering, branch/base assignment) minus
// side effects.

import { execFileSync } from "node:child_process";
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

// ---------------------------------------------------------------------------
// Plan the stacks
// ---------------------------------------------------------------------------

const dryRun = process.argv.includes("--dry-run");

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
  console.log("No open issues labeled Sandcastle. Nothing to do.");
  process.exit(0);
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

const stacks = planStacks(issues, blockedBy);

console.log(
  `Planned ${stacks.length} stack(s) covering ${issues.length} issue(s), ` +
    `one draft PR each:\n`,
);
for (const [i, stack] of stacks.entries()) {
  const shape =
    stack.length === 1
      ? `standalone PR based on ${stack[0]!.base}`
      : `${stack.length} chained PRs`;
  console.log(`Stack ${i + 1} of ${stacks.length} — ${shape}:`);
  for (const step of stack) {
    console.log(`  #${step.issue.number} ${step.issue.title}`);
    console.log(`      ${step.branch}  ←  based on ${step.base}`);
  }
  console.log();
}

console.log("Grouping and order derived from the blocked-by graph.");

if (dryRun) {
  console.log("\nDry run — no sandboxes launched.");
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

for (const [i, stack] of stacks.entries()) {
  console.log(`\n=== Stack ${i + 1}/${stacks.length} ===`);

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
  process.exit(1);
}

console.log(
  `\nAll done. Review each stack bottom-up: bind its PRs with gh stack link, ` +
    `merge the bottom PR first, and let auto-retargeting handle the rest.`,
);
