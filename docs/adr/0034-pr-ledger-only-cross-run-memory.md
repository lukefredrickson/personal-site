# 34. The PR ledger is the walk's only cross-run memory

Date: 2026-08-07
Status: Accepted

Amended by
[36. Sandcastle: the draft PR opens only after the reviewer pass](0036-pr-opens-after-reviewer-pass.md):
the verdict rule is unchanged, but "open PR" now also asserts a
completed reviewer pass.

Implements issue
[#162](https://github.com/lukefredrickson/personal-site/issues/162).
Extends ADR 0018's resume semantics and rides the `WalkEffects`
boundary of ADR 0029.

## Context

After a real run, the operator merged some PRs, closed others as
rejected, and timeouts left a few branches with no PR at all. The
resume logic misread every one of those aftermaths, because its only
completion signal was an *open* PR: a merged PR whose issue missed its
closing keyword got rebuilt from scratch; a closed PR's branch was
resumed by the next sandbox, which found the rejected work "done" and
re-opened a PR containing exactly what the operator threw out; and a
PR-less branch from a dead run was trusted as progress. Closing a PR
was not a rejection gesture — the work came back.

The old behavior being traded away is "branch exists → resume its
accumulated work across runs".

## Decision

**Make the PR ledger — every PR whose head is a step's branch, in any
state — the walk's only cross-run memory; branch contents are never
trusted.** The ledger is fetched once per step at step start
(walk time, not plan time) and yields one verdict. An open PR always
wins: complete, sandbox skipped, restack no-ops (unchanged). Otherwise
the newest PR by creation date decides: **merged** → complete, skipped,
left out of the chain (its work already sits in its base), and its
still-open issue is auto-closed with a comment naming the PR;
**closed** → the operator rejected the work. A rejected branch, or a
branch with commits but no PR, is a **stale branch**: its origin and
local refs are deleted (a named restack operation — local first, so a
checked-out refusal aborts before origin is touched) and the step
rebuilds fresh under the same deterministic name. No branch, no PRs →
plain fresh build. Merged-but-inadequate work is redone via a
follow-up issue, never by reopening.

Mid-run behavior is unchanged: a flaked `gh pr create` still warns and
restacks within its run. Four effects join `WalkEffects`: `prLedger`,
`originBranchExists`, `deleteStaleBranch`, `closeIssueWithComment`.

## Consequences

- Rejection by closing a PR now works: the next run deletes the branch
  and rebuilds fresh; the rejected history survives in its closed PRs.
- Branches are disposable. Deleting refs is routine, not destructive —
  nothing is ever resumed from branch contents across runs.
- A build whose `gh pr create` flaked gets one redundant rebuild on the
  next run (no PR → stale). Accepted: rare, and cheaper than trusting
  debris.
- The run now performs one issue write — closing a merged-PR's
  still-open issue with a comment — healing a missed closing keyword
  and keeping the tracker honest.
- "Merged but not enough" has exactly one gesture: file a follow-up
  issue. Reopening a merged PR's issue is no longer a signal; the run
  will close it again.
