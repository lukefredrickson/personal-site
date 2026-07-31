# 19. Sandcastle: one stack per blocked-by component

Date: 2026-07-31
Status: Accepted, amended by
[ADR 0020](0020-sandcastle-plan-and-run-commands-with-plan-file.md)
(`--dry-run` retired in favor of `plan`/`run` with a persisted plan file)
and [ADR 0021](0021-sandcastle-planning-agent-blocked-by-mutations.md)
(stacks derive from the blocked-by graph as amended by the planning agent)

Amends [ADR 0018](0018-sandcastle-sequential-stacked-pr-orchestration.md).
Resolves
[#59](https://github.com/lukefredrickson/personal-site/issues/59).

## Context

ADR 0018's walk chains every tagged issue into one linear stack from
`main`, in blocked-by order. That shape has two costs that the blocked-by
graph itself doesn't impose:

- **False coupling.** Issues with no dependency relationship still end up
  layered on each other. An unrelated issue's PR carries another issue's
  diff in its base, review order is forced where none is needed, and a
  rebase on one layer ripples through work that never depended on it.
- **Total abort.** A failed or commit-less step stops the whole run,
  including issues that share nothing with the failure. For a backlog of
  mostly independent issues, one flake forfeits the rest of the AFK run.

Both costs are artifacts of the single-chain shape, not of stacking itself.
The graph already says which issues are actually related: the connected
components of the blocked-by edges among the tagged issues.

## Decision

### Partition the walk into one stack per connected component

The pure planning seam (`.sandcastle/stack.ts`) now derives the connected
components of the blocked-by graph — undirected: two issues are related if
either blocks the other, directly or transitively — and emits one stack
per component. Each component is chained from `main` exactly as before; a
component of one issue becomes a plain standalone PR based on `main`.
Nothing tagged is ever excluded — grouping replaces gatekeeping.

Within a component the order stays the deterministic Kahn's walk with the
lowest-issue-number tie-break. Since blocked-by edges never cross
components, sorting each component alone yields the same relative order a
global sort would; the partition changes chaining, not ordering. Stacks
are themselves ordered by their lowest member's issue number, for the same
determinism. Validation is unchanged and still aggregates: an open blocker
outside the walk and a cycle within a component are errors, all reported
in a single throw.

### Per-stack abort, whole-run exit code

Execution runs the stacks one after another. A failed **or crashed** step
aborts only its own stack — its later layers would build on a missing
foundation, but other stacks share nothing with it, so they still run.
(Under ADR 0018 an agent crash escaped the loop entirely; now it is caught
and treated like a commit-less step.) The run exits non-zero if any stack
aborted, and prints a per-stack summary naming what completed, what
aborted, and at which step. The missing-PR check is unchanged: warn,
finish the stack, exit non-zero at the end.

The seam and its verification are unchanged in kind: planning stays a pure
function (issues + edges in, stacks out, no I/O), `--dry-run` prints the
stacks against the live backlog, and changes to the logic are verified
with `tsx` one-liners — still no test runner (ADR 0018).

## Alternatives considered

- **Keep the single chain** — rejected: the coupling and total-abort costs
  buy nothing; the linear order among independent issues was already
  acknowledged as arbitrary in ADR 0018.
- **Run the stacks in parallel** — deferred, not rejected: it needs a
  concurrency cap and scheduling ([#64](https://github.com/lukefredrickson/personal-site/issues/64)).
  Sequential-but-independent lands the isolation win now and is the shape
  #64 parallelizes.
- **Exclude singleton issues from the run** — rejected: an issue with no
  edges is the *easiest* case (a standalone PR), not a special one.
  Grouping replaces gatekeeping.

## Consequences

- A backlog with no cross-issue edges yields all standalone PRs based on
  `main` — plain PRs, no stack mechanics at all. A fully-connected backlog
  reproduces ADR 0018's single stack exactly.
- One flaked issue no longer forfeits the rest of an AFK run; the exit
  code still refuses to call a partial run a success.
- `gh stack link` binding is now per-stack; standalone PRs need no
  binding.
- More PRs are based directly on `main`, so merge order across stacks is
  unconstrained — only within a stack does bottom-up still apply.
