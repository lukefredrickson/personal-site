# 19. Retire the design reference under `docs/design/`

Date: 2026-08-01
Status: Accepted
Amends: [5. Import design tokens from the claude.ai/design
system](0005-import-design-tokens-from-claude-design.md) and
[7. Quarantine the reference design tokens under
`docs/design/`](0007-quarantine-reference-tokens-under-docs-design.md) — the
mirror they set up is now removed. Executes the demolition scheduled by
[10. Astro component authoring conventions](0010-astro-component-authoring-conventions.md)
§5 and [11. Token activation](0011-token-activation-reference-tokens-to-live-styles.md).

Closes the build backlog cut from the
[realize-the-design-system map, #18](https://github.com/lukefredrickson/personal-site/issues/18)
(ticket [#28](https://github.com/lukefredrickson/personal-site/issues/28)).

## Context

`docs/design/` held the claude.ai/design export: token CSS, ~20 component
specs (`.prompt.md` + `.d.ts` pairs), the four screen JSXs, an interactive
demo, and reference assets. ADR 0005 imported it, ADR 0007 quarantined it out
of `src/styles/`, and both described it as a *mirror* — verbatim, diffable
against upstream.

ADR 0011 then reframed the design project as scaffolding rather than upstream:
from token activation onward `src/styles/` is canonical and there is no sync.
Both ADR 0010 §5 and ADR 0011 scheduled the same demolition, gated on the same
event: all four screens realized. With the ride post (this ADR's PR) that gate
is met.

## Decision

Delete `docs/design/` entirely — tokens, specs, screens, demo, assets.

The documentation of what the site looks like is now the site: live components
under `src/components/`, live tokens under `src/styles/`, and the ADRs that
explain both. Git history keeps every deleted file, and the design source of
truth remains the claude.ai/design project.

Two consequences accepted deliberately:

- **Older ADRs point at paths that no longer exist.** ADRs are a record of
  decisions as they were made, not a live map; they are not rewritten. Prose
  citing `docs/design/…` resolves in git history.
- **Reference assets go with it.** Anything still wanted — an employer logo,
  an icon — is recovered with `git show`, and lands in `src/assets/` where
  ADR 0015 puts rendered imagery.

## Alternatives considered

- **Keep the specs, delete only the tokens** — the tokens are the part with a
  live replacement, but the specs are the part that rots: a `.d.ts` describing
  React props for a component now written in Astro reads as an authority and
  isn't one. Both go, or the ambiguity ADR 0007 removed comes straight back.
- **Move it under a `reference/` branch or tag** — ceremony for what `git log
  -- docs/design` already provides.
- **Keep the interactive demo (`ui-kit/index.html`) as a visual baseline** —
  tempting for eyeballing regressions, but it is a hand-written mock that is
  already drifting from the built site (its type scale predates ADR 0011). A
  stale baseline is worse than none; the deployed preview is the baseline.

## Consequences

- The repo carries one design system, not two. "Which is authoritative?" stops
  being a question anyone can ask.
- ~1.4 MB and ~60 files leave the working tree; new work reads the components.
- Design changes now start in the code (or in the design project, exported
  fresh), never as an edit to a mirror nobody imports.
- ADR 0005 and 0007 are historical: their subject is gone, their rationale
  (import tokens-only, keep reference out of `src/styles/`) survives as the
  rule that `src/styles/` contains only styles that ship.
