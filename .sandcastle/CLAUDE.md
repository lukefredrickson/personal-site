# Sandcastle

Sandcastle is an agent factory: it plans a backlog of `Sandcastle`-labeled
GitHub issues into stacked-PR chains, one chain per connected component of
the blocked-by graph. Each issue is built by a Claude agent in its own
Docker sandbox, then the branches are restacked into a linear chain and the
PRs linked on GitHub. The operator's only moves are approving the plan and
reviewing the finished PRs bottom-up.

This doc is the orientation pass; the module header comments are the
authority on each module's behavior — read the header before editing.

## Module map

Everything lives in `.sandcastle/src/`:

- `main.ts` — CLI entry and run orchestration: plan → approve → execute,
  concurrency caps, per-stack summary. The full pipeline narrative lives
  in `docs/pipeline.md`.
- `plan.ts` — planning: the plan file, the judgment agent, and the only
  host code that ever writes blocked-by edges to GitHub.
- `stack.ts` — the pure seam: issues + edges in, ordered stacks of
  (issue, branch, base) out. No I/O.
- `walk.ts` — the wave walk of one stack: sandbox lifecycle, prune logic,
  a state machine over the `WalkEffects` boundary (ADR 0029).
- `restack.ts` — host-side git surgery: rebases, force-pushes with lease
  semantics, the shared restack worktree, the conflict-resolver agent.
- `host-agent.ts` — streaming `claude -p` runner for the planning and
  resolver agents; logs to `.sandcastle/logs/`.
- `exec.ts` — captured child execution (git, npm, gh) and the per-run raw
  log; console policy lives at the call sites.
- `render.ts` — the structured console renderer: timestamps, stack tags,
  role colors, phase rules, banners (ADR 0032).
- `fixtures.ts` — throwaway git fixture repos for the git-surgery specs.
- `stack.test.ts` / `walk.test.ts` / `restack.test.ts` / `render.test.ts`
  — the vitest suite: pure-logic specs, `WalkEffects` state-machine
  specs, and Tier-1 git-surgery specs against fixture repos (ADR 0028).

`prompts/` holds the agent prompts: plan, implement, review, resolve, plus
the coding standards handed to sandboxed agents.

## The run flow

    npm run sandcastle       # plan (if no plan file), approve, execute
    npm run sandcastle plan  # discard any existing plan and replan; no execution

Plan → approve → execute → summary. Planning fetches the labeled issues
and their blocked-by edges, runs a read-only judgment agent, screens its
proposed edge mutations mechanically, and writes the plan file. The bare
command pauses for approval (Enter to execute, Ctrl-C aborts but keeps the
plan file). Execution walks each stack in waves: every issue in a
topological level builds concurrently in its own sandbox, then the level
restacks serially onto the growing chain. The run ends with a per-stack
summary and exits non-zero if anything was pruned.

Resume semantics: at step start the walk fetches the step's PR ledger —
every PR whose head is its branch, in any state — and computes a
verdict: an open PR means complete; otherwise the newest PR decides
(merged → complete, issue auto-closed; closed → rejected, branch deleted
and rebuilt fresh). Progress lives on GitHub, not in local state. A
surviving plan file means a run failed midway or was
approved-then-aborted; re-running executes it as-is, resuming at the
first step whose ledger verdict is not complete, no re-judgment.

## Invariants

A change must not break these; each is load-bearing in an ADR or header.

- **Planning never writes to GitHub.** The judgment agent is read-only;
  its proposal becomes real only when `run` applies it.
- **Only host code writes blocked-by edges** — one site, in `plan.ts`,
  after mechanical screening. No agent has write authority over the graph.
- **Restacking owns git.** All raw git goes through `restack.ts`'s named
  operations, and restack is serial under a lock in one shared worktree —
  chains never depend on which sandbox finished first.
- **The PR ledger is the only cross-run memory.** An open PR wins;
  otherwise the newest PR decides (merged → complete, closed →
  rejected). Branch contents are never trusted across runs — stale
  branches are deleted and rebuilt fresh.
- **The factory never works on its own tickets.** Issues about Sandcastle
  itself never get the `Sandcastle` label; they are built in interactive
  sessions like this one.

## Gates

Root `npm run check` does NOT cover the factory. The factory's gates are:

    npx tsc --noEmit -p .sandcastle
    npm run test:sandcastle

Run both before calling factory work done. Testing stance (ADR 0028):
pure logic and the effects boundary get specs; thin production adapters
(exec, host-agent) stay unspecced.

## Why it is this way

- ADR 0018 — the orchestration design: stacks, waves, sandboxes, prune.
- ADR 0028 — the testing stance and the factory's separate gates.
- ADR 0029 — the `WalkEffects` boundary: walk as a state machine over data.
- ADR 0034 — the PR ledger as the only cross-run memory; stale branches.

All in `docs/adr/` at repo root.
