// Sequential stacked-PR orchestration
//
// One run walks the whole backlog and leaves a GitHub stacked-PR stack:
//
//   1. Fetch open issues labeled `Sandcastle` and order them by their
//      "Build NN:" title prefix — a pure function (stack.ts), no planner
//      agent, no LLM judgment call in the ordering.
//   2. For each issue, in order: create a sandbox on sandcastle/issue-<n>,
//      cut from the previous issue's branch (the first from main). The
//      implementer runs first; it pushes the branch and opens a draft PR
//      based on the previous branch. If it produced commits, the reviewer
//      runs in the same sandbox and pushes any refinements.
//   3. A failed or commit-less step aborts the walk — later layers build on
//      earlier ones, so continuing would stack onto a missing foundation.
//
// Nothing here merges branches or closes issues: the owner reviews each PR
// bottom-up (`gh stack` locally) and merging a PR closes its issue via the
// closing keyword in the PR body. See ADR 0018.
//
// Usage:
//   npm run sandcastle              # the real, paid walk
//   npm run sandcastle -- --dry-run # print the planned walk and exit
//
// Always dry-run first: it exercises the full real path (issue fetch,
// ordering, branch/base assignment, blocked-by graph check) minus side
// effects.

import { execFileSync } from "node:child_process";
import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import {
  planStack,
  validateBlockers,
  type Blocker,
  type StackIssue,
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

// ---------------------------------------------------------------------------
// Plan the walk
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

const walk = planStack(issues);

if (walk.length === 0) {
  console.log("No open issues labeled Sandcastle. Nothing to do.");
  process.exit(0);
}

console.log(`Planned walk — ${walk.length} issue(s), one draft PR each:\n`);
for (const step of walk) {
  console.log(`  #${step.issue.number} ${step.issue.title}`);
  console.log(`      ${step.branch}  ←  based on ${step.base}`);
}

// Cross-check the walk against GitHub's native blocked-by graph before the
// dry-run exit — catching a mis-ordered backlog is exactly what dry-run is
// for. N+1 API calls; fine at this backlog size.
const { nameWithOwner } = JSON.parse(
  execFileSync("gh", ["repo", "view", "--json", "nameWithOwner"], {
    encoding: "utf8",
  }),
) as { nameWithOwner: string };

const blockedBy = new Map<number, readonly Blocker[]>(
  walk.map((step) => [
    step.issue.number,
    (
      JSON.parse(
        execFileSync(
          "gh",
          [
            "api",
            `repos/${nameWithOwner}/issues/${step.issue.number}/dependencies/blocked_by`,
          ],
          { encoding: "utf8" },
        ),
      ) as Blocker[]
    ).map(({ number, state }) => ({ number, state })),
  ]),
);

validateBlockers(walk, blockedBy);
console.log("\nBlocked-by graph check passed.");

if (dryRun) {
  console.log("\nDry run — no sandboxes launched.");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Walk the stack
// ---------------------------------------------------------------------------

const missingPrs: string[] = [];

for (const step of walk) {
  console.log(
    `\n=== #${step.issue.number}: ${step.issue.title} (${step.base} → ${step.branch}) ===\n`,
  );

  // baseBranch cuts the new branch from the previous issue's tip, so each
  // layer builds on dependencies that haven't merged yet. It's ignored when
  // the branch already exists, which makes a re-run resume accumulated work.
  const sandbox = await sandcastle.createSandbox({
    branch: step.branch,
    baseBranch: step.base,
    sandbox: docker(),
    hooks,
    copyToWorktree,
  });

  let implement: sandcastle.SandboxRunResult;
  try {
    implement = await sandbox.run({
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

    // Only review if the implementer produced commits.
    if (implement.commits.length > 0) {
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

  // Later layers are cut from this branch's tip, so a step that produced
  // nothing means every subsequent PR would be built on a missing layer.
  // Stop and let the owner inspect rather than stacking onto a hole.
  if (implement.commits.length === 0) {
    console.error(
      `\n✗ #${step.issue.number} produced no commits. Aborting the walk — ` +
        `later issues build on this layer.`,
    );
    process.exit(1);
  }

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

if (missingPrs.length > 0) {
  console.error(
    `\nWalk finished, but ${missingPrs.length} branch(es) have no PR: ` +
      missingPrs.join(", "),
  );
  process.exit(1);
}

console.log(
  `\nAll done. Review bottom-up: bind the PRs with gh stack link, merge the ` +
    `bottom PR first, and let auto-retargeting handle the rest.`,
);
