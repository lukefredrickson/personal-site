# 22. Sandcastle: resume from partial runs via open-PR completion marker

Date: 2026-07-31
Status: Accepted

Amends [ADR 0018](0018-sandcastle-sequential-stacked-pr-orchestration.md)
(a step with an open PR is now skipped rather than re-run). Resolves
[#62](https://github.com/lukefredrickson/personal-site/issues/62).

## Context

Under ADR 0018 a failed or commit-less step aborts its stack, and ADR 0020
retains the plan file so the run can be re-executed. But re-execution was
naive: every step re-ran its sandbox, including steps whose PRs were
already open. A resume after a one-step failure in a five-step stack paid
for four redundant agent runs — and each redundant implementer, dropped
onto a branch whose work is done, is an unpredictable no-op at best.

There was also a known flake: a step could push commits but fail at
`gh pr create`, leaving a branch with work and no PR. The host warned but
had no repair path.

## Decision

### The open PR is the completion marker

Progress lives on GitHub, not in local state — the plan file records
*intent*, never progress. Before creating a step's sandbox, the host asks
GitHub for an open PR on the step's branch. If one exists the step is
complete: its sandbox is skipped, but the step stays in the walk so its
successor still chains from its branch. A re-run therefore resumes each
incomplete stack at its first PR-less step, and a fully-completed stack
performs no sandbox work at all.

Only an **open** PR counts. A merged PR means the layer has landed and its
successor should retarget via the normal review flow; a closed-unmerged PR
means the work was rejected. Neither should silently mark a step done.

### Commits without a PR mean incomplete

A branch with commits but no PR re-runs. `createSandbox` ignores
`baseBranch` when the branch exists, so the sandbox picks up the pushed
work, the implementer finds the issue already done, and the step
effectively just opens the missing PR — the flake self-heals on resume.
The host-side post-step verification now uses the same open-PR test as the
skip check, so "complete" has one definition everywhere.

## Alternatives considered

- **Record progress in the plan file** — rejected: local state lies the
  moment a run dies mid-step or a PR is opened or closed by hand. GitHub
  is already the source of truth for the walk's *output*; making it the
  source of truth for progress means there is nothing to keep in sync.
- **Branch existence as the marker** — rejected: it marks the flaked
  push-without-PR case complete, which is exactly the case that needs
  re-running.
- **Merged PRs also count as complete** — rejected for now: the branches
  a merged step's successors chain from still exist, but base retargeting
  after a merge belongs to the review flow, not the walk.

## Consequences

- Re-running `npm run sandcastle run` after a partial failure is cheap
  and safe: completed work is never re-executed, only verified with one
  `gh pr list` call per step.
- Closing a PR without merging silently re-queues its step on the next
  run — that is the desired reading of "rejected", but it is implicit.
- The skip trusts the PR's existence, not its content: a PR opened on a
  stale or wrong-base branch still counts as complete. The bottom-up
  review is the catch for that.
