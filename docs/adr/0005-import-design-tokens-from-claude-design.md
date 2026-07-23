# 5. Import design tokens from the claude.ai/design system

Date: 2026-07-22
Status: Accepted (amended by ADR 0007)

## Amendment (ADR 0007)

The tokens now live at `docs/design/`, not `src/styles/`. Every `src/styles/…`
path below reads as `docs/design/…`. The decision this ADR records — import
tokens-only, verbatim, reference-first — is unchanged.

## Context

The visual design for this site was developed as a design system in a
claude.ai/design project ("lukefredrickson Design System"): an OKLCH
hue-spine palette, a two-family type scale (Public Sans + Fira Code), a
spacing/radii scale, and a set of React components built on top of them.

The site itself is still the Astro starter. Before building any real pages we
want the design foundation — the tokens — living in the repo as the single
source of truth, so future components are styled against named tokens rather
than hardcoded values.

## Decision

Import **tokens only** from the design system, as-is, into `src/styles/`:

- `src/styles/tokens/{fonts,colors,typography,spacing,base}.css` — verbatim
  copies of the design system's token files (pure CSS custom properties).
- `src/styles/tokens.css` — aggregator that `@import`s the five in order,
  mirroring the design system's own `styles.css`.

The tokens are **not yet wired into any layout**. This is a reference import:
the files exist and are the source of truth, but nothing consumes them until
we start building components. The components themselves are deliberately left
in the design system for now.

## Alternatives considered

- **Import components too** — the design system has ~25 React components
  (Button, Card, SiteHeader, …). Rejected for now: Astro renders `.astro`
  components server-side, so the React sources would need porting, not
  copying. Tokens first; components when we build the pages that need them.
- **Wire tokens into `Layout.astro` now** — makes the tokens live globally.
  Custom properties are inert until consumed, but `base.css` restyles the
  body (background, text color, default font), which would change the
  throwaway starter page. Rejected: keep this change pure-reference; wire the
  tokens in as part of the first real layout work.
- **Transcribe/rewrite the tokens** — reformat into a different structure.
  Rejected: verbatim copies stay diffable against the design system, so future
  token changes there port over as a clean diff.

## Consequences

- Tokens are the repo's source of truth for color, type, and spacing; new
  components reference `var(--…)` names, never literals.
- `fonts.css` pulls Public Sans + Fira Code from Google Fonts at runtime (no
  self-hosted binaries). Revisit if we want to self-host for performance.
- Palette relies on `oklch()` + `light-dark()` (Chrome 123+ / Safari 17.5+ /
  FF 120+). Acceptable for a personal site; noted as the browser floor.
- The design system remains the upstream. Token edits there are re-imported by
  copying the changed files — there is no automated sync for tokens.
