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
//      capped at SANDCASTLE_MAX_SANDBOXES (default 3); a wave wider
//      than the cap queues, and a wave only restacks once every member
//      has finished. The implementer pushes the branch and opens a
//      draft PR; if it produced commits, the reviewer runs in the same
//      sandbox. Then the level is restacked serially: siblings rebase
//      onto the growing chain in ascending issue-number order, each
//      rewritten tip is gated with `npm run check` (the semantic-drift
//      tripwire for siblings that built blind to each other), rewritten
//      branches are force-pushed, and each PR's base is retargeted to
//      its actual predecessor. The final artifact is the same single
//      linear chain per component the sequential walk produced — the
//      plan's chain order is level-major precisely so the two coincide.
//      Because the restack is serial and runs only after the whole wave
//      finishes, the final branches, bases, and PR chains never depend
//      on which sandbox finished first — any interleaving the cap
//      permits produces the same chains as a cap-1 run.
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
// Nothing here merges branches or closes issues: the owner reviews each PR
// bottom-up (`gh stack` locally) and merging a PR closes its issue via the
// closing keyword in the PR body. See ADR 0018 through ADR 0025.
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
  cpSync,
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { z } from "zod";
import {
  planStacks,
  pruneClosure,
  screenMutations,
  waveLevels,
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

// How many sandboxes may run at once, across all stacks and waves
// combined. One global pool, not per-stack: the binding resource
// (containers, paid agents) is machine- and budget-wide.
const MAX_SANDBOXES = (() => {
  const raw = process.env["SANDCASTLE_MAX_SANDBOXES"];
  if (raw === undefined || raw === "") return 3;
  const cap = Number(raw);
  if (!Number.isInteger(cap) || cap < 1) {
    console.error(
      `SANDCASTLE_MAX_SANDBOXES must be a positive integer, got "${raw}".`,
    );
    process.exit(1);
  }
  return cap;
})();

// Counting semaphore. `use` waits for a slot, runs the thunk, and frees
// the slot when it settles. Waiters resume in FIFO order, so a wave
// wider than the cap starts its queued members in level order as slots
// free up. With one slot it is a mutex.
class Semaphore {
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
      `${MAX_SANDBOXES} (SANDCASTLE_MAX_SANDBOXES) — then restack ` +
      "serially into the single chain shown.",
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

// ---------------------------------------------------------------------------
// Host-side git: the restack worktree
// ---------------------------------------------------------------------------

// Restacking rewrites branches with plain git, and git needs a working
// tree that is not the operator's checkout. One detached worktree serves
// the whole run; it is created fresh, seeded with the host's node_modules
// so `npm run check` can run in it, and removed at the end.
const RESTACK_DIR = ".sandcastle/restack";

// Quiet by default so expected-failure probes (rev-parse on a missing
// branch, merge-base as a boolean) don't spray "fatal:" noise; `show`
// streams output for the operations the operator should watch.
function git(
  args: readonly string[],
  opts: { readonly cwd?: string; readonly show?: boolean } = {},
): string {
  const out = execFileSync("git", args as string[], {
    encoding: "utf8",
    cwd: opts.cwd,
    stdio: opts.show ? ["ignore", "inherit", "inherit"] : undefined,
  });
  return typeof out === "string" ? out.trim() : "";
}

function createRestackWorktree(): string {
  // A dead run can leave the worktree behind; recreate it from scratch so
  // this run never inherits stale state.
  removeRestackWorktree();
  git(["worktree", "add", "--detach", RESTACK_DIR]);
  cpSync("node_modules", join(RESTACK_DIR, "node_modules"), {
    recursive: true,
  });
  return RESTACK_DIR;
}

function removeRestackWorktree(): void {
  try {
    git(["worktree", "remove", "--force", RESTACK_DIR]);
  } catch {
    // Nothing to remove — the common case.
  }
}

type RestackOutcome =
  /** Branch already chains from the tip; nothing rewritten. */
  | { readonly kind: "noop"; readonly sha: string }
  /** Rebased, check passed, force-pushed. */
  | { readonly kind: "restacked"; readonly sha: string }
  /** Rebase conflicted; the resolver agent finished it, same gate, pushed. */
  | { readonly kind: "resolved"; readonly sha: string }
  | { readonly kind: "unpushed" }
  /** Conflicted and unresolved; `reason` says how the attempt ended. */
  | { readonly kind: "conflict"; readonly reason: string }
  /** `resolvedConflict` marks a check failure after an agent resolution. */
  | { readonly kind: "check-failed"; readonly resolvedConflict: boolean };

// ---------------------------------------------------------------------------
// The resolver agent: one attempt on the in-progress rebase
// ---------------------------------------------------------------------------

const RESOLVE_PROMPT_FILE = ".sandcastle/resolve-prompt.md";

function rebaseInProgress(worktree: string): boolean {
  return ["rebase-merge", "rebase-apply"].some((dir) => {
    const path = git(["rev-parse", "--git-path", dir], { cwd: worktree });
    return existsSync(isAbsolute(path) ? path : join(worktree, path));
  });
}

// The resolver runs on the host, in the restack worktree, because the
// in-progress rebase state exists only there — a fresh sandbox would have
// to redo the rebase and self-certify the result. Containment is the same
// mechanism as the planning agent's: in -p mode every tool call outside
// --allowedTools is auto-denied, so it can edit files and drive the rebase
// forward but cannot push, abort, or skip commits. GIT_EDITOR=true keeps
// `git rebase --continue` from opening an editor. Success is never taken
// from the agent's output — the caller judges the git state afterward and
// runs the check gate itself.
function runResolverAgent(
  worktree: string,
  branch: string,
  tipName: string,
): void {
  const prompt = readFileSync(RESOLVE_PROMPT_FILE, "utf8")
    .replaceAll("{{BRANCH}}", branch)
    .replaceAll("{{TIP}}", tipName);
  execFileSync(
    "claude",
    [
      "-p",
      "--model",
      "claude-opus-5",
      "--allowedTools",
      "Read",
      "Glob",
      "Grep",
      "Edit",
      "Write",
      "Bash(git status:*)",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(git show:*)",
      "Bash(git add:*)",
      "Bash(git rebase --continue)",
      "Bash(git commit --amend:*)",
      "Bash(npm install:*)",
      "Bash(npm run check:*)",
      "--disallowedTools",
      "Bash(git rebase --abort)",
      "Bash(git rebase --skip)",
      "Bash(git push:*)",
    ],
    {
      encoding: "utf8",
      input: prompt,
      cwd: worktree,
      stdio: ["pipe", "inherit", "inherit"],
      env: { ...process.env, GIT_EDITOR: "true" },
      timeout: 30 * 60 * 1000,
    },
  );
}

// One attempt, judged mechanically. Returns undefined when the worktree
// holds a plausible resolution — rebase finished, tree clean, HEAD
// descends from the tip — and a reason string otherwise. The check gate
// is not run here: the caller gates every rewritten tip the same way,
// resolved or not.
function attemptResolution(
  worktree: string,
  branch: string,
  tipName: string,
  tipSha: string,
): string | undefined {
  console.log(
    `\n↻ ${branch}: rebase onto ${tipName} conflicted — giving the ` +
      `resolver agent (claude-opus-5) one attempt before pruning…`,
  );
  try {
    runResolverAgent(worktree, branch, tipName);
  } catch (error) {
    return `the resolver agent failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (rebaseInProgress(worktree)) {
    return "the resolver could not finish the rebase";
  }
  if (git(["status", "--porcelain"], { cwd: worktree }) !== "") {
    return "the resolver left uncommitted changes";
  }
  try {
    git(["merge-base", "--is-ancestor", tipSha, "HEAD"], { cwd: worktree });
  } catch {
    return "the resolver's result does not descend from the chain tip";
  }
  return undefined;
}

// Whatever a failed rebase or resolution left behind, put the worktree
// back to a clean detached HEAD so the branch's prune is the only trace.
// Nothing was pushed on any failure path, so origin still holds the
// pre-restack branch — there is no half-resolved state to undo remotely.
function abandonRebase(worktree: string, originSha: string): void {
  try {
    git(["rebase", "--abort"], { cwd: worktree });
  } catch {
    // No rebase in progress — it died before starting or was completed.
  }
  git(["switch", "--force", "--detach", originSha], { cwd: worktree });
  git(["clean", "-fd"], { cwd: worktree });
}

// Rebase one branch onto the chain tip, entirely against origin refs —
// local branch names are never created or moved, so nothing here can
// collide with the operator's checkouts or need undoing on failure. Only
// a rebase that rewrote the branch is gated with `npm run check`: a no-op
// means this exact tree was already gated, in its sandbox on first build
// or by a previous run's restack — that detection is also what makes
// re-running a partially restacked wave safe.
function restackBranch(
  worktree: string,
  branch: string,
  tipName: string,
  tipSha: string,
): RestackOutcome {
  let originSha: string;
  try {
    originSha = git(["rev-parse", "--verify", `origin/${branch}`], {
      cwd: worktree,
    });
  } catch {
    return { kind: "unpushed" };
  }

  try {
    git(["merge-base", "--is-ancestor", tipSha, originSha], { cwd: worktree });
    return { kind: "noop", sha: originSha };
  } catch {
    // Not an ancestor — the branch really needs rebasing.
  }

  git(["switch", "--detach", originSha], { cwd: worktree });
  let resolvedConflict = false;
  try {
    git(["rebase", tipSha], { cwd: worktree, show: true });
  } catch {
    // A conflict stops the rebase mid-flight; anything else (a rebase
    // that died before starting) has no conflict state to resolve.
    const failure = rebaseInProgress(worktree)
      ? attemptResolution(worktree, branch, tipName, tipSha)
      : "the rebase failed before reaching a conflict the resolver could work on";
    if (failure !== undefined) {
      abandonRebase(worktree, originSha);
      return { kind: "conflict", reason: failure };
    }
    resolvedConflict = true;
  }
  const sha = git(["rev-parse", "HEAD"], { cwd: worktree });

  // The semantic-drift tripwire: each wave's siblings built blind to each
  // other, so a rebase can apply cleanly yet break the combined tree. The
  // install trues up dependencies an issue may have added. An agent
  // resolution passes the same gate or prunes like any other bad tip.
  try {
    execFileSync("npm", ["install", "--no-audit", "--no-fund"], {
      cwd: worktree,
      stdio: ["ignore", "ignore", "inherit"],
    });
    execFileSync("npm", ["run", "check"], { cwd: worktree, stdio: "inherit" });
  } catch {
    return { kind: "check-failed", resolvedConflict };
  }

  git(
    [
      "push",
      `--force-with-lease=refs/heads/${branch}:${originSha}`,
      "origin",
      `HEAD:refs/heads/${branch}`,
    ],
    { cwd: worktree, show: true },
  );
  return { kind: resolvedConflict ? "resolved" : "restacked", sha };
}

// True if origin/<inner>'s tip is an ancestor of origin/<outer> — outer's
// history carries inner's commits. False when either branch is unpushed.
function branchCarries(
  worktree: string,
  outer: string,
  inner: string,
): boolean {
  try {
    git(
      [
        "merge-base",
        "--is-ancestor",
        git(["rev-parse", "--verify", `origin/${inner}`], { cwd: worktree }),
        git(["rev-parse", "--verify", `origin/${outer}`], { cwd: worktree }),
      ],
      { cwd: worktree },
    );
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// The wave walk
// ---------------------------------------------------------------------------

interface PrunedStep {
  readonly step: StackStep;
  readonly reason: string;
}

interface StackOutcome {
  readonly stack: readonly StackStep[];
  /** Steps whose branch ended up on the final chain. */
  readonly chained: readonly StackStep[];
  /** Chained steps that skipped their sandbox (already had an open PR). */
  readonly skipped: readonly StackStep[];
  /** Chained steps whose rebase conflict the resolver agent fixed. */
  readonly resolved: readonly StackStep[];
  readonly pruned: readonly PrunedStep[];
}

const missingPrs: string[] = [];

// The pool every sandbox draws from — one, global, shared by all stacks
// and waves — and the lock serializing use of the shared restack
// worktree, which has a single HEAD and index.
const sandboxPool = new Semaphore(MAX_SANDBOXES);
const restackLock = new Semaphore(1);

const restackWt = createRestackWorktree();

async function runStack(
  stack: readonly StackStep[],
  stackIndex: number,
): Promise<StackOutcome> {
  const label = `stack ${stackIndex + 1}/${plan.stacks.length}`;
  console.log(`\n=== Starting ${label}: ${stack.length} step(s) ===`);

  const levels = waveLevels(stack);
  const skipped: StackStep[] = [];
  const resolved: StackStep[] = [];
  const pruned = new Map<number, string>();

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

      await sandboxPool.use(async () => {
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
  let tipSha = await restackLock.use(() =>
    git(["rev-parse", "--verify", `origin/${tipName}`], { cwd: restackWt }),
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
    await restackLock.use(() => {
      console.log(
        `\n--- Restacking wave ${depth + 1}/${levels.length} of ${label} onto ${waveBase} ---`,
      );
      // The build phase pushed new branches; make origin refs current.
      // The tip itself never moves during a build phase — trunk was
      // resolved once up front and every later tip sha is one this
      // stack's own force-pushes produced.
      git(["fetch", "origin"], { cwd: restackWt });

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
            branchCarries(restackWt, step.branch, s.branch),
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
          outcome = restackBranch(restackWt, step.branch, tipName, tipSha);
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
          prune(step, `rebase onto ${tipName} conflicted — ${outcome.reason}`);
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

        tipName = step.branch;
        tipSha = outcome.sha;
      }
    });
  }

  return {
    stack,
    chained: stack.filter((s) => !pruned.has(s.issue.number)),
    skipped: skipped.filter((s) => !pruned.has(s.issue.number)),
    resolved: resolved.filter((s) => !pruned.has(s.issue.number)),
    pruned: stack
      .filter((s) => pruned.has(s.issue.number))
      .map((s) => ({ step: s, reason: pruned.get(s.issue.number)! })),
  };
}

// All stacks launch at once and share the sandbox pool; Promise.all
// keeps `outcomes` in plan order for the summary, whatever order the
// stacks actually finish in. With concurrent sandboxes the interleaved
// log needs its lines self-identifying, which is why every message
// above names its issue and stack.
let outcomes: StackOutcome[];
console.log(
  `\nRunning ${plan.stacks.length} stack(s) with a global cap of ` +
    `${MAX_SANDBOXES} concurrent sandbox(es) (SANDCASTLE_MAX_SANDBOXES).`,
);
try {
  // One up-front fetch resolves every stack's trunk; the per-wave
  // fetches pick up the branches each build phase pushes.
  git(["fetch", "origin"], { cwd: restackWt });
  outcomes = await Promise.all(
    plan.stacks.map((stack, i) => runStack(stack, i)),
  );
} finally {
  removeRestackWorktree();
}

// ---------------------------------------------------------------------------
// Summarize
// ---------------------------------------------------------------------------

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

const prunedCount = outcomes.filter((o) => o.pruned.length > 0).length;

if (missingPrs.length > 0) {
  console.error(
    `\n${missingPrs.length} branch(es) have commits but no PR: ` +
      missingPrs.join(", "),
  );
}

if (prunedCount > 0 || missingPrs.length > 0) {
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
  `\nAll done; plan file deleted. Review each stack bottom-up: bind its ` +
    `PRs with gh stack, merge the bottom PR first, and let auto-retargeting ` +
    `handle the rest.`,
);
