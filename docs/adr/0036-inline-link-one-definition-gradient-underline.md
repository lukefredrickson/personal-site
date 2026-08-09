# 36. The Inline link: one definition, underline as a background gradient

Date: 2026-08-09
Status: Accepted
Amends: ADR 0010 §2 (the global-CSS surface gains one shared class)

Resolves [#138](https://github.com/lukefredrickson/personal-site/issues/138),
a prefactor under PRD [#137](https://github.com/lukefredrickson/personal-site/issues/137).

## Context

A link inside running text — every link in a post's prose, plus the author
card's "home page" link — is the same visual thing: link color, `--weight-ui`,
no browser underline, a `--border-w` rule under the text. It was written twice:
once as `.prose a` in `prose.css`, once as `.bio a` scoped inside
`AuthorCard.astro`. Two copies, no name, and nothing that says they must agree.

PRD #137 gives this link an animated underline that sweeps in from the left on
hover. That animation needs a layer whose width can go from 0% to 100%, painted
exactly where the resting underline sits. A `border-bottom` cannot host it: the
border is outside the background painting area, so a background layer can never
line up onto it. Animating the border itself is not an option either — border
width animates the box, not a reveal.

So the hover ticket needs two things this ticket can hand it: one definition to
change, and an underline made of something a second layer can align to.

## Decision

**One definition, named.** The declarations move to a single rule in
`prose.css`, selector-listed as `.prose a, .inline-link`. Rendered markdown
opts in through the `.prose` wrapper — compiled markdown carries no classes, the
same reason ADR 0010 grants prose.css its exception. Everything else opts in by
wearing `.inline-link`; the author card does, and its scoped copy is deleted.
The term **Inline link** enters `CONTEXT.md` as the name for the treatment.

**No global bare-anchor rule.** `a { ... }` would reach every anchor on the
site — nav links, buttons, pills, card links — and each would then need an
override. Opt-in stays opt-in.

**The underline is a background gradient.** `background-image:
linear-gradient(var(--link) 0 0)`, sized `100% var(--border-w)` and positioned
at `0 100%`. `padding-bottom: var(--border-w)` extends the painting area to the
strip the border used to occupy, so the underline lands in the same rectangle
as before: the padding box, not the content box, is what `100%` resolves
against. `box-decoration-break: clone` (prefixed for the browser floor) makes
each fragment of a wrapped link paint its own underline — a bottom border did
that for free, a sliced background does not.

Nothing about the resting appearance changes. This ticket is a prefactor.

## Alternatives considered

- **`text-decoration: underline` with `text-decoration-color` and
  `text-underline-offset`.** The most semantic underline, and it handles wrapped
  lines and descenders on its own. But no part of it is a paintable layer, so
  the hover slide has nowhere to live — the whole reason for the swap.
- **Keep the border; slide a `::after` pseudo-element over it.** An inline
  element's pseudo-element is inline too: it cannot span a wrapped link's line
  fragments, and positioning it absolutely requires a positioned inline box
  whose geometry is the first fragment only. Wrapped links break.
- **`box-shadow: inset 0 -1.5px var(--link)`.** Paints inside the content box,
  so it sits above where the border was, and it has no sizeable axis to animate.
- **Leave the duplication and write the hover twice.** The two copies already
  drifted apart in their surrounding context; giving both an animation doubles
  the surface where they can disagree, and the PRD asks for exactly one place.
- **A new `links.css` partial.** A fourth global stylesheet for one rule, and
  it would move prose's link styling out of the file that styles prose. The
  rule sits where a reader looking for prose link styling already looks.

## Consequences

- The hover ticket adds a second gradient layer and a `background-size`
  transition to one rule, and both surfaces move together.
- `padding-bottom` on the Inline link is load-bearing, not spacing: it exists to
  put the painting area where the border was. Removing it lifts the underline
  into the text. It is commented at the rule.
- The global CSS surface is now tokens, reset, prose, and one shared class.
  ADR 0010 §2's list gains that fourth member; the presumption it protects —
  components style themselves, scoped — is untouched.
- `box-decoration-break` is unprefixed only from Chrome 130 and Safari 18, so
  the floor in `colors.css` needs `-webkit-box-decoration-break` too. Astro's
  default CSS minification target treats that prefix as redundant and deletes
  it, so `astro.config.mjs` now names the floor as the CSS target. Across the
  whole site that setting changes exactly one thing: the prefix survives.
- Border and background rasterize a 1.5px edge by slightly different rounding
  rules, so on a 1× display the underline can differ from the old one by a
  fraction of a pixel of antialiasing. The rectangle is identical; the paint is
  within a hair.
- Verification is visual, per ADR 0028: a post page (including a link that wraps
  across lines) and the author card, in both themes. The repo has no CSS test
  infrastructure and this ADR does not create any.
