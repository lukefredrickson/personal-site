# 31. Motion tokens, and the inline link's gradient underline

Date: 2026-08-07
Status: Accepted

Resolves [#139](https://github.com/lukefredrickson/personal-site/issues/139),
part of PRD [#137](https://github.com/lukefredrickson/personal-site/issues/137),
grilled 2026-08-07. Builds on ADR 0012's reduced-motion rule and ADR 0011's
color-token grid.

## Context

Nothing on the site reacted to the cursor. The first hover treatment to land —
an inline link that brightens and sweeps an underline in from the left — forced
two decisions that everything after it inherits.

**Where durations and easings live.** The one animation the site already had,
the theme toggle's knob, carries its numbers inline (`0.18s ease`). One more
component doing the same starts a scatter of magic numbers that can never be
retuned together.

**What an underline is.** The inline link's underline was a `border-bottom`.
A border paints outside the background painting area, so a second, animated
band can be layered neither onto it nor across it. The slide had nowhere to
happen.

## Decision

### Motion tokens: two durations and one curve, in `motion.css`

A new single-concern token file in the global manifest, beside colors,
typography, and spacing:

- `--dur-fast: 150ms` — a color or background fade.
- `--dur-slide: 200ms` — anything that travels a distance.
- `--ease-out: ease-out` — the house curve.

Two durations, not a full 100/200/300/500 ramp: tokens are minted when
something needs them (ADR 0011), and a scale invented ahead of its call sites
is a guess about work not yet done. Both are quick on purpose, so the set reads
as one personality with the 180ms knob rather than a slower second one. The
curve is the CSS keyword, not a hand-tuned bezier — decelerating into rest is
the entire requirement, and the token's value is the single name to change if
that stops being true.

The toggle's inline `0.18s ease` is left alone. It is neither duration, and
rounding it to a token to make the numbers tidy would change shipped motion for
bookkeeping.

### The underline is two stacked background gradients

`border-bottom` becomes two `linear-gradient` layers on the same box: a resting
band in `--link` at full width, and above it a hover band in `--link-hover` at
zero width. Hover animates `background-size` on the top layer to `100%`. Both
layers anchor bottom-left, which is what makes the leave animation free — the
band shrinks back the way it came with no reverse rule.

Alignment is preserved by `padding-bottom: var(--border-w)`, which drops the
gradients exactly where the border sat. Vertical padding on an inline box does
not grow its line box, so the resting rendering is pixel-identical and no text
moves. `box-decoration-break: clone` gives every fragment of a wrapped link its
own band and its own sweep.

Rejected alternatives: an `::after` bar with `transform: scaleX()` (a
pseudo-element cannot follow a link that wraps across lines — the exact case
user story 4 names); animating `text-decoration-thickness` or
`text-underline-offset` (both move the underline rather than draw it in, and
neither can carry a second color).

Cost, accepted: `background-size` is not a compositor-only property, so the
sweep paints each frame. It is a band a few pixels tall on a few words — the
cheapest paint on the page — and it buys the wrapped-line behavior nothing else
offers.

### The build's CSS target states the site's real floor

`box-decoration-break` is what makes a wrapped link sweep per fragment, and
WebKit only dropped the `-webkit-` prefix in 18.2. The prefix is hand-written
(no autoprefixer here) — and esbuild was deleting it, reading Vite's default
CSS target as permission. `vite.build.cssTarget` now names the floor
`colors.css` already documents (`chrome123`, `safari17.5`, `firefox120`), which
is the floor `oklch()` and `light-dark()` set. Without it the sweep degrades on
Safari 17.5–18.1: a wrapped link animates as one unbroken box instead of per
line.

### Hover and focus are one state; the ring is extra

`:hover` and `:focus-visible` share a single rule, so a keyboard user sees
exactly what a mouse user sees. `:focus-visible` adds `2px solid var(--link)`
at `2px` offset — the convention `ThemeToggle.astro` already set.

### `--link-hover` references an existing palette step

`--link` is `--p-rose-deep`; `--link-hover` is `--p-rose`, one ΔL-5 step
brighter and previously unused. No new palette entry, no `calc()`, no
theme-specific override — it resolves per theme through the `light-dark()`
already inside `--p-rose`, exactly as ADR 0011 requires.

### Reduced motion gates the transition, never the state

Per ADR 0012, the `transition` declaration sits alone behind
`@media (prefers-reduced-motion: no-preference)`. The hover and focus rules are
unconditional, so a reader who asks for less motion still gets the full
feedback — it snaps instead of sliding.

## Consequences

- Later hover work (#140 and beyond) has durations, a curve, and a
  reduced-motion shape to reuse rather than re-decide. A third duration is a
  cheap addition when something actually needs one.
- Any future restyling of the inline link's underline goes through
  `background-size`/`background-image`, not `border-*`. The `padding-bottom`
  is load-bearing alignment, not spacing.
- The site's first `--link-hover` exists; other link kinds may adopt it, but no
  bare-anchor rule was added, so nothing inherits the treatment by accident.
- The build now has a stated CSS target. Every hand-written prefix in this repo
  depends on it, so lowering it is a decision, not a tidy-up.
