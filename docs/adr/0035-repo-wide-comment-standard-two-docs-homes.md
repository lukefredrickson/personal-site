# 35. Repo-wide comment standard and two docs homes

Date: 2026-08-07
Status: Accepted

Implements
[#156](https://github.com/lukefredrickson/personal-site/issues/156).
Extends ADR 0033.

## Context

ADR 0033 defined the comment standard (constraint-only content,
`/* ADR NNNN */` references, 2/6-line caps, distilled STE register) but
bound only new and edited comments in factory runs. The repo's existing
comments predate it and violate it everywhere: essay file headers,
rationale restated from ADRs, metaphor, and vocabulary the CONTEXT.md
glossary does not define. ADR 0033 explicitly deferred repo-wide
adoption to #156.

The standard's overflow rule ("explanation over the cap becomes a
`docs/` document") also left one question open: where do documents about
factory internals live, given `.sandcastle/` is a self-contained
subsystem with its own orientation doc?

## Decision

- The ADR 0033 standard binds the whole repo, not only factory runs. A
  verbatim ~20-line copy lives in root `CLAUDE.md` as agent
  instructions; the factory prompt keeps its own self-contained copy
  (ADR 0018).
- Existing comments are reworded to the standard across `src/`,
  `astro.config.mjs`, and `.sandcastle/` (issue #156, four PRs).
  Already-compliant files are skipped — churn with no delta is review
  noise.
- **Two docs homes.** Docs live beside the code they document: site docs
  under `docs/`, Sandcastle implementation docs under
  `.sandcastle/docs/`. The CLAUDE.md copy of the standard carries this
  wording; the factory prompt keeps plain `docs/`, because factory runs
  work on site tickets.
- ADRs stay a single root log (`docs/adr/`). `.sandcastle/docs/` holds
  explanation documents only.
- New docs are sparse and written in the same STE register as comments.
  They earn their keep only for complexity that cannot fit a capped
  comment. Rationale with no ADR home and no docs-worthy complexity is
  dropped; every drop is listed in its PR body.

## Consequences

- Comment rules are uniform: one standard for humans, root agents, and
  factory runs, all citing ADR 0033.
- The rewrite must not change behavior. Each rewrite PR proves this with
  a comment-stripped diff (strip comments from before and after; the
  diff must be empty), plus the normal typecheck and test gates.
- A glossary term is the price of keeping a coinage: a concept that
  survives compression gets a CONTEXT.md entry in the PR that needs it;
  flourish is cut, not canonized.
