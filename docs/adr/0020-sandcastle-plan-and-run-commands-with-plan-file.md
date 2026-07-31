# 20. Sandcastle: plan and run commands with a persisted plan file

Date: 2026-07-31
Status: Accepted

Amends [ADR 0018](0018-sandcastle-sequential-stacked-pr-orchestration.md)
(retires its `--dry-run` seam) and
[ADR 0019](0019-sandcastle-one-stack-per-blocked-by-component.md).
Resolves
[#60](https://github.com/lukefredrickson/personal-site/issues/60).

## Context

Under ADR 0018/0019 the pre-flight is `--dry-run`: it prints the walk and
exits, and the paid run recomputes everything from the live backlog. The
printout and the execution are therefore two separate computations with the
backlog free to drift between them — what the operator reviewed is not, by
construction, what runs. The gap is small today (the walk is deterministic,
the backlog moves slowly) but it is structural, and it gets worse the
moment planning stops being a pure derivation: the roadmap has a judgment
agent proposing backlog *mutations* (splits, re-edges, re-scopes) before
execution. Proposals only make sense as an artifact the operator can
review, approve, and then execute *unchanged* — a flag on a single command
can't express that.

There is also no resume story. A failed run leaves branches behind and a
re-run happens to reconstruct the same walk only because planning is
deterministic and the backlog rarely moves mid-incident. Nothing pins the
resumed walk to the one that failed.

## Decision

### Two entry points, one persisted plan

`npm run sandcastle plan` computes the stacks, prints the human-readable
review (components, each stack's branch/base walk), and writes the result
to `.sandcastle/plan.json`. It makes no GitHub writes — planning is reads
only. Re-running `plan` overwrites the file; that *is* the replan gesture,
so there is no separate replan/refresh command.

`npm run sandcastle run` executes an existing plan file as-is, with **no
staleness check** — the file is the operator's approved proposal, and
second-guessing it would reintroduce the review/execute gap the split
exists to close. When no plan file exists, `run` plans automatically first
and then executes, so a single command still goes hog wild for the
plan-blind AFK case.

`--dry-run` retires; `plan` replaces it as both the pre-flight and the
verification path for changes to the planning logic.

### The plan file is the proposal contract

The file carries `stacks` (the walk) and `mutations` — **always empty at
this layer**. The empty list reserves the judgment agent's slot so the file
shape doesn't change when one arrives; today the only proposal a plan
carries is the stacks themselves. The file's *existence* is the marker that
planning ran: a plan with zero stacks means planning ran and found nothing
to change (running it prints exactly that and trivially succeeds), while a
missing file means no plan exists. The two states were indistinguishable
under `--dry-run`.

### Lifecycle: success consumes, failure retains

A fully successful run (no aborted stacks, no missing PRs — the existing
exit-0 condition) deletes the plan file: the proposal is spent, and the
next run must re-plan against the backlog the run itself changed. A failed
run keeps it, so a resume re-executes *identical* walks — branches that
already have commits pick their accumulated work back up via the existing
`createSandbox` resume behavior. The stale-plan risk this accepts is
bounded: the retained file describes the very walk whose branches are
already half-built, which is precisely the case where recomputing against
a moved backlog would be wrong.

## Alternatives considered

- **Keep `--dry-run`, add a confirm prompt to the run** — rejected: still
  two computations; a prompt narrows the drift window but can't close it,
  and it leaves proposals with no reviewable artifact.
- **Staleness check (hash the backlog into the plan, refuse on mismatch)**
  — rejected for now: it would block the resume-after-failure case, the
  one place a "stale" plan is most valuable. Replan is one command away.
- **Track per-step progress in the plan file** — rejected: branch state on
  GitHub already records progress, and `createSandbox` resumes from it;
  a second progress ledger could only disagree with the first.

## Consequences

- The review/execute gap closes: what `plan` printed is byte-for-byte what
  `run` executes.
- Failure recovery is pinned: resume re-runs the failed walk, not a fresh
  derivation against a possibly-moved backlog.
- The judgment agent has its seam: it will write `mutations` into the same
  file, and approval stays "run the plan file".
- New operator surface: a forgotten week-old plan file executes without
  complaint. Accepted — `plan` is cheap, its overwrite is explicit, and
  the run banner names the file it is consuming.
- `.sandcastle/plan.json` is gitignored: the plan is local run state, not
  repo content.
