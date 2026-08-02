# 7. Quarantine the reference design tokens under `docs/design/`

Date: 2026-07-22
Status: Accepted
Amends: ADR 0005 and ADR 0006 (token location only — both decisions stand)

## Context

ADR 0005 imported the design system's tokens into `src/styles/tokens/` plus a
`src/styles/tokens.css` aggregator, deliberately wired into nothing. ADR 0006
then added the first *live* stylesheets — `reset.css` and the `global.css` entry
point — into the same directory.

That left `src/styles/` holding two kinds of file with no visible difference
between them: CSS that ships, and CSS that is reference material. Telling them
apart required reading a comment or tracing imports. Both ADR 0005 and 0006 had
to spend a paragraph explaining that the tokens are inert, which is a sign the
directory layout was carrying meaning it couldn't express.

## Decision

Move the reference tokens out of the live styling area, verbatim:

- `src/styles/tokens.css` → `docs/design/tokens.css`
- `src/styles/tokens/{fonts,colors,typography,spacing,base}.css` →
  `docs/design/tokens/`

File contents are unchanged apart from the aggregator's header comment, which
keeps its provenance note (origin in the claude.ai/design system, pointer to ADR
0005, reference-only status) and replaces its stale wiring instruction — "import
this file from a layout's frontmatter", superseded by ADR 0006 — with the copy-
into-`src/styles/` route described below.

The rule this establishes: **`src/styles/` contains only styles that ship.**
Anything under `docs/` is reference material by definition.

This is a pure legibility move with **zero build impact** — Astro bundles only
CSS that something imports, and nothing imports these files. Verified by
comparing `dist/` before and after: byte-identical, including the hashed asset
filenames.

Making the tokens live later means *copying* the ones we want into
`src/styles/` and `@import`ing them behind `global.css` (ADR 0006), not
importing across the `docs/` boundary. The `docs/design/` copy stays the
verbatim upstream mirror, diffable against the design system.

## Alternatives considered

- **Leave them in `src/styles/` and rely on comments** — rejected. The comment
  already existed and still wasn't enough; each new ADR had to restate it.
- **A `src/styles/_reference/` subfolder** — rejected. Keeps reference CSS
  inside the directory Astro and every contributor treats as live code, so the
  ambiguity survives; it also contradicts ADR 0006's "no `src/styles/`
  subfolders until there's something to group."
- **Delete the tokens and re-import from the design system when needed** —
  rejected. The import exists so the tokens are versioned alongside the site and
  diffable against upstream; deleting them throws that away to solve a naming
  problem.
- **Reorganize the tokens during the move** — rejected. Verbatim keeps them
  diffable against the design system, per ADR 0005.

## Consequences

- `src/styles/` is unambiguous: every file there is shipped CSS.
- ADR 0005's stated path (`src/styles/tokens/`) is superseded by this ADR; its
  decision to import tokens-only, verbatim, reference-first is untouched.
- `docs/design/` is now the home for design-system reference material. Future
  imports from the design system (component sources, motion specs) land here.
- Anyone wiring tokens in must consciously copy them across the `docs/` → `src/`
  boundary, which is the moment to reconcile `base.css` against the reset.
