# Coding Standards

Loaded by the implementer and reviewer agents. Self-contained: everything
needed to follow the rules is on this page. When outside context matters
to a task, the issue provides it.

## Astro

- Write idiomatic Astro, not habits carried over from other frameworks.
  Specs and issues drafted with a React accent are translated, not ported:
  data props carry over, `children` becomes `<slot />`, callback props and
  style/class passthroughs are deleted.
- Astro 7 is recent — consult the Astro docs MCP (`astro-docs`) for any
  Astro question instead of trusting training data.
- **Zero client-side JavaScript** by default. Ship a `<script>` only where
  the issue explicitly calls for it; prefer navigation and CSS for
  interaction.
- **No UI-framework dependencies** — no React, Vue, Svelte, or component
  libraries. `.astro` components only.

## Styling

- Scoped `<style>` blocks per component, built on the design tokens in
  `src/styles`. No hardcoded colors, sizes, or fonts that a token covers.
- Global CSS stays limited to the tokens, the reset, and the prose partial
  for rendered markdown.
- The token scales are the design authority; the design kit is reference
  only. When a kit measurement sits off a scale (18px, 5px, 2px…), snap to
  the nearest token — never copy the literal, and never add a comment
  excusing it. If no token is close enough to work, that is a design
  question for the issue, not a license to hardcode. Expanding tokens is
  authorized only when STRICTLY necessary to fill a gap where hardcoded
  values would stand in, and there are no existing similar-enough tokens
  to snap to (adding a token is an absolute last resort and should be
  treated with caution -- bloating the tokens is heavily discouraged).
- Specifically: font weights come from `--weight-*` (never a bare
  500–800), spacing (padding/margin/gap) from `--space-*`, font sizes from
  the `--text-*` job tokens, line-heights from `--leading-*`, radii from
  `--radius-*`. The only sanctioned literals: 1px hairlines, `0`,
  `border-radius: 50%`, `line-height: normal` (to undo the body's 1.5),
  and fixed element dimensions (icons, avatars, tiles) — dimensions are
  not spacing.

## Structure and naming

- Components live flat in `src/components/`, PascalCase, one per file.
- Blog posts live in `src/content/blog/<year>/`, `.md` until they need
  components, then `.mdx`. Slug = filename; frontmatter stays lean.

## Comments

- Describe the current implementation only — never a prior iteration or
  how the code changed.
- Terse over grammatical: sacrifice full sentences for concision.
- Explain why, not what — unless the what is genuinely non-obvious (a
  specific algorithm, a clever trick). Never narrate what plainly readable
  code already shows.

## Verification

- The gate is `npm run check` (typecheck via `astro check`). Run it before
  every commit; only errors fail it.
- There is **intentionally no test runner**. Do not add one, do not install
  a test framework, and do not flag missing tests in review.
