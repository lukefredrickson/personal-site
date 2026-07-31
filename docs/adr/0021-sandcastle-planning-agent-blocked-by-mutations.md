# 21. Sandcastle: planning agent that amends the blocked-by DAG

Date: 2026-07-31
Status: Accepted

Amends [ADR 0019](0019-sandcastle-one-stack-per-blocked-by-component.md)
(the graph the stacks derive from is now the *amended* graph) and
[ADR 0020](0020-sandcastle-plan-and-run-commands-with-plan-file.md)
(fills the `mutations` slot that ADR reserved). Resolves
[#61](https://github.com/lukefredrickson/personal-site/issues/61).

## Context

Under ADR 0019, grouping and ordering are pure functions of GitHub's
blocked-by graph — which makes the graph's *accuracy* the load-bearing
assumption. The owner tags issues `Sandcastle` freely but rarely draws
every real dependency edge, so semantically related issues land in
separate stacks and collide; conversely, a stale edge chains unrelated
work into one needlessly serial stack. The roadmap (ADR 0020) anticipated
this: the plan file carries a `mutations` slot, empty until a judgment
agent arrives. This is that agent.

## Decision

### Judgment proposes; the host disposes

`plan` runs a judgment agent on `claude-fable-5` before deriving stacks.
It receives the open Sandcastle issues and their current edges, explores
whatever else it needs (issue bodies, referenced issues, `CONTEXT.md`,
ADRs, source), and returns a structured proposal: blocked-by additions
and removals, each with one sentence of reasoning. It is
prompt-instructed to fan exploration out to subagents so its own context
stays for judgment.

The agent has **no write authority**, enforced by the harness rather than
the prompt: it runs via `claude -p`, where every tool call outside the
allowlist (read tools, subagents, and read-only `gh issue view`/`list`)
is auto-denied.

### A mechanical gate, not a second judgment

Host code (`screenMutations` in `stack.ts`, pure) screens the proposal:
a mutation referencing an issue outside the walk, or an addition that
would create a cycle in the graph-as-amended-so-far, is dropped with a
logged reason and never applied. No LLM validates the LLM. Survivors are
persisted in the plan file and printed in the review with reasoning —
removals bold, since a removal un-gates work while an addition merely
serializes it. A no-change proposal is stated explicitly. Stacks are
derived from the amended graph, so the plan the owner reviews already
reflects the proposal.

### Run applies, idempotently, before walking

`run` applies the plan's mutations to GitHub — the only writer — logging
each one, before executing the stacks. Application checks the live graph
first: adding a present edge or removing an absent one is a logged no-op,
so re-running a retained plan after a failure is safe. A failure while
applying aborts the run before any stack walks (the stacks assume the
amended graph) and retains the plan for resume.

The owner's veto is reviewing the plan and not running it — no revert
tooling.

## Alternatives considered

- **Agent writes edges directly** — rejected: no reviewable artifact, no
  veto, and an LLM with `gh` write access is one bad tool call from
  mangling the tracker.
- **Screen at run time instead of plan time** — rejected: the review
  would show unvetted mutations, reopening the review/execute gap ADR
  0020 closed.
- **Agent judges validity too** — rejected: cycle and existence checks
  are mechanical; spending judgment on them buys nothing and makes the
  gate probabilistic.
- **Sandbox the agent like implementers** — rejected: it needs no
  branch, worktree, or `npm install`, and read-only enforcement comes
  from the permission harness either way.

## Consequences

- Over-tagging is safe: related-but-unlinked issues get their edges drawn
  and land in one stack; unrelated issues fall out as components.
- `plan` is no longer free or deterministic — it spends an agent run, and
  proposals may vary between runs. The review step absorbs this: what is
  printed is still byte-for-byte what runs.
- `plan` now requires the `claude` CLI on the host and fails loudly
  without it.
- The graph on GitHub only moves when a plan *runs*, so an unexecuted
  plan leaves no trace to revert.
