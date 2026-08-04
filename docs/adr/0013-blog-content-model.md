# 13. Blog content model

Date: 2026-07-30
Status: Accepted
Amended by: [15. Asset and icon pipeline](0015-asset-and-icon-pipeline.md) —
posts become folder-per-post (`<year>/<slug>/post.{md,mdx}`) with the slug
taken from the directory name instead of the filename; colocated assets live
in the post directory. Everything else here stands.
Amended by: [20. Read time via a Sätteri mdast
plugin](0020-read-time-via-a-satteri-mdast-plugin.md) — the pipeline's "no
plugins" stance and the deferral of read time (with its `entry.body`
suggestion) are superseded. The processor choice itself stands.
Amended by: [21. Draft visibility on preview
deploys](0021-draft-visibility-on-preview-deploys.md) — the
`import.meta.env.PROD ? !draft : true` filter, and the deferred consequence
that preview deploys hide drafts. The one-helper rule stands.

Resolves wayfinder ticket [#24](https://github.com/lukefredrickson/personal-site/issues/24)
(part of the [realize-the-design-system map, #18](https://github.com/lukefredrickson/personal-site/issues/18)).
Grounded in the content-collections research
(`docs/research/astro-content-collections.md`, branch
`research/astro-content-collections`).

## Context

The blog designs (`docs/design/ui-kit/BlogIndex.jsx`, `PostTech.jsx`,
`PostRide.jsx`) demand: a year-grouped, topic-filterable index; posts with
structured metadata (title, date, tags, hero image); and in-prose custom
blocks — stat chips, video cards, photo grids, filename-headed code blocks.
Astro content collections (glob loader + Zod schema) are the established
mechanism, but the model itself — schema, format, URLs, ordering — was
undecided.

Two constraints shaped the decision. First, authoring friction: posts should
start as plain Markdown and graduate to richer formats without ceremony, and
later edits (adding an island to an old post) should meet no resistance.
Second, taxonomy flexibility: no rigid post types. Early drafts of this
decision had a `type: tech | ride` enum with type-gated fields (ride posts
require stats); this was rejected as boutique — any post may use any block,
and tags are an open vocabulary, not an enum.

## Decision

**One collection, mixed format.** A single `blog` collection,
`glob({ pattern: "**/*.{md,mdx}", base: "./src/content/blog" })`. Posts are
`.md` until they need components or islands, then rename to `.mdx` — full MDX
freedom after graduation, per the friction constraint.

**Open tags, everything derived.** `tags: z.array(z.string())`, no enum. The
index's filter pills, counts, and any tag pages are derived at build time from
the union of tags in use (the idiomatic Astro pattern — see the official blog
tutorial's tag pages). Pill colors come from a presentation-side map
(tag → color token) with a neutral default; an unmapped tag is fully
functional, just uncolored. There is no `type` field: the tech and ride
screens are one post layout whose optional sections render when their data
exists.

**Lean schema — frontmatter is only what other pages need** (index, feeds,
OG tags; the post body owns everything else):

```ts
schema: ({ image }) => z.object({
  title: z.string(),
  description: z.string(),          // required; doubles as meta description
  pubDate: z.coerce.date(),
  updatedDate: z.coerce.date().optional(),
  tags: z.array(z.string()).default([]),
  hero: image().optional(),
  heroAlt: z.string().optional(),   // required-if-hero, enforced via .refine()
  heroCaption: z.string().optional(),
  draft: z.boolean().default(false),
})
```

Boutique blocks — stat chips, video cards, photo pairs — are MDX components in
the body, not frontmatter. Consequence accepted: stats are not queryable
across posts (no "total miles this year" from frontmatter); that feature, if
ever wanted, would be built differently anyway.

**URLs: `/blog/` and `/blog/<slug>/`, dateless.** Slug = filename, with no
frontmatter override — one URL story, zero exceptions. Files live in year
folders (`src/content/blog/2026/…`) purely for browsability; a
directory-stripping `generateId` keeps URLs flat, so moving a file between
year folders changes nothing rendered. `pubDate` remains the single source of
truth for ordering.

**Duplicate-slug build guard.** Stripping directories narrows the filesystem's
uniqueness guarantee to per-folder, so `generateId` closes the gap: a
module-scope `Map<id, sourcePath>` in `src/content.config.ts` throws a legible
build error naming both files on collision. The `prior !== entry` guard is
load-bearing — dev-server re-syncs re-run `generateId` for the same file. The
check must live here: the content data store is keyed by id, so by
`getCollection()` time a duplicate has already silently clobbered its twin.

**Ordering: `pubDate` descending, one helper.** A shared
`getPublishedPosts()` (in `src/lib/`) applies the draft filter
(`import.meta.env.PROD ? !draft : true`) and the sort (id tie-break for
deterministic builds) so no call site can forget either. Prev/next is computed
in `getStaticPaths()` and passed as props — prev = older, next = newer,
matching the designs.

**Pipeline: default Sätteri processor, no plugins.** Nothing decided here
needs remark/rehype; `markdown.processor` is one reversible config key if a
future post demands a unified-only plugin. Read time (shown in the designs) is
**deferred entirely** — it touches no schema, so it can return later as purely
additive work.

## Alternatives considered

- **MDX everywhere**: uniform, but plain posts pay import boilerplate and lose
  Markdown portability for components they don't use.
- **Markdoc**: central component registration, but a third syntax, a second
  config surface, and the least-trodden Astro path.
- **Two collections (tech/ride)**: clean per-type schemas, but every query
  merges two collections, cross-type prev/next gets painful, and straddling
  posts have no home. The index design — one stream, shared filters — is the
  tell for a single collection.
- **Title-derived slugs** (`generateId` from `data.title`, slug override for
  long titles): retitling a published post would silently change its URL, and
  duplicate titles collide at data-load time where one entry shadows the
  other. Filename-as-slug makes the common case (title edits) safe and
  collisions structurally impossible within a folder.
- **Dated URLs** (`/blog/2026/…`): adds nothing frontmatter doesn't already
  hold, and turns publish-date slips into broken links.
- **Read time via the official remark recipe**: would force the whole project
  off Sätteri onto `unified()` — a byline stat dictating the Markdown engine.
  Rejected; read time deferred instead.

## Consequences

- Writing a post = creating one `.md` file in the right year folder. The
  filename is the URL; renaming a published file breaks its link (accepted —
  filenames rarely change post-publish).
- New tags, pills, counts, and tag pages appear on the next build with no
  code or schema change; only pill *colors* take a one-line map entry.
- Draft posts can merge to `main` and preview locally without publishing.
  Deferred: making drafts visible on preview deploys (preview builds are
  `PROD`, so drafts are hidden there too) — taken up in ADR 0021.
- Still open, cut as a follow-on decision ticket: code-block filename headers,
  Shiki theming approach, and topic-filter interactivity (static tag pages vs
  client-side filtering).
