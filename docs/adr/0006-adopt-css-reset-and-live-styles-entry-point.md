# 6. Adopt Josh Comeau's CSS reset and a live-styles entry point

Date: 2026-07-22
Status: Accepted

## Context

The site is still the Astro starter. The only styling that existed was a set of
reference-only design tokens (imported for provenance, wired into nothing — see
ADR 0005) and a few lines of scaffold CSS in `Layout.astro`
(`html, body { margin; width; height }`). Browser default styles were otherwise
in effect: inconsistent spacing, media with inline-layout quirks, long words
able to overflow, form controls not inheriting fonts. Every future component
would start by fighting the same defaults.

Before building real pages we want a sane, opinionated baseline applied
site-wide, and a styling structure that makes it obvious where live styles grow.

## Decision

Adopt **Josh Comeau's Custom CSS Reset** as the site's first *live* stylesheet
and establish an entry-point pattern for live styles.

- **`src/styles/reset.css`** — Comeau's reset, rules 1–9 taken **verbatim**
  (including his section comments), with an attribution comment linking the
  source article. Delivered as a frontmatter import, so Astro bundles, hashes,
  and optimizes it (not a `public/` link).
- **`src/styles/global.css`** — a thin entry file that today only
  `@import`s the reset. This is the single stylesheet `Layout.astro` imports,
  and the stable seam: future live partials are added behind it, not in the
  layout.
- **`Layout.astro`** imports `global.css` once from its frontmatter. The inline
  `<style>` scaffold was deleted wholesale: `margin` is now the reset's job,
  `width: 100%` was inert, and `height: 100%` had no consumer.

### Relationship to ADR 0005 (design tokens)

ADR 0005 anticipated wiring the reference tokens in by importing `tokens.css`
from a layout's frontmatter. This ADR supersedes that mechanism: when tokens are
eventually made live, they are imported **behind `global.css`**, not as a second
layout-level import. "The layout imports exactly one stylesheet" is the
invariant. The tokens under `src/styles/tokens/` remain reference-only and
unimported today, so nothing conflicts yet — but note `tokens/base.css` restyles
`body` and overlaps the reset, which the tokens-wiring work will need to
reconcile.

### Rule 10 omitted

Comeau's rule 10 (`#root, #__next { isolation: isolate }`) creates a root
stacking context for React/Next mount nodes. Astro renders HTML directly into
`<body>` and has no JS mount root, so those selectors match nothing here. It is
omitted, with a comment in `reset.css` recording why. If overlay UI (modals,
tooltips, dropdowns) is added later, the equivalent is `isolation: isolate` on
`body` or a deliberate layout wrapper.

### No cascade layers

No `@layer` declaration and no `src/styles/` subfolders are introduced. With a
single live partial there is nothing to order and nothing to group. Astro's
scoped component `<style>` blocks already outrank imported global CSS, so a
reset delivered as an imported stylesheet sits at the correct lowest tier of the
cascade without any layer machinery.

Cascade layers are **deferred, not rejected**. Revisit them only when a concrete
trigger appears: adopting a utility framework (e.g. Tailwind), importing
third-party CSS whose specificity must be arbitrated, or hand-rolling a utility
system — and re-ground the decision against current practice at that point,
rather than choosing from memory now.

## Alternatives considered

- **Write our own reset / use normalize.css** — rejected. Comeau's reset is
  small, well-reasoned, and documented; keeping it verbatim means it stays
  diffable against the source so future updates port as a clean diff.
- **Put the reset in `public/` and `<link>` it** — rejected. A frontmatter
  import lets Astro bundle and hash it; a `public/` link ships unoptimized and
  unversioned.
- **Import the reset directly in `Layout.astro`** — rejected. The `global.css`
  entry file is the indirection that lets live styles grow without ever editing
  the layout again.
- **Introduce `@layer` now** — rejected as speculative structure. There is
  nothing to order yet and Astro scoping already handles component isolation.

## Consequences

- Every page rendered through `Layout.astro` starts from a consistent baseline:
  `border-box` sizing, no default margins, comfortable line-height, block media
  capped at `max-width: 100%`, form controls inheriting fonts, and long words
  wrapping instead of overflowing.
- Rules 3 (`interpolate-size: allow-keywords`) and 9 (`text-wrap`) rely on
  recent browser support; both degrade gracefully where unsupported.
- Adding live styles later means adding a partial and one `@import` in
  `global.css` — the layout is never touched again for styling.
- Verification for this scaffolding is manual (dev-server visual check +
  `astro build` succeeds emitting the bundled stylesheet); no test harness is
  introduced (see the spec's testing decisions).
