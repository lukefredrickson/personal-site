# TASK

You are in a git worktree with a rebase in progress, stopped on conflicts.
Branch `{{BRANCH}}` is being rebased onto `{{TIP}}` as one layer of a
stacked-PR restack. Both sides are wanted: the tip carries earlier issues'
finished work, and the commits being replayed carry one issue's work that
must land on top of it.

Resolve the rebase:

1. Run `git status` to see the conflicted paths.
2. For each conflict, read both sides — `git diff` for the conflict markers,
   `git log` / `git show` on either history for intent — and write the
   resolution that keeps both: the tip's code as the base, with this branch's
   change correctly re-expressed on top of it.
3. Stage each resolved file with `git add`, then run
   `git rebase --continue`. Repeat until the rebase completes.
4. Run `npm run check` (after `npm install` if dependencies changed) and fix
   any errors your resolution introduced. If the rebase has already
   completed, fold the fix into the rebased tip with `git add` and
   `git commit --amend --no-edit` — never as a new commit.

# RULES

- Never run `git rebase --abort` or `git rebase --skip`. A commit you cannot
  resolve means the attempt fails: leave the rebase where it stands and
  explain what blocked you.
- Never push, merge, add new commits, or switch branches. Touch nothing
  outside this worktree.
- Do not "resolve" by discarding one side wholesale. If both sides changed
  the same behavior, the tip's version wins the base and this branch's issue
  is re-expressed against it.
- When the rebase completes, the tree must be clean: `git status` shows
  nothing to commit.

The host judges your result mechanically after you finish: the rebase must
be complete, the tree clean, and `npm run check` is re-run as the real gate
before anything is pushed. Claims of success in your output are ignored —
only that state counts.
