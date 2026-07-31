# Coding Standards

Loaded by the implementer and reviewer agents. Pointers over restatement —
the linked ADRs are the source of truth; this file only says where to look.

## North star: idiomatic Astro

Write the Astro-native solution, not habits carried over from other
frameworks. The specs and issues in this repo were often drafted with a
React accent — translate them into idiomatic Astro rather than porting them
literally. Astro 7 is recent: for any Astro question, consult the Astro docs
MCP (`astro-docs`) instead of trusting training data.

## ADRs are binding

Decisions live in `docs/adr/` and win over anything in this file or in an
issue. Start with:

- `0010-astro-component-authoring-conventions.md`
- `0011-token-activation-reference-tokens-to-live-styles.md`
- `0012-theming-mechanism-and-theme-toggle.md`
- `0013-blog-content-model.md`

## Presumptions

- **Zero client-side JavaScript** by default. Ship JS only where an ADR or
  the issue explicitly calls for it (e.g. the theme toggle, ADR 0012).
- **Scoped component styles built on the design tokens** in `src/styles`
  (ADR 0011). No hardcoded colors, sizes, or fonts that a token covers.
- **No UI-framework dependencies** — no React, Vue, Svelte, or component
  libraries. Astro components only.

## Verification

- The gate is `npm run check` (typecheck via `astro check`, ADR 0008). Run
  it before every commit; only errors fail it.
- There is **intentionally no test runner**. Do not add one, do not install
  a test framework, and do not flag missing tests in review.
