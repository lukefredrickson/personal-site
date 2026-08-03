# 12. Theming mechanism and theme toggle

Date: 2026-07-30
Status: Accepted

Resolves wayfinder ticket
[#25](https://github.com/lukefredrickson/personal-site/issues/25), part of map
[#18](https://github.com/lukefredrickson/personal-site/issues/18). Builds on
the theming research
([#21](https://github.com/lukefredrickson/personal-site/issues/21),
`docs/research/astro-dark-mode.md`) and on ADR 0011's color decision
(`light-dark()` + `color-scheme`).

## Context

The site needs a persistent light/dark toggle (design:
`docs/design/components/core/ThemeToggle.prompt.md`, a 56×28 two-position
pill). ADR 0011 already fixed the CSS side: colors use `light-dark()`,
`:root` defaults to `color-scheme: light dark`, and `data-theme` on `<html>`
flips `color-scheme` to a single value. What remained open: the theme state
model, where the no-FOUC script lives, and how the toggle component is built.

A standing requirement surfaced during grilling: the site may later adopt
`<ClientRouter />` for animated view transitions. Its DOM swap replaces
`<html>` attributes wholesale and never re-runs already-loaded scripts, so
theming built naively would silently revert on every client-side navigation.

## Decision

### State model: two explicit states, implicit system

- **No stored value** → no `data-theme` attribute. CSS resolves
  `light-dark()` from the OS preference natively — live OS changes included,
  zero JS involved. This is why the init script does *less* than the research
  doc's recommendation, which predates ADR 0011 and had JS resolving
  `prefers-color-scheme` on every load.
- **Toggle click** → write `'light'`/`'dark'` to `localStorage` under
  `lfdev-theme` and stamp `data-theme`. Storage is written *only* on toggle;
  a stored choice permanently overrides the OS.
- No third "follow system" UI state — the two-position pill stands. Escape
  hatch: clear site data. Acceptable on a personal site.

### No-FOUC script: `is:inline`, top of the layout `<head>`

A render-blocking inline script in `BaseLayout.astro` (the single base layout —
`is:inline` scripts are not deduplicated, so they must not live in a
repeatable component). It runs pre-paint: read `lfdev-theme` in a `try/catch`
(privacy modes throw), and stamp `data-theme` only for a valid stored value.
Astro's default script handling emits deferred modules that run *after* first
paint — that deferral is the flash-of-wrong-theme, hence the opt-out.

The script defines `applyTheme()` as the **single owner of theme DOM state**
(the `<html>` attribute plus the toggle's `aria-pressed`), runs it
immediately, and registers it on `astro:after-swap`. That event fires after a
client-router swap but before paint; the listener survives navigation because
`document` persists and kept scripts are not re-executed. Today, with no
client router, the listener is one inert registered function.

### Standing principle: client-router-ready interactivity

- Visual state derives from attributes on `<html>` via CSS — swapped-in DOM
  self-heals when the attribute is re-stamped.
- JS is idempotent, uses event delegation on `document`, and hooks Astro
  lifecycle events (`astro:after-swap`, `astro:page-load`) — never
  `DOMContentLoaded`.

### ThemeToggle: plain Astro component, no framework

`ThemeToggle.astro` with scoped styles and one bundled TypeScript script. A
React island was rejected: it ships the runtime plus hydration for one
attribute flip, and "controlled component" semantics don't fit — the source
of truth is the DOM attribute and storage, not parent state.

- **Knob position is pure CSS**: `html[data-theme="dark"]` moves it right; a
  `prefers-color-scheme: dark` media query with `:not([data-theme="light"])`
  covers untoggled visitors. JS never positions the knob, so it is correct
  pre-paint, swaps included.
- **Click handling is delegated**: one `document`-level listener (bundled
  scripts run once ever under the client router; delegation shrugs off the
  swapped button). On activation: resolve effective theme (`data-theme` else
  `matchMedia`), flip, persist, `applyTheme()`.

### Semantics: `<button aria-pressed>`, not `role="switch"`

`<button aria-pressed aria-label="Dark mode">` — pressed = dark. Native
button gives focus, Enter/Space activation (flowing through the same `click`
delegation as the mouse), and uniform announcements. `role="switch"` was
rejected on Adrian Roselli's cross-screen-reader testing: inconsistent
mappings (announced as checkbox, garbled state) for no benefit on a binary
control. Component styles include an explicit `:focus-visible` ring.

### Icons: `@lucide/astro`, adopted site-wide

Lucide's first-party Astro package renders icons as build-time inline SVG —
typed components, tree-shaken, zero client JS, no drift from upstream. The
sun/moon render with `aria-hidden="true"` (the button carries the label).
This also settles the site's general icon mechanism: the ui-kit's runtime
Lucide script (`data-lucide` placeholders replaced after paint) is mockup
convenience only. Hand-pasted SVG was the runner-up — identical output, worse
ergonomics; ejecting to it remains trivial if the package ever lags Astro.

### Motion: blanket `prefers-reduced-motion` rule

The knob animates `transform: translateX(...)` (compositor-friendly), gated
behind `@media (prefers-reduced-motion: no-preference)`. Adopted as the
site-wide rule: **all decorative motion sits behind `no-preference`** —
reduced-motion users get instant state changes, and no future animation needs
a per-case debate.

## Consequences

- Visitors who never touch the toggle get OS-tracked theming with zero JS;
  only override-visitors depend on the inline script.
- The head script, `applyTheme`, and the delegation pattern make adopting
  `<ClientRouter />` later a pure addition — no theming rework.
- `@lucide/astro` becomes a dependency and the expected import path for every
  icon in the build effort.
- If Astro's CSP support is ever enabled, the inline script needs a hash
  (`security.csp.scriptDirective.hashes`) — noted so it isn't a surprise.
