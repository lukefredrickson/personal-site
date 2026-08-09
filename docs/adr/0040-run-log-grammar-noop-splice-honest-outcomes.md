# 39. Sandcastle: run-log grammar, no-op splice, honest outcomes

Date: 2026-08-09
Status: Accepted
Amends: ADR 0032 (output conventions) and ADR 0018 (what an empty build
does to its dependents)

Implements issue
[#183](https://github.com/lukefredrickson/personal-site/issues/183).
Companion spec: #184 (planner umbrella handling, separate).

## Context

Run `run-2026-08-09T13-24-14.880Z` needed archaeology to read. A step
that legitimately had nothing to do (#137, an umbrella whose scope had
landed in its children) reported `✗ pruned — its branch carries nothing
ahead of …`, which reads as a failure; the prune also removed its
dependent closure, so a chained issue after it would have been dropped
even though a no-op branch is identical to its base. The closing line
said "Plan retained — re-run to resume" although every step built.
Spurious retarget warnings fired on PRs whose base was already correct.
Formatting was inconsistent: the execute phase got a thin rule while
PLAN and RUN SUMMARY got heavy banners, step starts shared the rule
shape with stack lifecycle, and blank lines appeared ad hoc, so
concurrent stacks' interleaved output was hard to follow.

## Decision

**One written log grammar, a neutral no-op outcome with splice
semantics, a pure clean-success classification, and check-first PR
retargeting.**

- The grammar (`.sandcastle/docs/log-grammar.md`) has three levels —
  heavy banner for run phases (PLAN, EXECUTE, RUN SUMMARY), thin rule
  for stack lifecycle only, plain tagged line for everything else — and
  three blank-line sites: before banners, before rules, and between
  consecutive lines of different stacks (the stack-switch gap). A pure
  `grammarGap` function decides every gap; the console sink threads all
  prints through it. Output stays real-time and unbuffered. The
  renderer specs pin the grammar with exact strings.
- An empty build without a missing-dependency report is a **no-op**: a
  new step outcome, rendered `○` with the manual-close reminder, not a
  prune. The step is spliced out of the chain — it takes no restack
  turn, the tip does not move, dependents build from the no-op's base
  and keep building. The missing-dependency tripwire, and the
  dependent-closure prune for real failures, are unchanged.
- `runSucceeded`, a pure function over the walk outcomes, classifies
  clean success: no prunes, no missing PRs, no link failures; no-ops
  never count against it. The host entry consumes the verdict: clean
  success deletes the plan and says so; anything else retains the plan
  with the resume wording.
- Retargeting reads the PR's current base first (`prBase` effect),
  edits only on mismatch, and warns only when the edit fails — naming
  the PR, its current base, the expected base, and the `gh pr edit`
  fix command.

Rejected alternative for the no-op: keep the prune but exempt it from
the summary's ✗. That fixes the message and still destroys valid
downstream work — the splice is the point.

## Consequences

- ✗ and "Plan retained" are trustworthy health signals: they appear
  only on real failures.
- A no-op leaves its issue open; the `○` line and the run summary both
  carry the manual-close reminder. Auto-closing umbrellas and planner
  umbrella handling stay out of scope (#184).
- The no-op's pushed branch equals its base; the next run's stale rule
  (ADR 0034) collects it.
- First-in-wave and already-correct retargets no longer call
  `gh pr edit` at all — fewer API calls, no benign warnings.
- New log lines must pick a level from the grammar; the renderer specs
  make ad-hoc formatting a failing test.
