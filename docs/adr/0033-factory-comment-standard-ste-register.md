# 33. Factory comment standard: constraint-only, 2/6-line caps, STE register

Date: 2026-08-07
Status: Accepted

Implements
[#155](https://github.com/lukefredrickson/personal-site/issues/155).
Origin: operator review of PR #149.

## Context

The factory's implementer writes the ADR, then restates the same
rationale as code comments. PR #149 shipped `motion.css` with 5 lines of
code under 15 lines of comment essay, all duplicating ADR 0031. The old
standard could not stop this: "terse over grammatical" set no limit, and
the review prompt's "remove unnecessary comments that describe obvious
code" never fired — rationale comments describe non-obvious reasoning,
not obvious code. Opus 5's prose style (metaphor, passive voice, synonym
drift) compounds it; no length rule alone fixes register.

## Decision

The Comments section of `.sandcastle/prompts/CODING_STANDARDS.md` is
replaced wholesale with three enforceable teeth, adapted from the
wait-what skill's two rules (ASD-STE100 Simplified Technical English +
the CONTEXT.md ubiquitous language):

- **Placement.** Comments state only constraints the code cannot show.
  Rationale lives in the ADR and is referenced (`/* ADR NNNN */`), never
  restated. Default is no comment.
- **Caps.** 2 lines per comment; 6 for a function comment or file
  header. Content over the cap is not comment material: rationale goes
  to the ADR, and explanation that earns its length goes to a concise
  Markdown document under `docs/`, referenced from the code. ADRs are
  decision records, not documentation — long explanations are not
  shoved into them (the operator's revision during implementation;
  the issue's original caps were 2/4 with ADRs as the only overflow).
- **Register.** A distilled STE checklist, inlined rather than cited —
  the prompts are deliberately self-contained (ADR 0018), with the
  CONTEXT.md glossary as the one external reference: active voice,
  present tense, one fact per sentence, ≤20 words per sentence,
  CONTEXT.md glossary names with no synonyms or coinages, verbs stay
  verbs, no metaphor or flourish, articles kept (telegram style is not
  concision).

Enforcement: the review prompt's weak comment bullet becomes a mandatory
pass over comments the diff adds or edits — delete no-constraint
comments, swap rationale for an ADR reference, compress over-cap
comments, rewrite survivors in the register. A well-written paragraph is
explicitly not exempt: well-written rationale is ADR content in the
wrong place, well-written explanation is a docs page in the wrong
place. The implement prompt gains one instruction pinning rationale to
the ADR.

## Consequences

- Comment length and placement are now checkable rules, not taste; the
  reviewer agent no longer needs a judgment of "unnecessary".
- Scope is new and edited comments only, so shipped files do not churn
  as a side effect of unrelated work. Repo-wide rewording of existing
  comments is #156.
- Verification is the next factory run — prompt files are prose consumed
  by agents; there is nothing to unit-test.
- These standards bind factory runs only; whether the style guide lifts
  to a repo-level home is decided in #156's triage.
