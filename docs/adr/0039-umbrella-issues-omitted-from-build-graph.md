# 39. Sandcastle: umbrella issues are omitted from the build graph

Date: 2026-08-09
Status: Accepted
Amends: ADR 0018 (planning — the graph the stacks derive from)

Implements issue
[#184](https://github.com/lukefredrickson/personal-site/issues/184).

## Context

An umbrella issue is a parent ticket whose whole scope lands in its
child issues — it has no implementation work of its own. The planner
treated one as an ordinary build step. In run
`run-2026-08-09T13-24-14.880Z`, umbrella #137 was chained as the final
wave of its stack: a sandbox ran for minutes, produced zero commits,
and the step was pruned as if it had failed. The sandbox spend bought
nothing the children hadn't already delivered, and the owner had to
read the implementer's log to learn the outcome was fine. The
implementer's audit comment on the issue was good and stays; the
sandbox must stop being the detection mechanism.

## Decision

**The planner recognizes umbrella issues and leaves them out of the
build graph.** Detection is two-tier:

- The repo's `parent` label ("Parent ticket to well scoped individual
  tickets") is authoritative: a labeled issue is an umbrella by owner
  declaration.
- Absent the label, the judgment agent classifies. Its output schema
  gains an `umbrellas` array, and the plan records the provenance
  (`labeled` vs `inferred`) so the printout can mark inferences with a
  veto instruction: label it `parent` to confirm, or re-plan to
  override. A wrong guess never spends a sandbox — the veto point is
  before approval.

Handling is omission, not a verify-only step. `omitUmbrellas` in
`stack.ts` is a pure transform applied between mutation screening and
`planStacks`: umbrellas leave the issue set, and each dependent of an
omitted umbrella inherits the umbrella's own blockers (transitively,
through chains of umbrellas), so omission never breaks a chain. The
walk, prune, and restack logic need no umbrella awareness. Omitted
umbrellas are listed in the plan printout and again in the RUN SUMMARY
with the one action they need: close after the children merge.

The run never auto-closes an umbrella. Its children merge after the run
ends, so the run cannot observe completion; mutating GitHub state
outside the run's own PRs is a failure surface this design refuses.
Declaratively, the issue-filing flow applies `parent` at creation time
(`docs/agents/issue-tracker.md`).

## Alternatives considered

- **A verify-only step**: keep the umbrella in the graph but skip its
  sandbox. Rejected — the walk, prune, restack, and ledger logic would
  all need a new step kind; omission keeps them untouched.
- **Body/checklist heuristics in host code**: rejected — brittle
  parsing where a label and agent judgment already cover both tiers.
- **Auto-close after the stack merges**: rejected as out of scope and
  unobservable from within the run.

## Consequences

- Children connected only through their umbrella now land in separate
  stacks — which is right: they share no build-order dependency.
- An umbrella with the `Sandcastle` label but no children costs
  nothing; one misclassified as an umbrella is recoverable by labeling
  (or re-planning) before approval, as the veto wording states.
- The transform, and the plan/RUN SUMMARY rendering of omitted
  umbrellas, are pinned exact-output in `stack.test.ts` and
  `render.test.ts` (ADR 0028 stance). The judgment agent's prompt stays
  unspecced; only the host's handling of its output is.
