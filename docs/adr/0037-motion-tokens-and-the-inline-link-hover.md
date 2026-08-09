# 37. Motion tokens, and the Inline link hover built on them

Date: 2026-08-09
Status: Accepted

Resolves [#139](https://github.com/lukefredrickson/personal-site/issues/139),
under PRD [#137](https://github.com/lukefredrickson/personal-site/issues/137).

## Context

Nothing on the site reacts to the cursor. An Inline link (ADR 0036) is the
first link to get hover feedback: the color brightens and an underline sweeps in
from the left, retreating the way it came on leave.

Two things are missing before that can be written. The site has no shared
duration or easing — the only animation in the tree, the theme toggle's knob,
carries its own `0.18s ease` literal. And there is no color for a hovered link:
`--link` is the only rose semantic token.

PRD #137 has ten more link kinds queued behind this one (#140). Whatever this
ticket writes for durations and easing, every one of them reuses.

## Decision

**Motion tokens live in their own stylesheet.** `src/styles/motion.css` defines
three tokens and is `@import`ed from `global.css` with the other token files, in
the token block before `base.css`. This is the path ADR 0006 established for a
new live partial, so the entry point stays the layout's single import.

    --ease: ease-out;
    --duration-fast: 150ms;   /* color and background fades */
    --duration-slide: 200ms;  /* the Inline link underline slide */

One easing, and durations named by the job they time — the same shape as the
`--text-*` job tokens. `ease-out` is the keyword, not a hand-rolled
`cubic-bezier`: the house feel is quick-and-crisp, which is what the keyword
already is, and a bezier would be four magic numbers no one can read. The two
lengths sit either side of the toggle knob's 180ms so the site reads as one
hand. The toggle keeps its literal; migrating it is a #140-era cleanup, not a
change this ticket needs.

**`--link-hover` is `--p-rose`.** The palette already holds the step one
lightness above `--link` (`--p-rose-deep`), and nothing reads it. It is on the
ΔL-5 grid and it is already a `light-dark()` pair, so the hover color resolves
per theme with no theme-specific rule and no `calc()` — exactly what ADR 0011
asks of a semantic token.

**The slide is a second gradient layer.** ADR 0036 turned the underline into a
background gradient for this. The rule now paints two layers: the hover layer
first (so it paints on top), sized `0%` wide at rest, over the resting layer at
`100%`. Hover and `:focus-visible` set the hover layer to `100%`. Both layers
are positioned at `0 100%`, so the layer is left-anchored: it grows from the
left and shrinks back to the left, and the retreat comes free with no second
rule. `background-size` is not a layout property, so the text never moves.

**`:focus-visible` gets the hover state plus a ring** — a 2px `--link` outline
at 2px offset, the convention `ThemeToggle.astro` already set. The two selector
lists are separate: hover and focus share the visual state, only focus draws the
ring.

**Every transition sits behind `prefers-reduced-motion: no-preference`**, per
ADR 0012's site-wide rule. The hover and focus rules themselves are
unconditional, so a reduced-motion visitor gets the full brighter-color and
full-width underline instantly.

## Alternatives considered

- **A `--motion-*` prefix on all three tokens.** Reads as a filing system, not
  as a job. `transition: color var(--duration-fast) var(--ease)` already says
  what each token is.
- **One duration for both properties.** The underline crosses the whole word and
  the color does not, so equal durations make the slide feel slower than the
  fade. Two lengths, 50ms apart, is the smallest split that fixes it.
- **A `cubic-bezier` house curve.** Deferred, not rejected. The token is the
  seam: when the site earns a signature curve, one line changes.
- **Tokens appended to `spacing.css` or `colors.css`.** Both files are one
  concern each, and a duration is neither. A fourth token file costs one
  `@import`.
- **Animating `width` on a pseudo-element instead.** ADR 0036 already ruled the
  pseudo-element out: it cannot span a wrapped link's line fragments.
- **`transition: all`.** Sweeps up every future property on the rule, including
  ones that trigger layout. Naming the two properties keeps the animation on
  paint.

## Consequences

- `#140` inherits the tokens and the focus-parity convention; it adds no motion
  vocabulary of its own.
- `--link-hover` is a semantic token, not an Inline-link token — the nav,
  buttons, and card titles that #140 touches read it too.
- The `background-size` transition animates paint, not layout, but it is not
  compositor-only: a hovered link repaints its underline strip each frame. One
  1.5px strip per hovered link is cheap; a page-wide use of the same technique
  would not be.
- Two gradient layers now sit on every Inline link at rest, one of them zero
  width. That is the cost of the retreat coming free.
- Verification stays visual, per ADR 0028: a post page (including a link that
  wraps across lines) and the author card, both themes, with
  `prefers-reduced-motion: reduce` emulated and by keyboard tabbing. The repo
  has no CSS test infrastructure and this ADR does not create any.
