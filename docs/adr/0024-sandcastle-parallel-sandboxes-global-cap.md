# 24. Sandcastle: parallel sandboxes with a global concurrency cap

Date: 2026-07-31
Status: Accepted

Amends [ADR 0023](0023-sandcastle-wave-restack-pipeline.md), which built
the wave shape but deliberately kept one sandbox at a time. Resolves
[#64](https://github.com/lukefredrickson/personal-site/issues/64).

## Context

ADR 0023 landed an execution shape whose build phase is parallelizable
by construction: a wave's members are mutually independent, all cut from
the same base, and nothing orders them until the serial restack. Running
them one at a time was scaffolding — it let the wave path prove itself
equivalent to the sequential walk before any interleaving existed. This
ADR turns concurrency on. The binding resource (Docker containers, paid
agents) is machine- and budget-wide, not per-stack, so the limit must be
too.

## Decision

### One global sandbox pool, shared by all stacks and waves

A counting semaphore (FIFO, in `main.ts`) caps concurrently running
sandboxes at `SANDCASTLE_MAX_SANDBOXES` (default 3, any positive
integer — configuration is an env var, no code change). All stacks
launch at once via `Promise.all` and every build draws from this one
pool; a wave wider than the cap queues its members, which start in
level order as slots free up. The already-complete check (`gh pr list`)
runs before a slot is taken, so a resumed run's finished steps never
occupy the pool. Only sandbox creation-through-close holds a slot.

### Correctness never depends on scheduling

Three serialization points pin the outcome to what a cap-1 run
produces:

- **The wave barrier.** A wave restacks only after every member
  settles; restack order stays ascending issue number, so the chain a
  wave leaves is a function of *which* members succeeded, not of finish
  order.
- **Post-barrier prunes.** Build failures are collected and pruned
  after the barrier, in level order, so the pruned set and its recorded
  reasons are deterministic. Same-level steps never depend on each
  other, so no same-wave prune could have changed what a sibling built.
- **The restack lock.** The shared restack worktree has one HEAD and
  one index; a mutex (the same semaphore, one slot) serializes every
  stack's restack turn, trunk resolution, and fetches through it.

## Alternatives considered

- **Per-stack pools** — rejected: two stacks × cap 3 is six containers;
  the constrained resources are global.
- **Cap as a CLI flag or config file** — rejected for now: an env var
  is the smallest thing satisfying "configurable without code changes",
  and `run` takes no flags yet.
- **Parallel restacks via per-stack worktrees** — rejected: restack
  wall-clock is dominated by `npm run check`, which is CPU-bound, and
  concurrent `git fetch`/`npm install` in one repo invite lock
  contention. Serial restacks are the simplicity anchor the
  determinism argument rests on.
- **Async host-side git/check** — rejected: `execFileSync` inside the
  restack lock blocks the event loop, pausing other stacks'
  host-driven agent loops (the sandboxed processes themselves keep
  running). That costs wall-clock, not correctness, and keeps every
  restack atomic from the scheduler's point of view.

## Consequences

- Wall-clock for a wide wave drops toward (wave size / cap) × build
  time; the restack phases and the event-loop blocking above are the
  remaining serial sections.
- Sandbox and host log lines interleave across stacks; every host
  message names its issue and stack so the transcript stays
  attributable, but reading a single stack's story now means grepping.
- The cap trades money-per-hour for hours: raising it multiplies
  concurrent paid agents and containers. 3 is a laptop-friendly
  default, not a tuned number.
- A wave's slowest member gates its siblings' restack (the barrier);
  slot-level work-stealing across waves was deliberately not built.
