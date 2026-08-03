# 17. Head/meta baseline

Date: 2026-07-30
Status: Accepted

Resolves wayfinder ticket
[#39](https://github.com/lukefredrickson/personal-site/issues/39), part of map
[#18](https://github.com/lukefredrickson/personal-site/issues/18). Builds on
the blog content model (ADR 0013, which supplies `description` and `hero` per
post), the canonical domain (ADR 0003), and the theming mechanism (ADR 0012).

## Context

The base layout is still Astro-starter boilerplate: a hard-coded
`<title>Astro Basics</title>`, the starter favicons, and nothing else — no
meta description, no Open Graph tags, no canonical URL. Every one of the four
screens needs a head, and without a decided baseline each page would invent
its own, or worse, ship without one. The open questions: title conventions,
where descriptions come from, the social-card (OG/Twitter) tag set and image
strategy, favicons, canonical URLs, and where all this logic lives.

## Decision

**Architecture: a `BaseHead` component.** `src/components/BaseHead.astro`
with typed props — `title?`, `description` (required), `ogImage?`, `article?`
— rendered inside `BaseLayout.astro`'s `<head>`. This is the documented Astro
idiom (the Layouts guide's sample layout and the Configuration overview both
model exactly this). The layout also declares a `<slot name="head" />` escape
hatch so a page can inject one-off head tags (an RSS `<link>`, a `preload`)
without widening the props API. Config gains
`site: "https://lukefredrickson.dev"` and `trailingSlash: 'always'`.

**Titles: content-first, `·`-separated suffix.** Inner pages render
`<page title> · Luke Fredrickson`; omitting the `title` prop yields bare
`Luke Fredrickson` (Home). Blog index: `Blog · Luke Fredrickson`. Tag pages:
`Blog · <tag> · Luke Fredrickson`. Posts use the post title. No override
escape for the suffix rule — the no-prop fallback is the only exception.

**Descriptions: required, hand-written, no fallback.** `description` is a
required prop, so a future page missing one is a type error
(`npm run check`, ADR 0008), not an SEO papercut. Posts pass frontmatter
`description`; Home, the blog index, and tag pages write theirs inline in the
page files. No site-wide default string — duplicate descriptions are worse
than the discipline of writing one line per page.

**Open Graph / Twitter.** Always emitted: `og:title` (unsuffixed — card UIs
already show the domain), `og:description`, `og:url` (canonical),
`og:site_name`, and `og:type` — `website` by default, `article` on posts,
which adds `article:published_time` (`pubDate`) and `article:modified_time`
(`updatedDate` when present). `article:tag` is skipped (negligible consumer
support). `twitter:card` is derived, not hand-set: `summary_large_image` when
the page has an image, `summary` otherwise. The rest of the legacy
`twitter:*` set is skipped — unfurlers read OG tags.

**`og:image`: hero, else one static default card.** Posts with a `hero` use
it; everything else (Home, index, tag pages, hero-less posts) shares a single
static 1200×630 card — placeholder art now, redesignable without touching
code. Build-time generated per-page OG images (Satori/`astro-og-canvas`) were
considered and explicitly deferred: a real subsystem (template, build step,
font wrangling) that shouldn't block the build. Consequence accepted until
then: hero-less posts unfurl with the generic card, not their title.

**Canonical: automatic, trailing-slash form.** Every page emits
`<link rel="canonical">` computed as `new URL(Astro.url.pathname, Astro.site)`
— nothing per-page, query strings dropped by construction. URLs use the
trailing-slash form because the static build physically produces
`slug/index.html`. `trailingSlash: 'always'` makes dev agree: Cloudflare's
default `html_handling: "auto-trailing-slash"` redirects slashless requests
in prod (no user-facing 404s), while the dev server 404s them so a sloppy
internal link breaks loudly before merge instead of shipping a redirect hop.

**Favicons: the full modern set.** Adaptive `favicon.svg` (embedded
`prefers-color-scheme` query so the icon reads against a dark browser
toolbar), `favicon.ico` (32px legacy), 180×180 `apple-touch-icon.png`, and a web
manifest with 192/512px PNGs. All placeholder artwork; the decision is the
asset set the head links, so real icon design later swaps files, not code.

**Discoverability: sitemap + robots.txt.** `@astrojs/sitemap` (one config
line, reuses `site`), linked from `BaseHead` via
`<link rel="sitemap" href="/sitemap-index.xml">`; a static
`public/robots.txt` allows everything and points at the sitemap.

**Browser UI tint: `theme-color` follows the toggle.** Paired
`<meta name="theme-color">` tags with `prefers-color-scheme` media variants
cover the OS-tracking case, and ADR 0012's theme script also updates the meta
when the toggle fires — so the mobile browser's toolbar and status-bar tint
follows the site's actual theme, not just the OS setting.

## Alternatives considered

- **Site-name-first titles** (`Luke Fredrickson · Blog`): buries the
  distinctive words where tabs truncate. **Suffix-less titles**: cleaner tabs
  but loses attribution in search snippets and bookmarks.
- **Optional description with omission**: silently ships pages without meta
  descriptions; requiredness turns the mistake into a build error.
- **Head logic inline in `BaseLayout.astro`**: works, but the head is the
  fastest-growing part of the layout (theme script, fonts, this baseline);
  the dedicated component keeps it reviewable and is the documented idiom.
- **No web manifest**: was the lean default for a non-installable site;
  including it costs two PNGs and one JSON file and completes the set.
- **Skipping `theme-color`**: perfectly common; rejected because a browser
  toolbar tinted to the wrong theme is exactly the sloppiness the dual-theme
  work exists to avoid.

## Consequences

- Every page declares a `description` or fails typecheck; Home/index/tag-page
  descriptions live inline in their page files.
- `og:url`/`og:image` require absolute URLs, so `site` must stay correct in
  `astro.config.mjs`; preview deploys will emit production URLs in canonicals
  and OG tags (standard, harmless — previews aren't indexed).
- Internal links must be written with trailing slashes; dev 404s enforce it.
- Placeholder assets owed by the build: default OG card, favicon set,
  manifest icons.
- Generated OG images remain on the map as deferred fog, purely additive if
  ever revived.
