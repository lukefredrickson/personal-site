# 11. Token activation: how reference tokens graduate to live styles

Date: 2026-07-30
Status: Accepted (amended by ADR 0030)
Amends: ADR 0007 (activation route now decided; the quarantine boundary stands)

## Amendment (ADR 0030)

§3's px rule has one carve-out: decoration that must visually register against
a specific piece of text — the home page's role dot against its title — sizes
in rem, at the component level. Everything else in §3 stands.

## Context

ADR 0007 quarantined the design-system tokens under `docs/design/` and left the
activation route as a sketch: "copy the ones we want into `src/styles/` and
`@import` them behind `global.css`." This ADR fixes that route precisely — what
graduates, what drops, in what shape, and with which deliberate divergences —
so the build tickets can execute it without re-opening design questions.
Decided in [wayfinder ticket #22](https://github.com/lukefredrickson/personal-site/issues/22),
grilled 2026-07-30.

A framing decision made here reshapes ADR 0005/0007's sync story: the
claude.ai/design project was scaffolding — a way to design the site before a
site existed. From activation onward **`src/styles/` is canonical**; there is
no ongoing sync, no upstream. `docs/design/` remains useful as build-time
reference and is deleted once the build effort completes.

## Decision

### Wholesale, one move

The full token set graduates in a single PR. The set is small (~350 lines) and
internally chained (semantic tokens reach through palette to primitives), so
cherry-picking is false economy and "which tokens are live?" should never be a
question. Inert custom properties that ship before anything consumes them cost
bytes only.

### Per-file fate

- **`fonts.css` — does not graduate.** Font loading stops being CSS: Astro's
  built-in Fonts API (fontsource provider, variable fonts, metric-matched
  fallbacks — see `docs/research/astro-font-loading.md`) owns it via
  `astro.config.mjs` plus `<Font>` in the layout head, as its own build-backlog
  item. The `--font-display`/`--font-body`/`--font-mono` tokens in
  typography.css re-point at the Fonts API's generated variables
  (e.g. `var(--font-public-sans)`).
- **`colors.css`, `typography.css`, `spacing.css` — graduate**, translated per
  the rules below.
- **`base.css` — graduates slimmed** to what the reset doesn't already do:
  `::selection`, and `body { background; color; font-family: var(--font-body) }`.
  `margin: 0` and `-webkit-font-smoothing` drop (the reset's job — this is the
  reconciliation ADRs 0006/0007 deferred to activation). Two additions:
  `font-synthesis-weight: none` and `font-synthesis-style: none` on `:root`,
  enforcing the design rule "never fake Public Sans 500" (or any missing
  weight/style) at the CSS layer. base.css stays a separate file because it is
  the *application* layer — the only place tokens become paint — and the
  designated home for future page-level defaults; `global.css` stays a pure
  import manifest (ADR 0006).

### Translation rules

1. **Legacy pruning.** Everything alias-flavored drops: the deprecated color
   block (`--yellow`, `--blue`, `--red`, `--green`, `--tint-blue`,
   `--tint-yellow`), `--radius-md`, `--radius-tile`, `--p-foam-*`, and
   `--topic-life-*`. Live components are written fresh against canonical names
   only. `--topic-life-*` returns only if the content model (ticket #24) ever
   grows a "life" topic — as a deliberate re-add, not an alias.
2. **Type scale replaces raw sizes.** A named size scale is the primitive
   layer, canonical over the reference's hand-tuned px values — the design
   snaps to the scale, not the scale to the design:

   ```css
   --font-size-xs: 0.75rem;      /* 12px */
   --font-size-sm: 0.875rem;     /* 14px */
   --font-size-md: 1rem;         /* 16px */
   --font-size-lg: 1.125rem;     /* 18px */
   --font-size-xl: 1.3125rem;    /* 21px */
   --font-size-2xl: 1.5rem;      /* 24px */
   --font-size-3xl: 2.625rem;    /* 42px */
   --font-size-4xl: 4rem;        /* 64px */
   ```

   The job tokens survive as aliases into the scale and remain what components
   read (primitives → semantic, mirroring colors.css §0→§2):
   chip/caption/meta → `xs`; ui/code/small → `sm`; item-title/article → `md`;
   card-title → `lg`; section → `2xl`; page-title and hero merge on `3xl`
   (they never co-occur — hero is Home-only, page-title is post/index-only).
   `xl` and `4xl` ship unused as headroom. Line-height, weight, and tracking
   pairings stay with the job tokens, unchanged.
3. **Units.** rem for type sizes, `--page-max` (`42.5rem`), and future media
   queries (breakpoints in rem, e.g. 640px → 40rem); px for spacing, radii,
   borders, shadows, and page padding. Vertical rhythm inside article prose is
   authored in rem/em at the component level, not forced through the px space
   scale. Rationale: Comeau's "should this scale with the user's default
   font-size preference?" test — type, line length, and layout breaks should;
   decoration and horizontal padding shouldn't.
4. **Light/dark.** The `light-dark()` + `color-scheme` mechanism graduates
   verbatim with one change: the `:root` default becomes
   `color-scheme: light dark`, so OS-level dark preference is honored before
   and without JS. The `[data-theme]` overrides stand; the toggle script
   (ticket #25) wins whenever it runs. Browser floor accepted as the reference
   set it: `oklch()` + `light-dark()` = Chrome 123+ / Safari 17.5+ / FF 120+.

### Shape on disk

Flat files, same names as the reference, no `tokens/` subfolder, no second
aggregator — `global.css` is the aggregator (ADR 0006):

```css
@import "./reset.css";
@import "./colors.css";
@import "./typography.css";
@import "./spacing.css";
@import "./base.css";
```

Order encodes the one real dependency: reset first, base (the consumer) last.

### No `@layer`, reaffirmed

Re-asked at the 2→6 stylesheet jump; still no. Token files are inert `:root`
declarations, base.css sits at specificity (0,0,1), Astro-scoped component
styles already outrank imported globals, and Shiki inlines its colors rather
than shipping competing CSS. ADR 0006's re-triggers stand unchanged: a utility
framework, third-party CSS needing arbitration, or a hand-rolled utility
system.

## Alternatives considered

- **Incremental graduation** (tokens copied as components need them) —
  rejected: every build PR becomes part-infrastructure, and the live-token set
  becomes a moving target.
- **Keeping the Google Fonts `@import`** — rejected on performance (third-party
  critical path), CLS (no metric-matched fallbacks), and privacy (visitor IPs
  to Google; LG München I 3 O 17493/20). Details in the research doc.
- **Folding base.css into `global.css`** — rejected: the entry file stays a
  scannable manifest; the definitions/application split earns the 8 lines.
- **Preserving the reference's exact type sizes** (12 hand-tuned values,
  rem-converted) — rejected in favor of the named scale: fewer, systematic
  steps beat 0.5px distinctions that weight already carries.
- **Ongoing sync with the design project** (docs/design as living upstream) —
  rejected: the project was a bootstrap, not a source of truth; maintaining a
  mirror of retired scaffolding is pure carrying cost.
- **`@layer` now** — rejected again as unverifiable ceremony; see above.

## Consequences

- The activation PR can be executed mechanically from this ADR: copy, prune,
  re-scale, re-unit, flip the `color-scheme` default, slim base.css, wire five
  imports.
- The site is themed from first build: page background, text color, and
  selection respond to OS dark preference with zero JS.
- Font loading blocks on the Fonts API build item; until it lands,
  `--font-*` tokens resolve to system fallbacks. Backlog ordering (ticket #28)
  should place the Fonts API item adjacent to activation.
- The type system diverges from the locked July design: titles grow
  (34/38 → 42), card titles grow (16.5 → 18), item titles equalize with body.
  The UI kit's px values are henceforth *indicative*, not normative.
- `docs/design/` is build-time reference with a scheduled demolition: delete
  it (and ADR 0005/0007's mirror rationale with it, via a closing ADR) once
  the four screens ship.
