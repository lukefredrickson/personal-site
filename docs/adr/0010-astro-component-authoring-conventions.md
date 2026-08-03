# 10. Astro component authoring conventions for the design-system kit

Date: 2026-07-30
Status: Accepted
Amended 2026-07-30: video embeds via `astro-embed` — see
[Amendment: video embeds](#amendment-video-embeds-astro-embed-2026-07-30).

## Context

The ~20 component specs under `docs/design/components/` (`.prompt.md` +
`.d.ts` pairs) are React-shaped: `React.ReactNode` children, `onClick`
callbacks, `style?: React.CSSProperties` escape hatches. They were exported
from the claude.ai/design system as *reference*, not source (ADR 0007), and
the build target is Astro. Before cutting a build backlog, every build ticket
needs one shared answer to: how does a React-shaped spec become an `.astro`
component? Deciding it per-component would relitigate the same trade-offs
twenty times.

The specs are also visually authoritative but architecturally messy — their
prop surfaces reflect a JSX prototyping environment, not a considered API.
The project's stated goal is a pristine, idiomatically-Astro reference
codebase.

## Decision

Resolved via wayfinder ticket
[#23](https://github.com/lukefredrickson/personal-site/issues/23); the full
reasoning and alternatives live in that ticket's thread.

1. **Pure Astro — no framework islands.** Every component is `.astro`. The
   site's interactivity is tiny and DOM-shaped; React would be a ~40 kB
   runtime to avoid ~30 lines of vanilla JS. If genuinely stateful UI arrives
   later, Astro makes adding an island then additive, not a rewrite.

2. **Scoped styles by default.** Each component carries its own `<style>`
   block, consuming global design tokens. Global CSS is limited to three
   things: tokens, the reset, and a typography-only prose partial for
   rendered markdown (bare `<p>`/`<h2>`/`<a>` from MDX can't carry scoped
   classes). Anything in prose with its own surrounding UI (title bars,
   captions, buttons, borders) — code blocks, figures, video embeds — is a
   component, reached via MDX embedding or the `components` mapping, and
   styled scoped.

3. **Props translate; React-isms are deleted, not ported.** Data props
   (`variant`, `label`, `count`, `href`…) carry over 1:1 into `interface
   Props`. `children: React.ReactNode` becomes the default `<slot />`.
   Callback props (`onClick`, `onToggle`) are deleted — with no framework
   there is no state to lift; interactivity is internal to the component.
   `style`/`class` passthrough is deleted and not replaced: a screen needing
   a one-off tweak is a signal the kit wants a variant. Where a spec's prop
   surface is messy, idiomatic Astro wins over API parity — the spec governs
   how the component *looks*, never how its code interface reads.

4. **Content vs data rule for inputs.** Arbitrary markup → a named slot
   (Card's header strip). Strings, numbers, enums the component formats
   itself → props. A `ReactNode` prop that only ever holds plain text in the
   screens downgrades to a string prop.

5. **Flat `src/components/`, PascalCase names 1:1 with the specs.** The
   Astro docs reserve only `src/pages/`; their own examples show a flat
   components directory, and 20 files sits comfortably within it. One
   component per file; a spec file declaring a helper interface (LogoTile
   inside `Card.d.ts`) yields a sibling file. The specs are retained through
   the build and deleted once all screens are realized — the live components
   and ADRs become the documentation, git history keeps the specs, and the
   design source of truth remains the claude.ai/design project.

6. **Zero client JS is the presumption.** Interactions are expressed as
   navigation or CSS wherever possible. The blog topic filter is plain links
   over static per-topic routes (`getStaticPaths`), the pattern Astro's own
   tutorial teaches for enumerable filters. The only component that ships a
   script is ThemeToggle, whose state is inherently client-side. Scripts are
   standard bundled `<script>` tags in the component file, selecting
   elements via `data-*` attributes; `is:inline` is reserved solely for the
   pre-paint theme init in the layout head (per the dark-mode research).
   Every future addition to the scripted list is a deliberate decision, not
   a default.

## Consequences

- Build tickets translate specs mechanically: data props copy over, children
  become slots, callbacks and style escape hatches vanish, and any API
  awkwardness is redesigned rather than reproduced.
- The kit stays override-proof: parents compose content through slots but
  cannot restyle a child's internals — variation grows as kit variants, not
  call-site patches.
- The global CSS surface stays small and stable (tokens, reset, prose);
  component CSS lives and dies with its component.
- The shipped JS for the whole site is one theme script plus the inline
  init. Filter states are real URLs — shareable, crawlable, JS-free.
- Exact prop-level parity with the reference kit is explicitly not a goal;
  visual parity is.

## Amendment: video embeds via astro-embed (2026-07-30)

Resolves wayfinder ticket
[#34](https://github.com/lukefredrickson/personal-site/issues/34) (part of
the [realize-the-design-system map, #18](https://github.com/lukefredrickson/personal-site/issues/18)).

The `VideoCard` spec (`docs/design/components/cards/VideoCard.*`) is
**dropped, not translated** — the design's card framing (title, duration
badge, rose play treatment) is placeholder. Ride posts embed vlogs with the
[`astro-embed`](https://astro-embed.netlify.app/components/youtube/)
`<YouTube>` component (`@astro-community/astro-embed-youtube`), imported
directly in MDX bodies and dropped inline with the prose.

Why a package over a hand-rolled iframe: `astro-embed` is the
community-idiomatic answer (maintained by Astro core contributors) and is a
[lite-youtube-embed](https://github.com/paulirish/lite-youtube-embed) facade —
build-time static poster, the real player loads only on click, via the
privacy-enhanced `youtube-nocookie.com` domain. That's the facade pattern's
performance (zero YouTube requests until play) with none of the hand-rolling.
Authoring is paste-friendly: `id` accepts a full watch/`youtu.be` URL; pass
`title` for the overlay and accessible name; the poster comes from YouTube
(`posterQuality` if the default looks soft).

Exceptions to this ADR's rules, accepted knowingly:

- **Rule 1/6 (pure Astro, zero client JS):** `<lite-youtube>` is a
  third-party custom element with a small script — the scripted list grows
  from one (ThemeToggle) to two. The alternative (bare always-loaded iframe)
  ships ~500 kB of YouTube player per pageview instead.
- **Rule 5 (components 1:1 with specs):** no `VideoCard.astro` will exist;
  this is the first spec consciously retired rather than built.
- **No-JS:** without JavaScript the poster and title render but play is
  dead. Accepted — a `<noscript>` watch link is a five-line additive fix if
  it ever matters.

The rose `--video` token loses its only consumer and stays dormant unless a
future design revives it.
