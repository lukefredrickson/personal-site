# 26. Sandcastle: lockfile integrity gate for restacked tips

Date: 2026-08-01

Status: Accepted

Extends [ADR 0018](0018-sandcastle-stacked-pr-orchestration.md).

## Context

The first full Sandcastle run over the build backlog (#42–52) produced an
11-PR stack whose upper seven PRs failed CI: Cloudflare Workers Builds'
`npm clean-install` rejected `package-lock.json` as out of sync with
`package.json` ("Missing: @rolldown/binding-linux-x64-gnu … from lock
file", plus every other non-arm64 platform binary).

The corruption entered during the restack of `sandcastle/issue-48`. The
resolver agent handled the lockfile conflict correctly in intent — take
the chain tip's lockfile, then reconcile with npm — but its safe command
(`git checkout HEAD -- package-lock.json && npm install
--package-lock-only --ignore-scripts`) was auto-denied: the harness
matches each Bash call against single-command patterns, and a `&&` chain
of individually allowed commands matches none of them. Its fallback,
plain `npm install`, was allowlisted and succeeded — and that is the bug.
`npm install` reconciles the lockfile against the *installed*
`node_modules` tree, and npm prunes `node_modules` to the host platform
on install, so on the arm64 Mac it silently rewrote the lockfile without
any other platform's optional binaries ([npm/cli#4828]). `npm run check`
— the only gate between the resolver and the force-push — does not read
the lockfile, so the branch passed and the corruption propagated up the
chain through every later restack.

Two structural gaps, not one agent mistake: nothing host-side verified
the committed lockfile against what CI actually runs, and the host gate's
own `npm install` performs the same unchecked lockfile rewrite in the
restack worktree (uncommitted, so never pushed — but it dirties the
worktree for the next branch's `git switch`).

[npm/cli#4828]: https://github.com/npm/cli/issues/4828

## Decision

**Gate every rewritten tip with `npm ci --dry-run` before the check.**
`npm ci` builds its ideal tree from `package.json` across all platforms,
so a platform-pruned lockfile fails the dry run on any host — it is the
same test Workers Builds applies per PR, moved before the push. A failure
takes the existing `check-failed` prune path. After the gate, the
worktree's `package-lock.json` is restored from HEAD so the gate's own
`npm install` rewrite cannot dirty the next branch's switch.

**Teach the resolver the lockfile recipe, in the prompt.** Never resolve
`package-lock.json` by hand; take the tip's version, resolve
`package.json`, and finish with `npm install --package-lock-only`, which
rebuilds the lockfile from `package.json` alone and is immune to #4828.
The prompt also states the chain rule — one command per Bash call — so
the agent stops burning its single attempt on denied compounds.

**Widen the allowlist to match observed need.** `git checkout --ours`,
`git restore`, and `npm ci --dry-run` are worktree-local and unpushable;
every resolver in the failed run was denied on the first two repeatedly.
The containment boundary (no push, no abort, no skip) is unchanged.

The division of labor follows ADR 0018: the prompt improves the odds, the
harness-level gate guarantees the outcome. Even a resolver that ignores
the recipe can no longer push a lockfile CI would reject.

## Alternatives considered

- **Deny plain `npm install` to the resolver** — rejected: the resolver
  legitimately needs it to true up `node_modules` before `npm run check`,
  and prompt-level sequencing (regenerate the lockfile *after*) plus the
  mechanical gate covers the risk without removing the tool.
- **Replace the gate's `npm install` with `npm ci`** — rejected: it would
  also catch the sync break, but deletes and reinstalls `node_modules`
  per branch (~minutes across a stack) where the dry run costs seconds
  and the existing incremental install keeps the check fast.
- **Grep the lockfile for sentinel platform entries** — rejected: cheap
  but partial; it encodes today's dependency names and misses every other
  way a lockfile can drift from `package.json`. `npm ci --dry-run` is the
  authoritative sync test because it is what CI runs.
- **Have the host regenerate the lockfile itself after every resolution**
  — rejected: it papers over whatever the resolver did instead of gating
  it, and a host rewrite of agent-authored state is exactly the silent
  mutation the audit markers exist to avoid.

## Consequences

- Each rewritten tip pays one `npm ci --dry-run` (seconds, usually
  offline against the npm cache). No-op restacks still skip the gate.
- A lockfile break now prunes the step at the run, with the npm error in
  the transcript, instead of surfacing as red CI on an open PR an hour
  later.
- The compound-command rule lives in the prompt only; the harness still
  denies chains. If resolver transcripts keep showing denied compounds,
  the next step is a harness-side change, not more prompt text.
- `npm install --package-lock-only` trusts npm's documented behavior of
  ignoring `node_modules`; the gate backstops it if that ever regresses.
