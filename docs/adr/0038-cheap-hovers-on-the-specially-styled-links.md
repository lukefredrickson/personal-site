# 38. Cheap token-based hovers on the specially-styled links

Date: 2026-08-09
Status: Accepted

Resolves [#140](https://github.com/lukefredrickson/personal-site/issues/140),
under PRD [#137](https://github.com/lukefredrickson/personal-site/issues/137).

## Context

ADR 0037 gave the Inline link a hover and minted the motion tokens it runs on.
Every other link on the site is still inert: the nav links, the buttons, the
filter pills, the Tag pill links, the Card links, and the two Utility links.

PRD #137 asks for cheap feedback on each of them — a color or background change
only. No movement, no bespoke animation, and no change to any resting state.
Two things are missing before that can be written: a hover color for the kinds
whose resting color has no brighter neighbor, and one rule shape that stops nine
components from each inventing their own.

## Decision

**Every kind writes the same three rules** in its scoped style: the hover and
`:focus-visible` state together, a `:focus-visible` ring (a 2px `--link` outline
at 2px offset, ADR 0037's convention), and the transition inside
`@media (prefers-reduced-motion: no-preference)` (ADR 0012). This ticket adds no
motion vocabulary of its own: `--duration-fast` and `--ease` time every color
and background fade, as ADR 0037 said they would.

**A hover brightens a link along its own resting color.**

- **Nav link** — `--text-muted` → `--ink`. The rule sets the color alone, so the
  border stays transparent and the active-page underline remains the only
  underline in the header.
- **Secondary button** — `--surface` → `--surface-raised`, the next surface
  step, which lifts in light and in dark.
- **Primary button** — a new `--btn-primary-bg-hover: var(--p-blue)`, the step
  one lightness above `--btn-primary-bg`: the relation `--link-hover` already
  has to `--link`.
- **Filter pill** — an idle pill fills with its own tint (`--tint-*-bg`), border
  untouched. Every hover selector carries `:not(.active)`, so the active pill
  keeps its inverted ink fill and the current page never flickers.
- **Tag pill link** — the wash deepens one step, to
  `--tint-{blue,foam,neutral}-bg-hover`. The selectors are `a.tag-pill`: a badge
  renders a `<span>` and stays inert.
- **Card link** — the card takes the hover, not the anchor. The chip row sits
  above the anchor's card-wide overlay, so a cursor over a chip would otherwise
  drop the title's hover on a region that still navigates. The title goes
  `--ink` → `--link`.
- **Utility link** — "all posts →" wears `--link`, so it brightens to
  `--link-hover`; "← all posts" wears `--text-muted`, so it brightens to
  `--ink`, the way a nav link does.

**The tint vocabulary gains a `bg-hover` slot** for the three tints a Tag pill
link wears. ADR 0030 mints a slot when a design reads it, and this is that
design. Light already holds the deeper wash, `w88`, ΔL 6 under the resting
`w94`. Dark had no step between `w36` and the saturated ramp, so §0 gains
`--blue-w42` and `--foam-w42` — the same ΔL 6, the same wash chroma of .03, in
the direction that reads as more present on a dark page. Neutral needs no new
palette entry: `--paper-93` and `--ink-40` are already there.

**The theme toggle joins the tokens.** Its knob held the site's last motion
literal, `0.18s ease`. ADR 0037 booked that migration for this ticket; the knob
now reads `--duration-slide var(--ease)`, 20ms longer, and the glossary's claim
that every transition on the site reads the motion tokens becomes true.

**The neighbor cards are in.** The issue lists five kinds and the prev/next pair
is not among them, but a neighbor card is a Card link by every other measure.
Leaving one link kind inert is the condition this ticket exists to remove, and
it costs the same three rules.

## Alternatives considered

- **A global hover utility class, or a shared partial.** ADR 0010 keeps global
  CSS to the tokens, the reset, and prose; the Inline link is its one exception
  because compiled markdown cannot carry a scoped class. These components can,
  so their rules stay scoped and the repetition is the price.
- **One translucent ink veil instead of five color tokens.** Cheaper in tokens,
  but a veil is a second background layer, and `background-image` does not
  interpolate from `none` — the fade would snap on every pill.
- **`color-mix()` to deepen a wash.** A computed color, which ADR 0011 keeps out
  of the palette exactly as it keeps `calc()` off L, C, and H.
- **Deepening the filter pill's border as well as its background.**
  `--border-soft` → `--border-strong` is paper-89 → ink-45 in light: a shout,
  not a hover.
- **Hovering the Card link's anchor instead of the card.** The anchor's overlay
  already covers the card, so this nearly works — until the cursor reaches the
  chip row, which sits above the overlay and would kill the title's hover.
- **A hover on the wordmark.** It already wears `--ink`. There is no brighter
  step and no muted state to leave.
- **Per-kind animation** — a button lift, a card shadow raise, an arrow nudge.
  Out of scope in PRD #137, and none of them is a color change.

## Consequences

- Nine components repeat the same three-rule shape. That repetition is the
  visible cost of scoped styles, and it is what makes each kind's hover legible
  next to its resting rule.
- A Tag pill link hovers only in blue, foam, and neutral. A tag mapped to gold
  or rose renders a link with no hover until its `bg-hover` slot is minted.
- The `:focus-visible` ring is now on every interactive element on the site, not
  just the theme toggle and the Inline link. A keyboard visitor gets the hover
  state and the ring together.
- The theme toggle's knob travels 20ms slower than it did.
- Verification stays visual, per ADR 0028: home, blog index, a tag page, a post
  page, and the 404, in both themes, with `prefers-reduced-motion: reduce`
  emulated and by keyboard tabbing. The repo has no CSS test infrastructure and
  this ADR does not create any.
