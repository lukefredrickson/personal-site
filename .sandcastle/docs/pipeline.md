# The run pipeline

## What Sandcastle is

Sandcastle is an agent factory. It turns a backlog of GitHub issues
into pull requests without a human writing the code. One command reads
the open issues that carry the `Sandcastle` label, plans them into an
order, and runs a Claude agent session for each one. Each session
implements the issue, opens a draft PR, and then reviews its own work.
The operator has two jobs: approve the plan before execution, and
review the finished PRs.

The factory is this repo's own code in `.sandcastle/`. It builds on the
Sandcastle library, `@ai-hero/sandcastle`
([github.com/mattpocock/sandcastle](https://github.com/mattpocock/sandcastle)).
The library supplies the sandbox lifecycle and agent invocation; read
its docs for those general concepts. This doc explains what is unique
here: how one `npm run sandcastle` invocation plans, executes, and
resumes. Canonical term definitions: the glossary in root `CONTEXT.md`.

Two structural terms recur throughout. Issues can block each other
through GitHub's native issue-dependency edges; those edges over the
labeled issues form the **blocked-by graph**. A **stack** is one
ordered chain of PRs, one per connected group of that graph. Each PR in
a stack is based on the PR before it, so the chain merges bottom-up.
GitHub documents this pattern as
[stacked pull requests](https://docs.github.com/en/pull-requests/get-started/about-stacked-prs).

## Commands

    npm run sandcastle       # plan (if no plan file), approve, execute
    npm run sandcastle plan  # discard any existing plan and replan; no execution

The **plan file** (`.sandcastle/plan.json`, gitignored) records what a
run will do. The bare command is the whole loop. With no plan file it
plans, prints the plan, and pauses for approval. Enter executes; Ctrl-C
aborts and keeps the plan file. With a plan file it executes it as-is,
with no pause. A surviving plan means a failed run or an
approved-then-aborted one. Both want resumption, not re-judgment. The
`plan` command forces a replan when the backlog changed under a
retained plan.

## Planning

Planning fetches the open `Sandcastle` issues and their blocked-by
edges. A read-only **judgment agent** then proposes edge additions and
removals, because a raw backlog rarely has every real dependency drawn.
Each proposed change is a **mutation**. Host code screens the proposal
mechanically: cycle-creating or unknown-issue mutations drop with a
reason. `planStacks` partitions the amended graph into connected
components. It orders each component with a deterministic topological
sort. A one-issue component is a standalone PR based on main, not a
stack. The result is printed and written to the plan file. Planning
never writes to GitHub; the bare run applies the accepted mutations
before execution starts.

## Execution: waves

Each issue in a stack becomes a **step**: the issue, the branch
`sandcastle/issue-<n>`, and its base. The steps group into **levels**,
the ranks of the blocked-by graph. A step's level sits one past its
deepest dependency. A **wave** is the concurrent build of one level.

Every step in a wave builds at the same time. Each builds in its own
**sandbox**, an isolated Docker environment from the library, cut from
the current chain tip. Sandboxes come from one global pool capped at 3,
shared across all stacks. Inside the sandbox, the implementer agent
builds, pushes the branch, and opens a draft PR. A reviewer agent runs
after it when commits exist.

After the whole wave finishes, the level **restacks**: each sibling
branch rebases onto the growing chain, in ascending issue-number order.
Every rewritten tip must pass `npm run check` before it counts. Rewritten
branches force-push, and each PR's base retargets to its actual
predecessor. The restack is serial and runs only after the wave
barrier. The final chains therefore never depend on which sandbox
finished first.

## Resume

Progress lives on GitHub, not in local state. At each step start the
walk reads the step's **PR ledger**: every PR whose head is the step's
branch, in any state. The ledger is the only cross-run memory. An open
PR means the step is complete: the sandbox is
skipped, and the restack detects a no-op. Otherwise the newest PR
decides. Merged means complete: the step is skipped, left out of the
chain, and its still-open issue closed. Closed means the operator
rejected the work. A rejected or PR-less branch is **stale**: deleted,
then rebuilt fresh under the same name. Branch contents are never
trusted as progress.

## Conflicts and prunes

A rebase can hit conflicts. The restack first replays any resolution
git **rerere** recorded from an earlier run. If conflicts remain, a
**resolver agent** gets one attempt inside the restack worktree. Its
result counts only if host code finds the rebase finished, the tree
clean, and the check passing. A step that still cannot join the chain
is **pruned**: dropped from the chain together with every step that
depends on it. Independent issues keep building, and other stacks run
regardless. The run exits non-zero if anything was pruned; a re-run
retries the pruned work.

## End of run

Nothing here merges branches. Each multi-PR stack links on GitHub with
`gh stack link`, wave by wave and once more at run end. The operator
reviews each stack bottom-up and merges the bottom PR first. Merging a
PR closes its issue via the closing keyword in the PR body.
