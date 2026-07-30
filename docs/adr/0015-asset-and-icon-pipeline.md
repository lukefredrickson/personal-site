# 15. Asset and icon pipeline

Date: 2026-07-30
Status: Accepted
Amends: [13. Blog content model](0013-blog-content-model.md) (post directory
layout and slug derivation)

Resolves wayfinder ticket [#27](https://github.com/lukefredrickson/personal-site/issues/27)
(part of the [realize-the-design-system map, #18](https://github.com/lukefredrickson/personal-site/issues/18)).
The icon *mechanism* — `@lucide/astro` build-time inline SVG components — was
already decided by [ADR 0012](0012-theming-mechanism-and-theme-toggle.md) and
is not re-litigated here.

## Context

`docs/design/assets/` holds reference icons, employer logos, and a headshot;
the post designs add hero and in-body photos. Four things remained undecided:
whether a shared `Icon.astro` wrapper belongs on top of `@lucide/astro`; where
images live (`src/` vs `public/`); where *post-specific* assets live relative
to their post; and how `astro:assets` optimization is applied when rendering.

The site is fully static, so Sharp runs at build time — the Cloudflare
passthrough-image-service caveat applies only to on-demand rendering and is
irrelevant here.

## Decision

**Icons: direct `@lucide/astro` imports, no wrapper, library defaults.**
Call sites import icons by name (`import { Moon } from '@lucide/astro'`) and
render them as-is — Lucide's defaults (24px, stroke-width 2), with per-call-site
props where a screen needs a specific size. No `Icon.astro` wrapper, no global
CSS enforcement of the UI kit's 16px / stroke-1.5 spec. Icons will render
slightly heavier than the reference screens; tuning (or a retrofitted wrapper)
is build-time visual polish and touches nothing structural, since the import
mechanism stays identical either way.

**Storage: `src/` for everything rendered; `public/` only for URL-stable
files.** Any image that appears on a page lives under `src/` so `astro:assets`
can optimize it: imports are typo-checked at build time, dimensions are
inferred (no layout shift), and the 992KB headshot JPEG ships as a small
hashed WebP. `public/` keeps only files needing stable, unprocessed URLs —
favicons today; a résumé PDF or `robots.txt` later. Shared site imagery
(headshot, employer logos) lives in `src/assets/`.

**Post assets: colocated, folder-per-post — amending ADR 0013.** The blog
layout becomes `src/content/blog/<year>/<slug>/post.{md,mdx}`:

- The **directory name is the slug**; `generateId: ({ entry }) =>
  entry.split('/')[1]` replaces ADR 0013's directory-stripping,
  filename-as-slug derivation. The loader pattern narrows to
  `*/*/post.{md,mdx}`, so only `post.md`/`post.mdx` files become entries.
- Everything a post owns — hero and body photos, one-off MDX components, demo
  files — lives in its directory, invisible to the collection. Frontmatter
  (`hero: "./hero.jpg"`, via the `image()` schema helper) and Markdown
  `![]()` resolve relative to `post.md`; MDX imports siblings
  (`import Demo from './Demo.astro'`).
- `post.md` over the more common `index.md`: identical to the loader, and a
  row of editor tabs all named `index.md` is a known annoyance.
- Year folders stay organizational only; ADR 0013's duplicate-slug build
  guard still catches a slug reused across years. Everything else in ADR 0013
  (schema, tags, URLs, ordering, drafts) stands.

**Rendering: `<Image>` everywhere, global responsive layout.**
`image: { layout: 'constrained' }` in `astro.config` gives every optimized
image — including plain `![]()` images in post bodies — a multi-width
`srcset`, lazy loading, and reserved dimensions. Templates (heroes, headshot)
use `<Image>` explicitly; post bodies stay plain Markdown and ride the same
pipeline. Output format is the WebP default.

## Alternatives considered

- **`Icon.astro` wrapper with brand defaults** (16px / stroke 1.5 in one
  place): the strongest alternative, and cheap — but deferred until the brand
  tuning itself is wanted; a wrapper enforcing defaults nobody has chosen yet
  is speculative structure. Global CSS enforcement (`.lucide { … }`) was
  rejected outright: CSS beats SVG presentation attributes, so `size` props
  would silently stop working.
- **Photos in `public/`**: no processing, hand-written dimensions, runtime
  404s on typos, and the full-size JPEG ships as-is. Nothing here needs a
  stable public URL.
- **Central `src/assets/blog/<slug>/`**: keeps the content tree text-only,
  but every reference crosses the tree and the slug-named folder duplicates
  what the filesystem already encodes — rename the post, remember the folder.
- **Keeping ADR 0013's flat files** (`<year>/<slug>.md` + photos loose in the
  year folder): fine for text-only posts, but photo-heavy ride posts and
  one-off MDX components would pile unowned files into shared year folders.
  Folder-per-post makes the post the unit that travels (and deletes) whole.
- **`<Picture>` with AVIF**: another ~15–25% on top of WebP at the cost of
  N-format builds (AVIF encoding is slow) and heroes diverging from in-body
  Markdown images. No screen needs art direction. It's a same-props,
  per-call-site swap if a real need appears.

## Consequences

- Writing a post = making one directory (`2026/my-post/`) with a `post.md`
  inside; the directory name is the URL. Renaming the directory breaks the
  link, same trade ADR 0013 accepted for filenames.
- Adding an icon = one named import; the whole Lucide set is available,
  tree-shaken to what's used. The 16px / stroke-1.5 UI-kit spec is
  consciously unenforced until visual tuning happens against real screens.
- A deleted post leaves no orphaned assets; a missing image fails the build
  instead of 404ing in production.
- Build time grows with photo count (Sharp per-width variants) — acceptable
  static-site economics; revisit only if CI minutes ever hurt.
