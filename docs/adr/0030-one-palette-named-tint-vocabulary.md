# 30. One palette-named tint vocabulary

Date: 2026-08-04
Status: Accepted
Amends the token story of
[11. Token activation](0011-token-activation-reference-tokens-to-live-styles.md)
(the tint and topic token families) and executes the presentation map
[13. Blog content model](0013-blog-content-model.md) specified, under the
one-word-everywhere rule of
[14. Blog tag pages and filter pills](0014-blog-tag-pages-and-filter-pills.md).

Resolves [#109](https://github.com/lukefredrickson/personal-site/issues/109).

## Context

The color vocabulary had drifted from the decisions that set it up. ADR 0013
specified pill colors as a presentation-side map of **tag → color token**, but
the code shipped an identity map (`code: 'code'`), so the tint tokens were
named after the tags they happened to serve — `--topic-code-*`,
`--topic-bikes-*`. ADR 0014 ruled one word everywhere for the tags concept and
explicitly rejected "topic" as a second name for it, yet a `Topic` type was
that second name, alive in `src/lib/topics.ts`.

Design-phase iteration left a second problem on top of the first: alias color
names that translate the palette into a parallel vocabulary. `pine` meant blue,
`green` meant foam, `sand` meant paper-over-ink. And three token families
described the single concept of a tint — `--topic-*`, `--video-pill-*`, and
`--tint-*`, two of whose four entries were literal aliases of `--topic-*` pairs.

The cost is the same in each case: to know what color a thing is, you
dereference a name that means another name. A `video` member of `Topic` that no
caller ever rendered kept a whole type split (`Topic` / `TagTopic`) alive to
serve it.

## Decision

**One vocabulary, named by the palette.**
`type Tint = 'blue' | 'foam' | 'gold' | 'rose' | 'neutral'` in `src/lib/tints.ts`
is the only color vocabulary in TypeScript. The four hue members are the
palette's own ramp names (§0 of `colors.css`). `neutral` is deliberately
semantic rather than a hue: it names the absence of a tint, and is the one tint
built from two ramps (paper in light, ink in dark), so no hue names it
truthfully.

**No alias color names, ever.** `pine`, `green`, and `sand` are retired, in
tokens, class names, and prose — including `--p-green*`, which becomes
`--p-foam*`. Any color reference anywhere points at a palette hue.

**The tag → tint map is a real map.** `tintOf(tag)` resolves `code → blue`,
`bikes → foam`, with `neutral` for anything unmapped — an unmapped tag stays
fully functional, just untinted (ADR 0013). Coloring a tag is the one-line edit
ADR 0013 promised.

**One CSS token family.** `--tint-{hue}-{bg,fg,line}` replaces `--topic-*`,
`--video-pill-*`, and the old `--tint-{pine,gold,sand,green}` aliases. Values
carry over verbatim; nothing repaints. A hue carries only the slots something
reads: blue and foam have all three (chips need `bg`/`fg`, filter pills need
`line`/`fg`), gold, rose, and neutral are washes with a `bg` alone. Minting an
`fg` for a hue that has never worn text is a design decision, not a rename, so
it waits for the design that needs it.

**Role tokens layer over the palette.** The Latest badge keeps `--latest-*`,
now pointing at `--tint-blue-*`. A role token referencing a palette-named token
is the layering working; a role token that *is* a second name for a palette
value is the alias problem.

**Dead plumbing goes.** The `video` member, the `Topic`/`TagTopic` split it
forced, the `.video` chip rule, and `--video-pill-*` are deleted. `rose` stays
in the vocabulary as a wash — it is what an in-prose video card would wear if
one is ever built.

**One sweep.** Tag chips, filter pills, logo tiles, and framed figures all take
`Tint` and apply it as a `class:list` variant class (`.blue`, `.foam`, …), the
documented Astro idiom; scoped styles keep bare variant class names safe. Chips
and pills wear the hues a tag can reach; the two surface-tint components wear
the whole set.

## Alternatives considered

- **Keep `--topic-*` and rename only the type** — leaves the naming defect
  where it hurts most. A token named for a tag cannot be reused by a logo tile
  without lying about what it is.
- **Give every hue all three slots** — a full 5 × 3 grid reads tidy but mints
  color decisions (a gold chip's text color) that no design has made, and
  bloats the token set the coding standards keep deliberately small.
- **Drop `rose` and `gold` from the type, leaving `blue | foam | neutral`** —
  matches what tags use today, but the tiles and figures already wear gold, and
  a shared vocabulary that omits half the palette invites the next local color
  union.
- **A `tint-` class prefix (`.tint-blue`)** — the prefix guards against
  collisions that Astro's scoped styles already prevent, and made the two
  tinted-surface components disagree on their class shape.

## Consequences

- A stale color name fails `npm run check`: `'code'`, `'pine'`, and `'sand'`
  are not members of `Tint`, so the old vocabulary cannot creep back through
  the type system.
- Zero visual change. Every token value is carried across unchanged; the
  preview URL should be pixel-identical to production.
- One place to color a tag (`tints.ts`) and one place to change what a color
  *is* (`colors.css` §2).
- Components handed a tint they do not style render untinted. The type is the
  vocabulary, not a promise that every component paints every member — the
  hue-to-slot table above is where that is decided.
- ADR 0011's inventory of live tokens is historical for this family; the tint
  tokens it lists by their old names resolve in git history.
