# 29. Walk specs through an injected effects boundary, not a fake `gh`

Date: 2026-08-02
Status: Accepted

Resolves the `gh`-seam design decision deferred to ticket
[#106](https://github.com/lukefredrickson/personal-site/issues/106) by
[#102](https://github.com/lukefredrickson/personal-site/issues/102).
Extends the test standard of ADR 0028 to the walk/resume state machine.

## Context

The walk (`walk.ts`) decides which steps re-run on resume, how prunes
propagate through the dependency graph, and when a step counts as
complete. Those decisions were entangled with effects, so no spec could
exercise them: `gh` invocations (PR queries, stack linking, base
retargeting), Docker sandbox builds via `@ai-hero/sandcastle`, and the
restack module's git surgery all ran inline in `runStack`.

The ticket framed the choice as PATH-shim fake `gh` binary vs. an
injected boundary, preferring the highest seam that lets specs assert on
walk decisions without a live GitHub.

## Decision

**Inject the walk's entire outward surface, not just `gh`.** A
`WalkEffects` interface in `walk.ts` carries every effect `runStack`
performs — `openPrUrl`, `linkPrStack`, `retargetPrBase`,
`buildInSandbox`, and the restack module's five operations (which close
over the shared worktree, so "restacking owns git" stays structural).
`productionWalkEffects(worktree)` is the real wiring; `WalkContext`
carries the effects object instead of a worktree path.

The PATH shim was rejected on one deciding fact: `gh` is only one of
three effect families in the walk. A fake `gh` on PATH still leaves
`runStack` unable to run in a test — it would create real Docker
sandboxes, run paid agents, and rebase real branches. Fakes for the
sandbox and restack layers would be needed anyway, and once an injection
point exists for those, routing `gh` through a shell script that
communicates via files and env vars buys only indirection: scripted
behavior with no types, assertions by parsing a log, and races between
parallel test files sharing a PATH.

Specs (`walk.test.ts`) drive `runStack` with a scriptable fake and
assert on decisions and outputs — which branches got sandboxes, what
was pruned and why, what the `StackOutcome` reports — per ADR 0028's
standard, never on internal call sequencing.

## Consequences

- The walk's decision logic — resume selection, the ancestry-gate
  interaction, prune closure and carrier contamination, chain reshaping
  after prunes, completion by open PR — is pinned by fast specs needing
  no network, Docker, or GitHub.
- The untested residue is the production adapters — mostly one `gh` or
  library invocation each (including the "closed and merged PRs don't
  count" filter, which lives in `openPrUrl`'s `--state open` argument),
  plus one real decision that crossed the boundary: `buildInSandbox`
  now owns the "only review if the implementer produced commits"
  conditional, so no spec can pin it. They stay reviewable by eye, and
  the live run exercises them — the same line ADR 0028 drew around
  end-to-end coverage.
- The walk gained a small indirection layer; anyone adding an effect to
  the walk must add it to `WalkEffects` and both wirings. The interface
  doubles as an inventory of everything the walk can do to the world.
