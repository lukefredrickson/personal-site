# 18. Sandcastle: stacked-PR orchestration

Date: 2026-07-31

Status: Accepted

Amended 2026-08-02 by
[#99](https://github.com/lukefredrickson/personal-site/issues/99) after the
first backlog run: replay-window restacks, the resume ancestry gate, rerere,
factory-owned local `sandcastle/*` refs, and the missing-dependency
tripwire. The amendments are integrated into the sections below.

Resolves [#57](https://github.com/lukefredrickson/personal-site/issues/57),
[#59](https://github.com/lukefredrickson/personal-site/issues/59)–
[#65](https://github.com/lukefredrickson/personal-site/issues/65), and
[#76](https://github.com/lukefredrickson/personal-site/issues/76).
Reshapes the Sandcastle setup landed in
[#17](https://github.com/lukefredrickson/personal-site/pull/17) before its
first real run over the build backlog (#42–52). This ADR is the single
record of the design: the seven ADRs that iterated toward it (one per
issue above) are consolidated here and deleted, as are ADRs 0026–0027
(the hardening that followed the first full run: the lockfile integrity
gate, host-agent log files, and per-wave stack linking). All those
numbers are retired — the next ADR is 0028 — and the original files
remain recoverable via git history.

## Context

The committed Sandcastle template (parallel planner with review) merges
agent branches directly into the local branch and closes issues from
inside the sandbox. Run against the build backlog, that would bypass
everything this repo's working agreement hangs on: no pull requests means
no diff review (the learning contract's centerpiece), no CI typecheck
gate, and no per-PR preview URLs — which every build issue's done-when
cites.

The owner wants two things at once: full AFK execution of the whole
backlog, and per-issue review granularity. Waiting to merge each PR
before the next issue builds would forfeit AFK; one mega-PR would forfeit
the per-issue lesson. GitHub's stacked-PR model resolves the tension:
each issue's branch is cut from its predecessor's tip and each draft PR
is based on the branch below it, so review stays per-issue while nothing
waits for a merge. The rest of the design is about deriving the right
stacks from the backlog, executing them quickly and deterministically,
and surviving partial failure.

## Decision

### Two commands, one persisted plan

`npm run sandcastle plan` computes the stacks, prints the human-readable
review, and writes `.sandcastle/plan.json` — reads only, no GitHub
writes. `npm run sandcastle run` executes an existing plan file as-is,
with no staleness check: the file is the operator's approved proposal,
and what `plan` printed is byte-for-byte what `run` executes. With no
plan file, `run` plans first, so a single command still covers the
plan-blind AFK case. Re-running `plan` overwrites the file — that is the
replan gesture; there is no separate refresh command.

A fully successful run deletes the plan (the proposal is spent; the next
run must re-plan against the backlog the run itself changed). A failed
run retains it, so a resume re-executes identical walks rather than a
fresh derivation against a possibly-moved backlog. The plan records
intent, never progress. `.sandcastle/plan.json` is gitignored — local
run state, not repo content.

### A planning agent proposes edges; host code disposes

Grouping and ordering are pure functions of GitHub's native blocked-by
graph over the open `Sandcastle`-labeled issues — which makes the
graph's accuracy load-bearing, and the owner rarely draws every real
edge. `plan` therefore runs a judgment agent (`claude -p`, model
claude-fable-5) that reads the issues, the repo, and whatever else it
needs — fanning exploration out to subagents so its own context stays
for judgment — and returns proposed blocked-by additions and removals,
one reasoning sentence each. It has no write authority, enforced by the
harness rather than the prompt: every tool call outside a read-only
allowlist is auto-denied.

Host code (`screenMutations` in `stack.ts`, pure) screens the proposal
mechanically: a mutation referencing an issue outside the walk, or an
addition that would create a cycle, is dropped with a logged reason. No
LLM validates the LLM. Survivors are persisted in the plan file and
printed with their reasoning (removals bold — a removal un-gates work
while an addition merely serializes it), and the stacks are derived from
the graph as amended, so the plan the owner reviews already reflects the
proposal. `run` applies the mutations to GitHub — the only writer —
idempotently, before walking; a failure while applying aborts the run
and retains the plan. The owner's veto is reviewing the plan and not
running it.

### One stack per blocked-by component, level-major order

`planStacks` (pure, in `stack.ts`) partitions the amended graph into
connected components — undirected: two issues are related if either
blocks the other, directly or transitively — and chains each component
from `main` into its own stack. A one-issue component is a plain
standalone PR. Nothing tagged is excluded; grouping replaces
gatekeeping. Unrelated issues never carry each other's diffs in their
PR bases, and one component's failure cannot touch another's run.

Within a component the chain order is level-major: topological levels of
the blocked-by graph, ascending issue number within a level — a
deterministic topological order with no LLM judgment in the control
loop. Execution restacks level by level, so the chain order and the
wave-built chain coincide by construction. Stacks are ordered by their
lowest member's issue number. Validation aggregates into a single throw:
an open blocker outside the walk and a cycle among members are both
errors, reported together so the operator fixes everything in one pass.

### Wave execution: parallel builds, serial restack, prune-on-conflict

Each stack executes level by level. Every issue in a level builds in its
own Docker sandbox on `sandcastle/issue-<n>`, cut from the same base —
the current chain tip — so each wave builds on every earlier level even
though nothing has merged. The implementer (claude-opus-5, gated on
`npm run check`) pushes the branch and opens a draft PR with stock `gh`;
if it produced commits, a reviewer runs in the same sandbox. All stacks
launch at once, and every build draws from one global sandbox pool — a
FIFO counting semaphore capped at `MAX_SANDBOXES` (a plain constant, 3;
an env-var override existed briefly and was removed as unused knob
machinery). The binding resources (containers, paid agents) are machine-
and budget-wide, so the limit is too.

After the whole wave settles, the level restacks serially in ascending
issue-number order, in a throwaway host worktree under a lock (the
worktree has one HEAD and one index, shared by all stacks): each branch
rebases onto the growing chain, a rewritten tip is gated and then
force-pushed with `--force-with-lease`, and its PR base retargeted to
its actual predecessor, keeping review diffs per-issue. The rebase is a
replay window — `git rebase --onto <tip> <wave-base sha>` — so only
commits the branch itself added on top of the base it was built from
ever replay. A plain rebase replays back to the merge-base, and run 1
showed what that costs: once a resolver rewrote a predecessor's commit,
patch-identity broke and every downstream branch re-fought the same
conflict, six restacks in a row. The window also keeps each PR's commit
list per-issue — no re-replayed predecessor commits. The gate is
two tests. `npm ci --dry-run` proves the committed lockfile satisfies
`package.json` on every platform — the same test CI's clean install
applies per PR, moved before the push, because a lockfile regenerated
against an installed `node_modules` tree silently drops other
platforms' optional binaries ([npm/cli#4828]) and otherwise fails only
in CI; the first full run shipped seven PRs that way. Then
`npm run check` — the semantic-drift tripwire for siblings that built
blind to each other. (The gate's own dependency install can perform
the same #4828 rewrite in the worktree; HEAD is already committed so
it can never be pushed, and the worktree lockfile is restored from
HEAD so it cannot dirty the next branch's switch.) A branch already
descending from the tip is a detected no-op: nothing rewritten, no
re-check (that exact tree was already gated).

[npm/cli#4828]: https://github.com/npm/cli/issues/4828
Three serialization points — the wave barrier, post-barrier prunes in
level order, and the restack lock — pin the outcome to what a cap-1 run
produces: the final branches, bases, and PR chains never depend on which
sandbox finished first.

A step that cannot join the chain — commit-less or crashed build,
unresolvable rebase conflict, failed check at its rewritten tip — is
pruned together with its dependency-descendants; siblings and later
issues that never depended on it keep building and restack onto the last
good tip. One prune reaches further: a branch whose history contains a
step this run pruned is pruned too — rebasing it would smuggle the
pruned commits into its own PR — and a re-run rebuilds it clean. Pruned
branches and their open PRs are left as-is for the operator or a re-run.
The run exits non-zero if anything was pruned, with a per-stack summary
naming what chained, what pruned, and why.

### A resolver agent gets one attempt at conflicted rebases

Wave siblings build blind to each other, so shallow textual conflicts
are common and mostly mechanical. rerere gets the first look: it is
enabled for the restack worktree's git only (per-invocation flags and
environment, never config files, so the operator's own git behavior is
untouched), records every conflict resolution, and replays it when the
same hunk conflicts again — with `rerere.autoupdate` staging what it
recognizes. When a stop leaves nothing unmerged, the host finishes the
rebase itself with `rebase --continue`, no agent and no tokens; the
recorded resolutions land in the repo's shared rr-cache, so re-runs
benefit too. Only a genuinely new conflict reaches the resolver agent
(claude-opus-5), which runs on the host, in the restack
worktree, on the in-progress rebase — the mid-rebase state exists only
there; a fresh sandbox would have to redo the rebase and self-certify
the result. Containment is the same harness mechanism as the planning
agent's: it can read, edit, `git add`, `git checkout --ours`,
`git restore`, `git rebase --continue`, amend the rebased tip, and run
npm installs and checks; push, `rebase --abort`, and `rebase --skip`
are denied. The prompt carries the lockfile recipe — never resolve
`package-lock.json` by hand; take the tip's version and finish with
`npm install --package-lock-only`, which rebuilds from `package.json`
alone — and states the chain rule: the harness matches each Bash call
against single-command patterns, so a `&&` chain of individually
allowed commands is denied as a whole. That denial is exactly how the
first run's lockfile corrupted: the resolver's safe compound was
refused and its allowlisted fallback, plain `npm install`, performed
the #4828 rewrite. The division of labor is prompt-improves-the-odds,
harness-guarantees-the-outcome — a resolver that ignores the recipe
still cannot push a lockfile the `npm ci --dry-run` gate rejects.
Host code judges the result mechanically — rebase finished, tree
clean, HEAD descends from the chain tip, and the host's own two-part
gate passes — and only then force-pushes; agent claims are ignored. Any failed attempt aborts the rebase and hard-resets the
worktree; nothing is pushed on any failure path, so origin still holds
the pre-restack branch and the step prunes with standard semantics. The
attempt holds the restack lock (bounded by a 30-minute timeout) and
takes no sandbox-pool slot. The run log and summary mark agent-resolved
steps distinctly, so the owner audits resolutions in review — they
contain code the agent authored, not just replayed commits.

### Resume: an open PR is the completion marker

Progress lives on GitHub, not in local state. Before creating a step's
sandbox, the host asks for an open PR on the step's branch; if one
exists the step is complete — sandbox skipped, restack a detected no-op
— but it stays in the walk so its successor still chains from its
branch. Only an open PR counts: a merged PR means the layer landed and
its successor retargets via the normal review flow; a closed-unmerged PR
means the work was rejected. A branch with commits but no PR is
incomplete and re-runs: the sandbox picks up the pushed work (the
branch's existence overrides its base assignment), the implementer finds
the issue done, and the step effectively just opens the missing PR — the
push-without-PR flake self-heals. Host-side post-step verification uses
the same open-PR test, so "complete" has one definition everywhere. A
re-run of a retained plan therefore resumes each incomplete stack at its
first PR-less step, paying only one `gh pr list` call per finished step.

Reuse is gated on ancestry. The sandbox library reuses an existing
branch as-is, and run 1 showed how that turns toxic: branches inherited
from a dead run carried pre-restack ancestry into every wave. Before a
step's sandbox is created, the host checks that the branch's existing
refs (local and origin) descend from the step's assigned base. A ref
that fails the check is treated as absent and reset to the base — origin
through the normal lease force-push, the local ref through the same
compare-and-swap the local-ref sync uses — so the sandbox rebuilds
fresh from the correct base and the old history is overwritten. A local
branch that descends from the base is accumulated work and is kept
(origin resets to it instead); a stale local ref that is checked out
somewhere, or that matches neither origin nor the base, is operator
state the gate refuses to touch — the step prunes with the recovery
command in its reason.

### Agent environment

The agents' gate is `npm run check`; the repo intentionally has no test
runner and the prompts forbid adding one. `CODING_STANDARDS.md` is a
fully self-contained rule sheet loaded by the implementer and reviewer.
A repo-level `.mcp.json` registers the Astro docs MCP so sandboxed
agents inherit it.

### Run output: linked stacks, a readable console

The run's deliverable is a set of GitHub stacks, not just base-chained
PRs. The host binds each multi-PR stack with the `gh-stack` CLI:
`gh stack link <PRs bottom-to-top>`, passing the full chained
membership — `link` refuses partial updates, so the full set both
creates a new stack and updates an existing one, making re-linking
idempotent and keeping a prune-reshaped chain's stack current.
Linking happens wave by wave: as soon as a wave has fully restacked,
the chain-so-far is linked, so the stack exists on GitHub — bottom PRs
reviewable in stack order — while later waves are still building,
instead of only at run end. A per-wave link failure is a warning (the
known case is a resume, where the existing stack already holds PRs
above the current wave and gh correctly refuses the subset); a final
run-end pass re-links every stack with its finished membership, and
only that pass's failure warns and exits non-zero with the plan
retained, like a missing PR — the next run skips completed work and
just re-links. Standalone PRs need no link. The extension is host-side
only — sandboxed agents never run `gh stack` (it is not in the agent
image), and `gh stack view` cannot verify the links, since it reads
local tracking state while `link`-created stacks live on GitHub.

Host-run agents (planner, resolver) log like the sandboxed ones: the
console carries a start line, a `tail -f` pointer, and the ✓/✗ outcome,
while the per-tool-call play-by-play goes to a tailable `.log` beside
the raw `.jsonl` event stream. Watching an agent work is opt-in per
agent, the start line and pointer keep a 30-minute resolver hold
distinguishable from a hang, and the console stays one line per chain
event even with stacks interleaving.

Nothing merges branches or closes issues: the owner reviews each stack
bottom-up, and merging a PR closes its issue via the closing keyword in
the PR body. Branch protection evaluates against `main`, so the
required typecheck check guards every layer despite intermediate bases.

## Alternatives considered

- **Merge-per-wave (stock template behavior), review after the fact** —
  rejected: review after merge is no gate at all.
- **One linear stack over the whole backlog** — rejected: unrelated
  issues would carry each other's diffs and one flake would forfeit the
  rest of an AFK run. The blocked-by components already say what is
  actually related.
- **A `--dry-run` flag instead of the plan/run split** — rejected: the
  printout and the execution would be two computations with the backlog
  free to drift between them, and agent proposals need a reviewable
  artifact the operator approves and then executes unchanged.
- **The planning agent writes edges directly** — rejected: no reviewable
  artifact, no veto, and an LLM with `gh` write access is one bad tool
  call from mangling the tracker.
- **Recording progress in the plan file** — rejected: local state lies
  the moment a run dies mid-step or a PR is opened or closed by hand.
  GitHub already records the walk's output; making it also the source of
  truth for progress leaves nothing to keep in sync.
- **Integration branches or octopus merges per level** — rejected: the
  deliverable is one linear chain of per-issue PRs; anything else
  forfeits the review granularity the whole system exists for.
- **Resolving conflicts in a sandbox, or with N retries** — rejected: a
  sandbox cannot inherit the in-progress rebase, so it would redo the
  rebase and push behind its own claims; one attempt keeps latency
  bounded, and a conflict that survives a full attempt plus the check
  gate is exactly the case the owner should see as a prune.
- **Guarding the lockfile some other way** — denying the resolver plain
  `npm install` (it legitimately needs the install before its own
  check), grepping for sentinel platform entries (encodes today's
  dependency names, misses other drift), having the host regenerate the
  lockfile after every resolution (a silent rewrite of agent-authored
  state — the mutation the audit markers exist to avoid), or swapping
  the gate's incremental install for a full `npm ci` (minutes per
  branch where the dry run costs seconds) — all rejected.
  `npm ci --dry-run` is authoritative because it is what CI runs.
- **Silencing host agents entirely** — rejected: a resolver can hold
  the restack lock for up to 30 minutes; with no start line and
  pointer, a quiet console is indistinguishable from a hang.
- **Linking per restacked branch, or dropping the run-end link** —
  rejected: inside a wave the chain moves every few seconds and each
  link is a GitHub round-trip, so the wave barrier is the natural "the
  chain grew" moment; and per-wave links warn-and-continue by design,
  so the run-end pass must own the final membership and the failure
  semantics.

## Consequences

- One AFK run leaves linked per-component stacks of draft PRs; merging a
  bottom PR auto-retargets and rebases the rest server-side, re-running
  CI.
- A re-run that prunes a previously linked step can make the link update
  refuse (removing a member needs the full remaining set); this surfaces
  as a link failure for the operator to resolve.
- The stacking tax: changes requested on a middle PR force a rebase of
  everything above (`gh stack sync` automates the mechanics; the
  mostly-disjoint files across build issues keep conflicts rare).
- Restacking rewrites published `sandcastle/*` branches. Force-push is
  scoped by `--force-with-lease` against the sha just fetched. Local
  `sandcastle/*` refs are owned by the factory (this amends the original
  "no local branch refs are created or moved" invariant, which run 1
  proved to be a trap: the sandbox library creates local branches as a
  side effect of its worktrees, `git fetch` never moves them, and the
  operator's later stack rebase re-derived sixty files of conflicts that
  origin had already resolved). After each force-push, a matching local
  ref moves under the same lease semantics as the push itself: only from
  exactly the pre-rewrite sha, never while checked out, via
  `update-ref`'s compare-and-swap. Anything else is skipped with a
  warning and the exact recovery command, and every move is named in the
  run summary. The post-merge operator gesture is documented in
  `docs/agents/sandcastle-operator.md`.
- An implementer whose tree lacks a foundation the issue's spec
  references stops and reports a suspected missing blocked-by edge
  (tagged in its output, surfaced as the prune reason in the run
  summary) instead of re-implementing the foundation blind; the plan
  prompt correspondingly asks the planning agent to infer
  producer → consumer edges from each issue's predicted artifacts.
- The cap trades money-per-hour for hours: raising it multiplies
  concurrent paid agents and containers. 3 is a laptop-friendly default,
  not a tuned number.
- `plan` is neither free nor deterministic — it spends an agent run, and
  proposals may vary between runs. The review step absorbs this: what is
  printed is still exactly what runs.
- Sandbox build lines still interleave across stacks; every message
  names its issue and stack. Host-agent play-by-play no longer crowds
  the console but doubles the gitignored log output (a `.log` beside
  each `.jsonl`).
- Each rewritten tip pays one `npm ci --dry-run` (seconds, usually
  against the npm cache); no-op restacks skip the gate. A lockfile
  break now prunes the step at the run, with the npm error in the
  transcript, instead of surfacing as red CI on an open PR later.
  `npm install --package-lock-only` trusts npm's documented behavior
  of ignoring `node_modules`; the gate backstops it if that regresses.
- Each wave spends one `gh stack link` round-trip per multi-PR stack,
  and a resume prints one expected link warning per stack until the
  chain catches up to the prior run's membership.
- The sandbox's GitHub token needs Contents read/write on top of issues
  and pull-request scopes. `plan` and the resolver require the `claude`
  CLI on the host, running with the operator's credentials; for the
  resolver the tool allowlist is the containment boundary. `run` also
  requires the `gh-stack` extension (`gh extension install
  github/gh-stack`) on the host.
- Agent-resolved tips contain authored resolution code gated only by
  `npm run check` and PR review; the summary's audit markers exist so
  that review actually happens.
