# 16. Code blocks via Expressive Code

Date: 2026-07-30
Status: Accepted

Resolves wayfinder ticket
[#33](https://github.com/lukefredrickson/personal-site/issues/33), part of map
[#18](https://github.com/lukefredrickson/personal-site/issues/18). Builds on
the content-collections research
([#20](https://github.com/lukefredrickson/personal-site/issues/20)) and the
blog content model (ADR 0013).

## Context

The tech-post design (`docs/design/components/cards/CodeBlock.prompt.md`)
demands a code card with a filename bar, a copy affordance, and themed syntax
— "dawnfox syntax on the true dawn background in light; duskfox on ink-30 in
dark". Neither the filename header nor the copy button is a Shiki feature, so
the research ticket left two questions open: how the header gets rendered
(wrapper component vs fence-meta transformer vs Expressive Code), and how
syntax theming works (dual built-in Shiki themes vs the `css-variables` theme
wired to the design tokens).

Two constraints shaped the answer. ADR 0013's friction rule: posts stay plain
`.md` until they need components, and the `<Content components>` remapping
that could dress up a bare `pre` is MDX-only — so any per-block authoring
ceremony punishes the most common post (prose plus code fences). And ADR
0012's theming model: a stored choice stamps `html[data-theme]`; no stored
value means the OS decides.

An earlier draft of this decision rejected Expressive Code because it was a
remark plugin, colliding with ADR 0013's Sätteri commitment. That fact
expired: `astro-expressive-code` 0.44 supports Astro 7 and Sätteri natively
via a HAST plugin, with automatic processor detection.

## Decision

**Expressive Code renders all fenced code blocks** (`astro-expressive-code`
≥ 0.44). It is the ecosystem-standard engine (Starlight's default), it
processes plain fences in `.md` and `.mdx` identically, and it ships the two
things the design needs — editor frames and a copy button — plus line
marking for free if walkthrough-style posts ever want it.

**Filename headers come from fence meta**: ` ```css title="card.css" `
renders EC's editor frame with a filename tab. No imports, no wrapper, no
graduation to MDX — a plain fence stays a plain fence.

**No hand-built `CodeBlock.astro`.** EC's frame plays the role the design
kit's CodeBlock spec describes. This is a recorded exception to ADR 0010's
"prose chrome is a scoped component" rule: the chrome is EC's DOM, styled
through EC's config rather than a scoped `<style>` block.

**Themes: vendored dawnfox + duskfox.** The `dawnfox.json` (light) and
`duskfox.json` (dark) VS Code ports from
[nuromirg/nightfox-vscode](https://github.com/nuromirg/nightfox-vscode) (MIT)
are copied into the repo with attribution and loaded via
`ExpressiveCodeTheme` — the vendoring pattern EC's own docs recommend, so the
upstream's maintenance status stops mattering after the copy.

**Switching wires into ADR 0012 as-is.** EC's `themeCssSelector` keys off the
existing `html[data-theme]` attribute (themes named `light`/`dark`), and
`useDarkModeMediaQuery` covers the no-stored-choice state via
`prefers-color-scheme`. EC switches with CSS variables — one set of markup,
no duplicated blocks — so nothing fights the toggle.

**Frame shell consumes site tokens.** `styleOverrides` accepts CSS variable
values, so the card surface — background, border, radius, fonts — uses
`var(--code-bg)`, `var(--code-border)`, and friends live from `colors.css`.
Per the spec's intent: fox *syntax* on the site's *own* card surface.

## Alternatives considered

- **Custom fence-meta Shiki transformer + prose-partial CSS**: smallest
  possible footprint, every line consumes real tokens, and a good
  Shiki/transformer lesson. Rejected on ecosystem grounds: EC is widely
  deployed, battle-tested (accessibility, edge cases), and the hand-spun
  version rebuilds its least interesting 20%.
- **`CodeBlock.astro` wrapper used explicitly in MDX**: per-block import +
  JSX ceremony, and forces any post with a filename-headed block into MDX —
  a head-on collision with ADR 0013's friction constraint.
- **Token-derived custom theme JSONs** (the five `--code-*` syntax tokens as
  a hand-authored theme): keeps `colors.css` the single source of truth, but
  duplicates colors as static hex and costs authoring effort now. Deferred,
  not rejected — if the fox palettes clash with the design tokens, swapping
  the two vendored JSONs for custom ones is config, not migration.
- **Shiki `css-variables` theme**: mooted — EC replaces the built-in Shiki
  pipeline for fenced blocks, so the dual-themes-vs-css-variables question
  dissolved into "how is EC themed".

## Consequences

- Authoring a code block with a filename is one meta attribute on the fence;
  the syntax is EC's own, so content never migrates even if EC is ever
  swapped out.
- Syntax colors are the fox palettes, *near* the five design tokens but not
  equal to them. Accepted for now; the deferred custom-theme option is the
  escape hatch.
- EC injects its own CSS and a small copy-button script — a dependency with
  its own DOM on a hand-rolled site. Accepted as the price of not
  maintaining frame chrome, copy UX, and marker features by hand.
- Inline code (single backticks) is untouched by EC and remains the prose
  partial's job, styled with `--code-bg`/`--code-border` per the design.
