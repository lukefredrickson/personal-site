# 31. Cross-tab theme sync via the `storage` event

Date: 2026-08-07
Status: Accepted

Resolves [#136](https://github.com/lukefredrickson/personal-site/issues/136).
Extends ADR 0012's theming mechanism; relates to
[#135](https://github.com/lukefredrickson/personal-site/issues/135), which
settled that the favicon does *not* follow the toggle.

## Context

ADR 0012 made a toggle click write `lfdev-theme` to `localStorage` and then
call `applyTheme()` — in the clicked tab only. Storage is shared across every
same-origin tab, but nothing told the others it had changed, so a second open
tab kept rendering the old theme (and the old `theme-color` metas, and a stale
`aria-pressed`) until it was reloaded or navigated. Two tabs of the same site
disagreeing about the theme reads as a bug, not a per-tab setting.

## Decision

**One `storage` listener in `BaseLayout.astro`'s inline boot script**, beside
`applyTheme()`:

```js
window.addEventListener('storage', function (event) {
  if (event.key === 'lfdev-theme' || event.key === null) applyTheme();
});
```

`storage` fires only in the *other* same-origin tabs, never the one that wrote
— so the clicked tab is already handled by its own click handler and there is
no echo to suppress. `applyTheme()` re-reads storage itself and normalizes any
absent or invalid value to system mode, so the handler needs no payload
parsing: a `null` key (`localStorage.clear()`) reverts to the OS for free.

### Why the boot script, not `ThemeToggle.astro`

The boot script owns *applying* theme; the toggle's module only writes storage
and delegates. This listener is pure application logic, so it belongs with the
owner — and it then works on any future page that renders no toggle. It also
avoids a third copy of the `'lfdev-theme'` literal.

### Rejected

- **`BroadcastChannel`** — a second messaging mechanism for a signal
  `localStorage` already broadcasts, plus its own listener and message
  protocol.
- **Polling storage on an interval** — a timer on every page for an event the
  platform already delivers.
- **A `matchMedia('(prefers-color-scheme: …)')` listener.** Tempting to add
  alongside, but out of scope by ADR 0012's state model: a stored choice is a
  permanent override, and the toggle has no "system" position to fall back to,
  so an OS flip mid-session has nothing to change. Untoggled visitors already
  track the OS through CSS `light-dark()`, with no JS involved.

## Consequences

- All open tabs converge on `<html data-theme>`, the `theme-color` metas, and
  the toggle's `aria-pressed` the moment any one of them toggles — and revert
  together when site data is cleared.
- The inline `<script>` grows by four lines, which is head-blocking weight on
  every page; the listener registration itself is negligible next to the
  storage read already there.
- Per ADR 0028 there is no browser test runner, so this is verified by hand:
  two tabs, toggle in one, watch the other. Regressions would be caught the
  same way.

