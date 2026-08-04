# 30. Text-anchored decoration sizes in rem

Date: 2026-08-04
Status: Accepted
Amends: ADR 0011 §3, Units (the px/rem test gains one carve-out)

Resolves [#107](https://github.com/lukefredrickson/personal-site/issues/107),
grilled 2026-08-03.

## Context

The home page's promotion ladder marks each role with a dot. The dot was
`12px` in a `12px` column, dropped onto the title with `padding-top: 2px`.

Two defects, one cause. A reader who raises their browser's default font size
gets larger type and a dot that stays 12px — shrinking against the text it
labels and drifting out of line as the title's line box grows around it. Even
at the default 16px root, the 2px nudge lands the dot ~4px above the title's
cap-height center: a hand-tuned number tuned against type it doesn't read.

ADR 0011 §3 sets the units test — "should this scale with the reader's default
font-size?" — and answers it *no* for decoration. Read literally, the dot is
decoration, and that reading is what produced the bug: this is decoration whose
entire job is to point at one specific piece of text.

## Decision

**Decoration that must visually register against a specific piece of text sizes
in rem.** Everything else keeps ADR 0011's px rule.

In `RoleEntry.astro`:

- The dot's diameter and the timeline column's width are `0.75rem`.
- The dot's row is the title's first line box —
  `calc(var(--text-item-title) * var(--leading-body))` — and the dot centers in
  it. The timeline column becomes a two-row grid (line box, then the rail's
  `1fr`); the `padding-top: 2px` nudge is deleted with no replacement magic
  number.
- `.title` states `line-height: var(--leading-body)` rather than inheriting the
  reset's `1.5`, so the row height reads the same two tokens the title renders
  with.
- The dot's ring (`--border-w`), the rail's thickness, and the inter-card
  connector stay px: stroke weights are exactly what the px rule is for, and
  the connector is page-centered rather than aligned to the dot column.

`0.75rem` stays a local value in the component. It has one consumer; it becomes
a token when a second text-anchored marker appears.

## Alternatives considered

- **em instead of rem.** Tempting — em reads as "relative to the text". But the
  dot is not inside the title; it sits in a sibling column inheriting the
  card's font-size, so em would track the card, not the title. That is the
  appearance of derivation without the fact, and it compounds through any
  future wrapper that sets a font-size. rem keeps the math flat against the
  root. The role title is `1rem` today, so the two values coincide anyway.
- **Keep px, scale the dot at breakpoints.** Media queries answer viewport
  width, not the reader's font-size preference — the axis this bug is on.
- **Keep the 2px nudge, scale only the diameter.** The nudge is correct at
  exactly one root size; scaling the dot without fixing the derivation trades
  one misalignment for a worse one.
- **Promote `0.75rem` to a spacing token.** The spacing scale is px by rule; a
  lone rem member would blur the rule this ADR is trying to keep sharp, for a
  single consumer.

## Consequences

- The ladder stays proportionate and aligned at any root font size, and browser
  zoom is unaffected (it scales px and rem alike).
- The units rule now has an exception. The test to apply: *does this decoration
  have to line up with a specific piece of text?* Stated in `spacing.css`'s
  header comment as well as here, because that comment is what a contributor
  reads first.
- Changing `--text-item-title` moves the dot with it. The one drift to watch is
  the title's `line-height`: the row calc and the `.title` rule must name the
  same `--leading-*` token, so they sit in the same file, commented.
- Verification is visual, at the rendered page — the repo has no CSS test
  infrastructure and this ADR does not create any (ADR 0028). The check is the
  home page at a 16px root and at a forced 24px root.
