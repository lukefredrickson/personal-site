# Coding Standards

Loaded by the implementer and reviewer agents. Self-contained: everything
needed to follow the rules is on this page, plus the `CONTEXT.md` glossary
at repo root. When outside context matters to a task, the issue provides
it.

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

- The default is no comment. Comment only when the code cannot show the
  fact.
- A comment states a constraint the code cannot show. Rationale — why
  this design, what was rejected — lives in the ADR; the comment
  references it (`/* ADR NNNN */`) and never restates it.
- Hard caps: 2 lines per comment; 6 lines for a function comment or a
  file header.
- Explanation that earns more than the cap is documentation. It lives as
  a concise Markdown document under `docs/`, referenced from the code —
  never spread across comments, and never shoved into an ADR. ADRs
  record decisions; they are not documentation.
- Write comments in this register (distilled Simplified Technical
  English):
  - Active voice, present tense.
  - One fact per sentence. At most 20 words per sentence.
  - One word per meaning: use the glossary names from `CONTEXT.md`. No
    synonyms, no coinages. A brand-new concept gets a `CONTEXT.md`
    glossary entry first; its entry name is then the one word.
  - Verbs stay verbs (the code "restacks"; it does not "do a restack").
  - No metaphor, no flourish, no scene-setting.
  - Keep the articles — telegram style is not concision.

## Verification

- The gate is `npm run check` (typecheck via `astro check`). Run it before
  every commit; only errors fail it.
- There is **intentionally no test runner**. Do not add one, do not install
  a test framework, and do not flag missing tests in review.
