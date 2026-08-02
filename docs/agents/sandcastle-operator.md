# Sandcastle: operator gestures

What the operator does around a Sandcastle run. The design record is
[ADR 0018](../adr/0018-sandcastle-stacked-pr-orchestration.md); this page
is only the hands-on-keyboard part.

## Who owns `sandcastle/*` refs

The factory does — local and origin both. During a run, every restack
force-push also moves the matching local branch when it points at exactly
the pre-rewrite sha and is not checked out anywhere (git's
compare-and-swap `update-ref`, the same lease discipline as the
force-push). A branch that fails the lease — you committed on it, or you
have it checked out — is skipped with a printed warning and the exact
recovery command, and every move is named in the run summary. So: local
`sandcastle/*` branches you never touched are always current after a run;
ones you touched are always yours.

## After merging a PR (bottom of a stack)

Merging the bottom PR closes its issue and retargets the next PR onto
`main`. Before doing anything else with the stack locally:

1. **Fetch** — `git fetch origin` (updates `origin/*`; never moves local
   branches).
2. **Let locals follow origin** — for each remaining `sandcastle/*`
   branch you have locally and did not modify:

       git branch -f sandcastle/issue-<n> origin/sandcastle/issue-<n>

   Skip any branch you committed on; reconcile those by hand.
3. **Then rebase the stack** — `gh stack rebase` (or `gh stack sync`)
   from a checkout of the top branch.

Step 2 is the one that was missing in run 1: rebasing from stale local
refs re-derives every conflict origin already resolved. With the run-time
local-ref sync this gesture is rarely necessary — it matters when a
branch failed the lease during the run, or when you created local
branches (e.g. `gh pr checkout`) after the run finished.

## When a run warns about a skipped local ref

The warning carries the recovery command; the usual shape is

    git fetch origin && git branch -f <branch> origin/<branch>

Run it only if the divergence is not work you meant to keep — the skip
exists precisely because the factory will not overwrite your commits.
