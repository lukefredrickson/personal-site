# 14. Blog tag pages and filter pills

Date: 2026-07-30
Status: Accepted

Resolves wayfinder ticket [#26](https://github.com/lukefredrickson/personal-site/issues/26)
(part of the [realize-the-design-system map, #18](https://github.com/lukefredrickson/personal-site/issues/18)).
Builds on the content model ([ADR 0013](0013-blog-content-model.md)) and the
zero-client-JS presumption ([ADR 0010](0010-astro-component-authoring-conventions.md),
decision 6).

## Context

The blog index design (`docs/design/ui-kit/BlogIndex.jsx`) shows a topic
filter: a row of pills (`everything · 6`, `code · 3`, …) that narrows the
year-grouped post list. The kit implements it as React `useState` — client-side
filtering. ADR 0010 already replaced that mechanism with plain links over
static per-tag routes via `getStaticPaths`, zero client JS. ADR 0013 replaced
the kit's one-topic-per-post enum with open multi-value `tags`.

What remained: the route shape, which tags earn pills, how counts are
computed and ordered, how the "everything" pill relates to the index, and the
tag-string/URL relationship.

One fact forces the route shape: posts already occupy the flat namespace at
dateless `/blog/[slug]/` (ADR 0013), so a flat `/blog/[tag]/` route would
compete for the same URL pattern and collide with any post slug matching a
tag name.

## Decision

**Routes.** Tag pages live at `/blog/tags/[tag]/`. "Tags" (not "topic")
because ADR 0013 named the concept: one word everywhere — schema field, route
segment, presentation map. No bare `/blog/tags/` index exists; the pill row on
the blog index is the tag directory.

**Every tag in use gets a pill and a page.** Fully derived at build time, no
curation, no config. If the pill row ever grows unwieldy, curating it down
(e.g. pills only for presentation-map tags) is a small presentational change
with no URL breaks, since pages exist for every tag regardless.

**Counts derive from `getPublishedPosts()`.** A tag's count is the number of
published posts carrying it; "everything" is the total. Computed in plain JS
in the pages that render the pill row, passed to `FilterPill` as props.
Because posts carry multiple tags, tag counts legitimately sum past the
everything count — inherent to tags, not a bug.

**Ordering: "everything" first, then count descending, alphabetical
tie-break.** Most-used tags lead; the long tail sinks to the end;
deterministic builds.

**`/blog/` is the everything page.** The "everything" pill links to `/blog/`
and renders active there — it is the unfiltered index, not a tag. Tag pages
render the identical screen (intro, pill row, year-grouped list) filtered to
their tag, with their pill active. Every pill is always an `<a>`, including
the active one (`aria-current="page"`); conditionally unwrapping the anchor
buys nothing.

**Tag is slug.** A Zod refinement constrains tags to lowercase kebab
(`^[a-z0-9]+(-[a-z0-9]+)*$`), so the tag string is the route segment and the
pill label with no mapping layer. A typo'd `Bikes` vs `bikes` becomes a build
error instead of two silently separate pages. Cost: no display names with
spaces or capitals — no loss for this site's lowercase design language.

**Tag chips link.** `TagPill` chips on post list items and posts link to
their tag page — the "more like this" affordance, and the path that keeps
long-tail tags reachable if the pill row is ever curated down.

## Alternatives considered

- **Flat `/blog/[tag]/`** — collides with the post-slug namespace; off the
  table.
- **`/blog/topic/[topic]/`** — carries a second name for a concept ADR 0013
  already named `tags`.
- **Curated or top-N pill rows** — speculative complexity now; adoptable
  later without breaking URLs if the tag tail grows.
- **Slugify free-form tags** — a tag→slug mapping layer everywhere (routes,
  links, active-pill matching) to permit display casing the design never
  uses; constraining input is strictly simpler.

## Consequences

- The blog index and tag pages share one layout component; the only variance
  is the filter predicate and the active pill.
- Adding a tag to a post is the entire workflow: the pill, page, and counts
  appear on the next build.
- The tag vocabulary is self-policing at build time (kebab refinement, and
  ADR 0013's duplicate-slug guard pattern extends naturally if ever needed).
- Revisit triggers: a wrapping pill row (curate per above) or a real need for
  display names (introduce a mapping layer then).
