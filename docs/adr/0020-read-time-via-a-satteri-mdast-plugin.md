# 20. Read time via a Sätteri mdast plugin

Date: 2026-08-04
Status: Accepted
Amends: [13. Blog content model](0013-blog-content-model.md) — its "default
Sätteri processor, **no plugins**" stance and its deferral of read time. The
processor choice stands; the "no plugins" half does not.

Resolves ticket
[#55](https://github.com/lukefredrickson/personal-site/issues/55), grilled
from the [realize-the-design-system map,
#18](https://github.com/lukefredrickson/personal-site/issues/18).

## Context

The blog designs showed a "6 min read" stat on posts. ADR 0013 deferred it:
the official Astro recipe is a remark plugin, and adopting it would have meant
setting `markdown.processor` to `unified()` for the whole site — a byline stat
dictating the Markdown engine. The deferral was explicitly "purely additive
work" for later, with `entry.body` (a raw-source word count in a helper)
floated as the cheap way back.

Since then Astro 7 shipped Sätteri as the default processor with its own
plugin model, and the deferral's premise — that read time forces a processor
switch — no longer holds. What remained undecided was whether to spend a
plugin on it at all: a raw-source helper over `entry.body` is ~15 lines and
zero risk.

Two things were genuinely unknown going in. Sätteri's plugin API is not
remark's, so the recipe does not port verbatim; and neither Astro's nor
Sätteri's docs describe how a value computed in a plugin reaches a template —
the `ctx.data` document bag is documented, its route to `render()` is not.

## Decision

**An mdast plugin on the default processor**, `src/lib/reading-time.ts`,
registered through `satteri({ mdastPlugins: [...] })`. The processor is the
same one ADR 0013 chose; naming it explicitly is what lets a plugin ride
along. MDX extends the Markdown config by default, so one registration covers
`.md` and `.mdx` alike.

**Chosen over the `entry.body` helper for its learning value** — this is a
learning project, and the plugin teaches the API of the processor the site
already runs on, where the helper teaches nothing and reads the wrong artifact
(raw source, frontmatter and fences included). The spike below is what made
that choice cheap to unwind.

**A `text` subscription, and nothing else.** Sätteri dispatches visitors by
node type, and mdast's `code` and `inlineCode` are literals that hold their
content in `value` rather than in `text` children. Excluding code is therefore
structural — there is no skip test to get wrong, and no way for a code-heavy
tech post to advertise an inflated number.

**`max(1, ceil(words / 200))`, computed in the plugin.** 200 wpm is the
`reading-time` package's default and the de-facto standard.

**An integer, not a string.** The plugin injects `readingMinutes: 6`; the
`N min read` label is formatted in `src/lib/posts.ts` next to
`formatPostDate`. Wording changes never touch the Markdown pipeline.

**Post header only.** The meta row becomes date · read time · tags. List
surfaces deliberately show nothing, so no index page has to render every post
to build a row — and the dormant `readTime` props on `PostListItem` and
`FeaturedPostCard` are deleted rather than left as an invitation to wire them
up against this decision.

### The hand-off, as the spike established it

A temporary page printed `remarkPluginFrontmatter.readingMinutes` for every
post, and confirmed the route end to end for both formats:

    ctx.data.astro.frontmatter  →  entry.rendered.metadata.frontmatter
                                →  render(entry).remarkPluginFrontmatter

`data.astro` is the same bag remark plugins wrote to as `file.data.astro`, so
the recipe's *mechanism* survives the processor change even though its code
does not. The value arrives beside `post.data` rather than inside it: the
collection schema never sees it, and author-written frontmatter is untouched.

The spike also pinned down the one shape that is not obvious. There is no
end-of-document hook, so the plugin cannot total the words and publish once.
Instead the running tally lives on `ctx.data` (per document) and every text
node republishes the minute count — the last one wins. The tally must not live
in a closure: `mdastPlugins` entries are constructed once and reused across
every compile, so a closure would total the whole site.

## Alternatives considered

- **A raw-source word count over `entry.body`** — the option ADR 0013 left on
  the table, and the pragmatic pick: ~15 lines, no config change, no unknowns.
  It was held as the fallback if the spike dead-ended, with the rest of this
  spec (formula, placement, value shape) unchanged under it. Rejected on the
  learning contract, and because counting raw source means counting fences,
  URLs and image syntax as prose.
- **Switching to `unified()` and using the official recipe** — the thing ADR
  0013 refused, and the reason read time waited. Still refused: it swaps the
  processor for every file in the project to gain one byline stat.
- **A plugin factory** (`() => definition`, which Sätteri resolves per
  compile) so the tally can live in a closure — a cleaner-reading plugin, but
  `SatteriProcessorOptions.mdastPlugins` types entries as definitions only, so
  it would need a cast at the config. The `ctx.data` tally is the shape the
  types already describe.
- **Storing minutes in frontmatter** — always stale, and a field the author
  has to maintain. User story 4 exists to rule this out.
- **Read time on the index and home rows** — a list row only knows
  `post.data`, so every row would need its post rendered to get a number that
  helps nobody scanning a list.

## Consequences

- `astro.config.mjs` now imports `@astrojs/markdown-satteri` and names the
  processor. That import is astro's own direct dependency and the documented
  spelling, so nothing new lands in `package.json`.
- The estimate updates itself as a post is edited, for `.md` and `.mdx` alike,
  and there is nothing to keep in sync.
- Word counts are taken per text node, so a word split by an inline mark
  (`un**bel**ievable`) counts as more than one. At minute resolution this is
  invisible.
- A post with no prose at all — an all-code page — produces no count. The
  formatter's default supplies the one minute the floor would have.
- ADR 0013's pipeline paragraph is now half historical. The processor decision
  it made is still in force; "no plugins" was a description of what the model
  needed at the time, not a constraint, and this is the reversible config key
  it named.
