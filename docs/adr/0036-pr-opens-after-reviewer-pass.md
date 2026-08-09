# 36. Sandcastle: the draft PR opens only after the reviewer pass

Date: 2026-08-08
Status: Accepted
Amends: ADR 0018 (build sequence) and ADR 0034 (what an open PR asserts —
the verdict rule itself stands)

Implements issue
[#176](https://github.com/lukefredrickson/personal-site/issues/176).
Rides the `WalkEffects` boundary of ADR 0029.

## Context

PR #168 reached the operator's review queue with no reviewer pass: its
reviewer log predated the implementation by a day. Two structural gaps
allowed this. The reviewer only ran when the implementer produced new
commits in the current run, so a run resumed after a crash — work
already committed, implementer adds nothing — silently skipped it. And
the implementer itself opened the draft PR, while the ledger (ADR 0034)
reads any open PR as "complete" — so a run that died between PR
creation and the reviewer pass left a PR the factory would never
review, on any run. The operator could not tell a reviewed PR from an
unreviewed one without reading log timestamps.

## Decision

**Make "open PR" mean "implemented and reviewed": the walk sequences
implement, then review, then PR creation by the host.** The single
build effect splits in two on the `WalkEffects` boundary —
`implementInSandbox` and `reviewInSandbox` — each owning its own
sandbox lifecycle; the review sandbox re-enters the branch with the
implementer's commits. Neither agent pushes or opens a PR any more.

After the implement effect the host pushes the branch and asks the
existing branch-carries effect what the branch holds ahead of the wave
base. Nothing ahead trips the prune-on-empty tripwire (ADR 0018), now
keyed on branch state rather than this run's commit count — so a
crash-resumed step whose implementation already exists proceeds to
review instead of being pruned as "produced no commits". Otherwise the
reviewer runs; a reviewer failure prunes the step before any PR
exists. After the review the host pushes the reviewer's commits and
opens the draft PR itself, based on the wave base (the post-restack
retarget is unchanged).

The implementer still writes the PR body: it emits it between
`<pr-body>` stdout markers — the same channel as the
missing-dependency report, so the host adapter stays thin and no file
survives the sandbox. The host guarantees the `Closes #N` keyword and
titles the PR from the issue. A failed PR creation warns and the
branch still restacks; the recovery is one manual `gh pr create`.

Rejected alternative: keep the implementer-opened PR and record the
reviewer pass as durable GitHub state (a review or marker), with
resume finishing review on unreviewed open PRs. That grows the ledger
from one bit to two, adds a marker an agent could lose or forge, and
still shows the operator unreviewed PRs between runs.

## Consequences

- Every crash window resolves correctly on re-run. Before the first
  host push nothing is on origin: the ledger reads fresh, the sandbox
  library resumes the local branch, and the reviewer decision still
  fires — the cheap resume. From that push until the PR exists — a
  window that spans the whole review pass — the branch is PR-less on
  origin, so the stale rule (ADR 0034) deletes and rebuilds it: a full
  rebuild, correct but not cheap. Accepted rather than widening the
  ledger; the origin-based branch-carries probe forces the early push.
- The reviewer's commits now land before the PR exists, so the PR's
  opening diff already includes them.
- An empty build now leaves a pushed branch equal to its base; the
  next run's stale rule collects it.
- The ledger's one-bit verdict is unchanged but truthful: an open PR
  in the operator's queue has always survived one adversarial read.
