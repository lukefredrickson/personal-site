# 25. Sandcastle: resolver agent for rebase conflicts during restack

Date: 2026-07-31
Status: Accepted

Amends [ADR 0023](0023-sandcastle-wave-restack-pipeline.md) (a conflicting
rebase now gets one resolver-agent attempt before prune-on-conflict takes
over). Resolves
[#65](https://github.com/lukefredrickson/personal-site/issues/65).

## Context

ADR 0023 prunes any step whose rebase onto the chain tip conflicts, along
with its dependency-descendants. That is safe but blunt: wave siblings
build blind to each other, so shallow textual conflicts (both touched the
same import block, adjacent config lines) are common, and each one costs a
whole subtree plus a rebuild on the next run. Most such conflicts are
mechanical for an agent reading both sides. What must not change is the
failure contract: a conflict that cannot be fixed — or a fix that breaks
`npm run check` — has to degrade into exactly the pruning ADR 0023
specified, with origin untouched.

## Decision

When `git rebase` stops on a conflict, the restack gives a resolver agent
one attempt before pruning. Three properties define the design:

- **It runs on the host, in the restack worktree, on the in-progress
  rebase.** The mid-rebase state exists only there; a fresh sandbox would
  have to redo the rebase itself and self-certify the result, moving push
  authority into the agent. Containment reuses the planning agent's
  mechanism (ADR 0021): `claude -p`, where every tool call outside
  `--allowedTools` is auto-denied. The agent can read, edit, `git add`,
  `git rebase --continue`, amend the rebased tip, and run the check;
  push, `rebase --abort`, and `rebase --skip` are denied.
- **Host code judges the result mechanically; agent claims are ignored.**
  A resolution counts only if the rebase is finished, the tree is clean,
  HEAD descends from the chain tip, and the host's own
  `npm install` + `npm run check` gate — the same gate every rewritten
  tip passes — succeeds. Only then is the branch force-pushed and the
  chain advanced as if no conflict occurred.
- **Failure is indistinguishable from ADR 0023.** Any failed attempt
  aborts the rebase and hard-resets the worktree; nothing was pushed on
  any failure path, so origin still holds the pre-restack branch and the
  step prunes with the standard semantics, its reason naming how the
  attempt ended. The run log and summary mark agent-resolved steps
  (distinct from restacked and pruned ones) so the owner can audit those
  resolutions — they contain code the agent authored, not just replayed
  commits.

The attempt runs under the restack lock it inherited, serializing other
stacks' restacks for its duration (bounded by a 30-minute timeout), and
takes no sandbox-pool slot — the pool caps docker containers, and this is
host work the lock already serializes.

## Alternatives considered

- **Resolve in a docker sandbox on the conflicted branch** — rejected: the
  sandbox cannot inherit the in-progress rebase, so the agent would redo
  the rebase and have to push its own result, putting the gate and the
  force-push behind agent claims. Guaranteeing "no half-resolved state on
  origin" would then require the host to restore the branch after a bad
  push instead of never pushing.
- **Retry with N attempts or escalating models** — rejected: one attempt
  keeps the latency bounded and the semantics simple; a conflict that
  survives a full agent attempt plus the check gate is exactly the case
  the owner should see as a prune.
- **Let the resolver skip unresolvable commits (`git rebase --skip`)** —
  rejected: skipping silently drops a commit from the issue's work; a
  branch either joins the chain whole or prunes.
- **Have the resolver push after its own check** — rejected: the check
  gate is only trustworthy if the host runs it, and push-after-gate is
  what makes failure cleanup a no-op.

## Consequences

- A conflicted restack now costs up to one agent run (30-minute cap)
  before pruning, and it blocks other stacks' restack turns while the
  lock is held — build phases keep running. The prior behavior returns by
  making the attempt fail fast (e.g. an unresolvable conflict).
- Agent-resolved tips contain authored resolution code gated only by
  `npm run check` and PR review. The summary's audit markers exist so
  that review actually happens.
- The resolver runs `claude` on the host with the operator's credentials,
  like the planning agent — but with write access to the restack
  worktree. The allowlist is the containment boundary.
