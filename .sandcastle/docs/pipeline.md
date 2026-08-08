# The run pipeline

What one `npm run sandcastle` invocation does, end to end. Extracted from
the `main.ts` header (ADR 0035). Design rationale: ADR 0018; resume
verdicts: ADR 0034.

## Commands

    npm run sandcastle       # plan (if no plan file), approve, execute
    npm run sandcastle plan  # discard any existing plan and replan; no execution

The bare command is the whole loop. With no plan file it plans, prints,
and pauses for approval (Enter executes, Ctrl-C aborts and keeps the plan
file). With a plan file it executes it as-is, no pause: a surviving plan
means a failed run or an approved-then-aborted one, and both want
resumption, not re-judgment. `plan` forces a replan when the backlog
changed under a retained plan.

## Planning

Planning fetches the open `Sandcastle` issues and their blocked-by
edges. A read-only judgment agent proposes edge additions and removals.
Host code screens the proposal mechanically: cycle-creating or
unknown-issue mutations drop with a reason. `planStacks` partitions the
amended graph into connected components and orders each one with a
deterministic topological sort. A one-issue component is a standalone PR
based on main. The result is printed and written to the plan file.
Planning never writes to GitHub; `run` applies the accepted mutations
before the walk.

## Execution: waves

Each stack executes in waves. Its issues group into the topological
levels of the blocked-by graph. Every issue in a level builds
concurrently, each in its own sandbox on `sandcastle/issue-<n>`, cut
from the current chain tip. Sandboxes come from one global pool capped
at 3. The implementer pushes the branch and opens a draft PR; the
reviewer runs after it when commits exist.

After the whole wave finishes, the level restacks serially: siblings
rebase onto the growing chain in ascending issue-number order, each
rewritten tip gates with `npm run check`, rewritten branches force-push,
and each PR's base retargets to its actual predecessor. The restack is
serial and runs after the wave barrier, so the final chains never depend
on which sandbox finished first.

## Resume

At each step start the PR ledger — every PR on the step's branch, in any
state — is the only cross-run memory (ADR 0034). An open PR means
complete: sandbox skipped, restack a detected no-op. Otherwise the
newest PR decides: merged means complete (skipped, out of the chain, its
open issue closed); closed means the operator rejected the work. A
rejected or PR-less branch is stale: deleted, then rebuilt fresh under
the same name.

## Conflicts and prunes

A conflicting rebase first replays any recorded rerere resolution, then
gets one resolver-agent attempt. The result counts only if host code
finds the rebase finished, the tree clean, and the check passing. A step
that cannot join the chain prunes together with its
dependency-descendants; independent issues keep building, and other
stacks run regardless. The run exits non-zero if anything was pruned.

## End of run

Nothing here merges branches. Each multi-PR stack links on GitHub with
`gh stack link`, wave by wave and once more at run end. The operator
reviews each stack bottom-up; merging a PR closes its issue via the
closing keyword in the PR body.
