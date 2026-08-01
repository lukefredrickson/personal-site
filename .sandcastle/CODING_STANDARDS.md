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
