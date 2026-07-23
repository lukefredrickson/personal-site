Lucide icon wrapper — the brand's icon system (https://lucide.dev/icons/), rendered at stroke-width 1.5 to match the 1.5px card borders. Load the Lucide UMD script first: `<script src="https://unpkg.com/lucide@latest"></script>`.

```jsx
<Icon name="bike" />
<Icon name="arrow-right" size={18} />
<Icon name="moon" strokeWidth={1.5} color="var(--ink)" />
```

Canonical picks: `moon` / `sun` (theme toggle), `play` (video), `arrow-right` / `arrow-left` (nav), `arrow-up-right` (external link), `code` (code topic), `bike` (bikes topic), `calendar` / `clock` (post meta), `link` (profile links), `download` (résumé). Lucide ships no brand icons (no github/linkedin) — profile links stay text buttons.

Default 16px, `currentColor`. Unicode arrows/middots remain fine inside running text — that's typography, not iconography.
