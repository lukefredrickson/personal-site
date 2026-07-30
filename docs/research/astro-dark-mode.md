# Research: FOUC-free dark mode theming in Astro

Resolves [#21](https://github.com/lukefredrickson/personal-site/issues/21).
Part of the wayfinder map
[#18](https://github.com/lukefredrickson/personal-site/issues/18).

Primary source: the official Astro docs (queried via the Astro docs MCP,
2026-07-30, Astro 7 era). Each claim cites the owning doc page.

## Question

Best-practice pattern for a persistent light/dark toggle on a static Astro
site, matching the design-system reference (`docs/design/ui-kit/index.html`:
`data-theme="dark"` on `<html>`, toggle persists via `localStorage` under key
`lfdev-theme`). Sub-questions: inline head script and FOUC, `is:inline`
semantics, `localStorage` vs `prefers-color-scheme` precedence, and interplay
with view transitions / the client router.

## Findings

### 1. Why an inline head script is the FOUC fix

FOUC (flash of unstyled/wrong-theme content) happens when the page paints
before JavaScript applies the stored theme. The fix is a **synchronous,
render-blocking script in `<head>`** that sets the theme attribute on
`document.documentElement` before first paint. Astro's own tutorial and the
view-transitions guide both use exactly this shape: a small `is:inline` script
that reads `localStorage`, falls back to `matchMedia('(prefers-color-scheme:
dark)')`, and stamps the root element
([tutorial: theme toggle](https://docs.astro.build/en/tutorial/6-islands/2/#add-client-side-interactivity),
[view transitions guide](https://docs.astro.build/en/guides/view-transitions/#script-behavior-with-view-transitions)).

Astro's *default* script processing works against this: unattributed
`<script>` tags become bundled `type="module"` scripts — modules are deferred,
so they run after first paint and would cause exactly the flash we're avoiding
([Scripts guide: script processing](https://docs.astro.build/en/guides/client-side-scripts/#script-processing)).
Hence the theme-init script must opt out with `is:inline`.

### 2. `is:inline` semantics (directives reference)

From the [template directives reference](https://docs.astro.build/en/reference/directives-reference/#script--style-directives):

- Rendered into the final HTML **exactly where authored** — put it early in
  `<head>` in the base layout, before any stylesheets is fine (it has no DOM
  or CSSOM dependencies).
- **Not processed**: no TypeScript, no import resolution, no bundling.
- **Not deduplicated**: it renders once per component instance — so the init
  script belongs in the (single) base layout, not in a reusable component
  that might appear more than once.
- `is:inline` is **implied** whenever a `<script>` carries any attribute
  other than `src` (e.g. `data-astro-rerun`). Since Astro 5, conditionally
  rendered scripts are *not* implicitly inlined anymore — spell it out
  ([v5 upgrade guide](https://docs.astro.build/en/guides/upgrade-to/v5/#script-tags-are-rendered-directly-as-declared)).

### 3. Precedence: `localStorage` first, `prefers-color-scheme` as fallback

Astro's tutorial pattern
([source](https://docs.astro.build/en/tutorial/6-islands/2/#add-client-side-interactivity)):

1. If `localStorage` holds a valid stored value (`'dark'`/`'light'`), use it —
   an explicit user choice beats the OS preference.
2. Otherwise fall back to `window.matchMedia('(prefers-color-scheme: dark)')`.
3. Otherwise light.

One deviation worth making from the tutorial: it writes the *resolved* theme
back to `localStorage` on first visit. That freezes the OS preference at
first-visit time — if the user later flips their OS theme, the site won't
follow. Better idiom: **only write to `localStorage` when the user actually
clicks the toggle**; absent a stored value, keep resolving from
`prefers-color-scheme` each load (optionally also listen for `matchMedia`
`change` events). The ui-kit reference toggle already follows the
write-on-toggle-only model (`docs/design/ui-kit/index.html`, `flipTheme()`),
except it defaults to `'light'` instead of consulting `prefers-color-scheme`
— the Astro-idiomatic version adds the media-query fallback.

Also wrap `localStorage` access in `try/catch` (or `localStorage?.`): it
throws in some privacy modes; the ui-kit script already does this.

### 4. View transitions / `<ClientRouter />` interplay

Directly documented in the
[view transitions guide](https://docs.astro.build/en/guides/view-transitions/#script-behavior-with-view-transitions):

- With `<ClientRouter />`, navigation swaps the DOM instead of reloading, and
  the incoming document's `<html>` attributes replace the current ones — so a
  theme set only on initial load would revert, flashing the default theme
  after each navigation.
- The documented fix is to run the theme-apply function on
  **`astro:after-swap`**, which fires "immediately after the new page has
  replaced the old page and before the DOM elements are painted" — i.e. it is
  the client-router equivalent of the render-blocking head script. The docs'
  example is a dark-mode toggle verbatim:

  ```html
  <script is:inline>
    function applyTheme() { /* read storage, stamp documentElement */ }
    document.addEventListener("astro:after-swap", applyTheme);
    applyTheme();
  </script>
  ```

- Bundled (default) scripts execute **once ever** under the client router;
  inline scripts may re-execute when navigating back to a page that has them.
  The `astro:after-swap` listener pattern above tolerates both. If an inline
  script must rerun on every transition, `data-astro-rerun` forces it
  (Astro ≥4.5); for "run on every page load" logic, listen for
  `astro:page-load` instead of `DOMContentLoaded`.

The site does not use `<ClientRouter />` today. The `astro:after-swap`
listener on a page without the router is inert (the event never fires), costs
nothing, and future-proofs the script — include it now.

### 5. CSP note (forward-looking)

If the site ever enables Astro's CSP support (`security.csp`, Astro ≥6),
inline scripts need hashes; Astro generates hashes for scripts it controls,
and extra hashes can be added via `security.csp.scriptDirective.hashes`
([config reference](https://docs.astro.build/en/reference/configuration-reference/#securitycspscriptdirective)).
Not a concern now; noted so the inline-script choice isn't a surprise later.

## Recommended pattern

In the base layout's `<head>` (single source of truth, renders on every page):

```html
<script is:inline>
  (function () {
    const KEY = "lfdev-theme";
    function resolveTheme() {
      try {
        const stored = localStorage.getItem(KEY);
        if (stored === "dark" || stored === "light") return stored;
      } catch {}
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
    function applyTheme() {
      document.documentElement.setAttribute("data-theme", resolveTheme());
    }
    applyTheme();
    document.addEventListener("astro:after-swap", applyTheme);
  })();
</script>
```

The toggle component (anywhere in the page) flips `data-theme` and writes the
choice to `localStorage` under the same key — that write is the only thing
that promotes the theme from "OS preference" to "explicit user choice".

### Alternatives considered

- **Bundled default `<script>` for init** — runs deferred as a module; paints
  the wrong theme first. Rejected (this is the FOUC).
- **CSS-only `prefers-color-scheme` media queries** — zero JS and zero FOUC,
  but cannot offer a persistent user toggle that overrides the OS. Rejected
  by the design requirement.
- **Writing resolved theme to storage on first visit** (tutorial verbatim) —
  simpler, but pins the OS preference permanently. Rejected in favor of
  write-on-toggle-only.
- **`data-astro-rerun` on the init script** — works, but re-runs the whole
  script (re-registering listeners) per transition; the `astro:after-swap`
  listener is the docs' canonical shape for theming specifically.
