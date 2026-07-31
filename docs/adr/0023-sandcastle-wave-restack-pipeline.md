# 23. Sandcastle: wave restack pipeline with prune-on-conflict

Date: 2026-07-31
Status: Accepted

Amends [ADR 0018](0018-sandcastle-sequential-stacked-pr-orchestration.md)
(execution moves from a strictly sequential walk to the wave shape) and
[ADR 0019](0019-sandcastle-one-stack-per-blocked-by-component.md) (the
chain order within a component becomes level-major). Resolves
[#63](https://github.com/lukefredrickson/personal-site/issues/63).

## Context

ADR 0018 rejected parallel execution within a stack as "a rebase-conflict
surface with no review-granularity benefit". That still holds for
turning parallelism *on* blind — but the sequential walk pays full serial
latency even for issues that share nothing, and getting to safe
parallelism requires an execution shape that can build independent
issues from a common base and then linearize them. This ADR lands that
shape while keeping one sandbox at a time, so the wave path can prove
itself equivalent to the sequential walk before concurrency ever turns
on. A failure model also falls out: the sequential walk aborted a whole
stack at the first bad step, even when later issues never depended on it.

## Decision

### The chain order becomes level-major

Kahn's lowest-number-first order and "topological levels, ascending
issue number within each level" can disagree (roots {1, 3} with 2
blocked by 1: Kahn yields 1, 2, 3; levels yield 1, 3, 2). Since the
wave restacks level by level, `planStacks` now orders each component by
(level, issue number) — still a deterministic topological order — so
the sequential chain and the wave-built chain coincide by construction.
Each `StackStep` carries its walk-internal `dependsOn` edges; levels
(`waveLevels`) and prune closures (`pruneClosure`) are pure functions of
them in `stack.ts`, verifiable via `plan` with no sandboxes.

### Build the wave, restack it serially, prune what cannot join

Per level: every issue builds in its own sandbox from the same base —
the current chain tip — one sandbox at a time. Then the level restacks
serially in ascending issue-number order: each branch rebases onto the
growing chain (`git rebase`, against origin refs in a throwaway host
worktree), a rewritten tip is gated with `npm run check` — the
semantic-drift tripwire for siblings that built blind to each other —
then force-pushed (`--force-with-lease`), and its PR base is retargeted
to its actual predecessor. A branch already descending from the tip is
a detected no-op: nothing rewritten, no check (that exact tree was
already gated in its sandbox or by a previous run), which is also what
makes re-running a partially restacked wave safe under ADR 0022's
resume.

A step that cannot join the chain — commit-less or crashed build,
rebase conflict, or failed check — is pruned together with its
dependency-descendants; siblings and independent later issues keep
building and restack onto the last good tip. Pruning subsumes ADR
0018's abort-the-stack: in a pure dependency chain the descendants are
exactly the rest of the stack. One prune reaches beyond the dependency
closure: a branch's history carries its whole chain as of when it was
built, so on a resume, a branch whose history contains a step this run
pruned is pruned too — rebasing it would smuggle the pruned commits
into its own PR — and a re-run rebuilds it clean.

## Alternatives considered

- **Keep Kahn order, derive levels as contiguous runs of it** — rejected:
  it preserves the old order but yields shallower waves, and the order
  was never load-bearing; determinism is.
- **Integration branches / octopus merges per level** — rejected: the
  deliverable is one linear chain of per-issue PRs; anything else
  forfeits the review granularity the whole system exists for.
- **Run `npm run check` on no-op restacks too** — rejected: in a pure
  chain every restack is a no-op, so this would re-gate every tree that
  was already gated in its sandbox, doubling wall-clock for nothing. The
  residual exposure (the reviewer agent can push refinements after the
  implementer's gate) is exactly the sequential walk's, no wider.
- **Closing a pruned step's PR** — rejected: an open PR is ADR 0022's
  completion marker, and leaving it open makes resume retry only the
  restack, not the build.

## Consequences

- With concurrency at one, the wave is pure overhead versus the
  sequential walk — deliberately, until a conflict-free run is shown to
  produce identical branches, bases, and PR chains. Parallel builds
  within a level are the follow-up, and only the build phase ever runs
  concurrently; restacking stays serial by design.
- Restacking rewrites published `sandcastle/*` branches. Force-push is
  scoped by `--force-with-lease` against the sha just fetched, and no
  local branch refs are created or moved.
- A resumed run re-walks completed waves as no-ops but still pays one
  `gh pr list`, a fetch, and an ancestor check per step.
- Prune reasons surface in the run summary; a pruned issue's branch and
  any open PR are left as-is for the operator to fix or for a re-run to
  retry.
