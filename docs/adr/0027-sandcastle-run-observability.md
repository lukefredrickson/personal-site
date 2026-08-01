# 27. Sandcastle: quiet host agents, per-wave stack linking

Date: 2026-08-01

Status: Accepted

Extends [ADR 0018](0018-sandcastle-stacked-pr-orchestration.md).

## Context

Two frictions surfaced operating the first full run (#42–52), both about
when the run shows its work rather than what it does.

**Host agents flood the console.** Sandboxed implementers and reviewers
print three lines — a start line, a `tail -f` pointer, an outcome — and
keep their play-by-play in a log file. The host-run agents (planner,
resolver) instead narrate every tool call to the console. Eight resolver
attempts in one run put hundreds of interleaved progress lines between
the restack messages that actually track the chain; ADR 0018 already
conceded "reading one stack's story means grepping the transcript", and
this made it worse for no gain — the lines exist to prove liveness, which
a tailable file proves just as well.

**The stack links only at run end.** `gh stack link` ran once, after
every wave of every stack. During the multi-hour AFK window the PRs sat
on GitHub base-chained but unlinked — no stack UI, no bottom-up ordering
— even though the bottom waves were finished and reviewable hours before
the top ones built.

## Decision

**Host agents log like sandboxed agents.** `runHostAgent` writes its
compact progress lines to a `.log` file beside the raw `.jsonl` stream
and prints only the sandbox-style trio: `[role] Started (model)`, the
`tail -f` pointer, and the ✓/✗ outcome. Watching a resolver work is now
opt-in per agent, and the console reads as one line per chain event.

**Link the chain after every wave.** `runStack` tracks the steps in the
order they join the chain and calls `gh stack link` with that full
membership as soon as a wave's restack completes. `link` refuses partial
updates, so passing the whole chain-so-far each time is the same
idempotent gesture ADR 0018 chose for run end — it creates the stack at
wave one and grows it thereafter. The run-end link is kept as the
settling pass: it re-links with final membership, and only *its* failure
retains the plan and fails the run. A per-wave link failure is a warning;
the known case is a resume, where the existing stack already holds PRs
above the current wave and gh correctly refuses the subset.

## Alternatives considered

- **Silence host agents entirely** — rejected: a resolver holds the
  restack lock for up to 30 minutes; with no start line and pointer, a
  quiet console is indistinguishable from a hang.
- **Link per restacked branch instead of per wave** — rejected: inside a
  wave the chain changes every few seconds and each link is a GitHub
  round-trip; the wave barrier is the natural "the chain grew" moment.
- **Drop the run-end link now that waves link** — rejected: per-wave
  links warn-and-continue by design, so something must guarantee the
  final membership and own the failure semantics. Keeping run end as the
  authoritative pass preserves ADR 0018's contract unchanged.

## Consequences

- Host-agent logs double (a `.log` beside each `.jsonl`); both are
  gitignored run state.
- Reviewers can start on a stack's bottom PRs mid-run; the stack number
  appears after wave one instead of at exit.
- Each wave spends one `gh stack link` round-trip per multi-PR stack;
  resumes print one expected warning per already-linked stack until the
  chain catches up to the prior run's membership.
