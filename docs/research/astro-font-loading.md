# Webfont loading in Astro 7: Public Sans + Fira Code

Research for issue #19. Investigated 2026-07-30 against the Astro docs (MCP),
fontsource.org, and primary legal/vendor sources.

## Question

The design system serves Public Sans (400/600/700/800 + italic 400) and Fira
Code (400/500, ligatures on) from Google Fonts via a CSS `@import` in
`docs/design/tokens/fonts.css` — reference only, not to be copied. What is the
current Astro 7 idiom for loading these webfonts on a static site, and how do
we honor the constraint "never load or fake Public Sans 500"?

## TL;DR recommendation

Use the **built-in Fonts API** — it is no longer experimental. `experimental.
fonts` was stabilized and removed as a flag in Astro 6.0; in Astro 6/7 `fonts`
is a top-level config option
([v6 upgrade guide](https://docs.astro.build/en/guides/upgrade-to/v6/#experimental-flags),
[config reference](https://docs.astro.build/en/reference/configuration-reference/#fonts)).
Configure both families in `astro.config.mjs` with the `fontsource()` provider
and render `<Font cssVariable="..." />` (from `astro:assets`) in the layout
head. Astro downloads the font files **at build time** and copies them into
`_astro/fonts` in the build output — the deployed site serves fonts from
lukefredrickson.dev itself, with zero requests to Google, immutable caching,
generated `@font-face` rules, and metric-optimized fallback fonts for CLS
([caching](https://docs.astro.build/en/guides/fonts/#caching),
[fallbacks](https://docs.astro.build/en/guides/fonts/#customizing-font-fallbacks)).

Load both families as **variable fonts** (weight ranges), never reference
weight 500 of Public Sans in CSS, and set `font-synthesis-weight: none` so no
missing weight can ever be faked.

## The three options

### Option A — Astro Fonts API (recommended)

Declared in `astro.config.mjs` (`fonts: [...]` array of families; each entry
takes `provider`, `name`, `cssVariable`, plus optional `weights`, `styles`,
`subsets`, `fallbacks`, `display`, `formats`, `featureSettings`,
`variationSettings`, `optimizedFallbacks`)
([config reference](https://docs.astro.build/en/reference/configuration-reference/#fonts)).
Built-in providers include `google()`, `fontsource()`, `local()`, `npm()`,
`bunny()`, `adobe()`, `fontshare()`
([provider reference](https://docs.astro.build/en/reference/font-provider-reference/)).

What you get:

- **Self-hosting for free.** Files are fetched at build time and emitted to
  `_astro/fonts`, "so they can benefit from HTTP caching of static assets
  (usually a year)"
  ([caching](https://docs.astro.build/en/guides/fonts/#caching)). The provider
  choice (`google()` vs `fontsource()`) only changes where the *build* fetches
  from; visitors always get first-party files.
- **Generated `@font-face` + CSS variable.** The `<Font />` component outputs
  the style tags in `<head>`; you consume the font via
  `font-family: var(--font-public-sans)`
  ([applying fonts](https://docs.astro.build/en/guides/fonts/#applying-custom-fonts),
  [`<Font />` reference](https://docs.astro.build/en/reference/modules/astro-assets/#font-)).
- **Preload control.** `<Font cssVariable="..." preload />` emits preload
  links; `preload` also accepts an array of `{ weight, style, subset }`
  objects for selective preloading. "Variable weight font files will be
  preloaded if any weight within its range is requested"
  ([preloading](https://docs.astro.build/en/guides/fonts/#preloading-fonts),
  [`preload` prop](https://docs.astro.build/en/reference/modules/astro-assets/#preload)).
- **Optimized fallbacks (CLS mitigation).** Astro auto-generates
  metric-adjusted fallback fonts from the last generic family in `fallbacks`
  (default `sans-serif`), using the font-metrics technique from Chrome's
  font-fallbacks work; disable with `optimizedFallbacks: false`
  ([fallbacks](https://docs.astro.build/en/guides/fonts/#customizing-font-fallbacks)).
- **Subsetting.** `subsets` (default `["latin"]`) limits which subset files
  are downloaded/preloaded
  ([font.subsets](https://docs.astro.build/en/reference/configuration-reference/#fontsubsets)).
  The `google()` provider additionally offers `options.experimental.glyphs`
  for per-glyph subsetting
  ([google provider](https://docs.astro.build/en/reference/font-provider-reference/#google)).
- **`display` default is `swap`** — FOUT rather than FOIT, paired with the
  optimized fallbacks so the swap barely shifts layout
  ([font.display](https://docs.astro.build/en/reference/configuration-reference/#fontdisplay)).
- **Weight gating.** `weights` defaults to `[400]`; only listed weights are
  emitted, "to prevent unnecessary downloads"
  ([font.weights](https://docs.astro.build/en/reference/configuration-reference/#fontweights)).

Cost: config lives in `astro.config.mjs` rather than CSS, and the exact bytes
shipped depend on what the provider resolves — worth checking the built
`_astro/fonts` output once.

### Option B — Fontsource npm packages (`@fontsource/*`)

Install `@fontsource-variable/public-sans` and `@fontsource-variable/fira-code`
(or per-weight `@fontsource/*` packages) and import their CSS. This is the
approach Starlight still documents for its own theme customization
([Starlight custom fonts](https://starlight.astro.build/guides/customization/#custom-fonts)).
It also self-hosts and pins versions via package.json, but compared to the
Fonts API you hand-roll everything the API automates: no preload links, no
optimized fallback generation (worse CLS), no per-page control, and the
`@font-face` rules ship whatever the package's CSS includes. In Astro 6+ this
is the fallback idiom for frameworks/tools that predate the Fonts API, not the
current first-party one — Astro even ships an `npm()` provider that can read
`@fontsource/*` packages *through* the Fonts API, keeping the API's benefits
while sourcing files from node_modules
([npm provider](https://docs.astro.build/en/reference/font-provider-reference/#npm)).

### Option C — plain `<link>`/`@import` to Google Fonts (status quo of the token file)

Zero build config, and Google serves aggressively subsetted per-script slices.
Everything else is worse:

- **Performance.** Third-party connection setup (DNS + TLS to
  `fonts.googleapis.com` *and* `fonts.gstatic.com`) on the critical path; the
  `@import` form is worst since the CSS must download before the font CSS
  request even starts. No cross-site cache benefit exists anymore — browsers
  partition HTTP caches per site.
- **FOUT/CLS.** `display=swap` gives FOUT with un-tuned fallbacks; no
  metric-adjusted fallback generation.
- **Privacy/legal.** Every visitor's IP address is sent to Google. LG München
  I (judgment of 2022-01-20, case 3 O 17493/20) held that embedding Google
  Fonts this way unlawfully transmits the visitor's dynamic IP address to
  Google without consent, awarded €100 in damages, and noted Google Fonts can
  be used without any connection to Google's servers — i.e. self-hosting is
  the privacy-protective alternative
  ([judgment text, gesetze-bayern.de](https://www.gesetze-bayern.de/Content/Document/Y-300-Z-GRURRS-B-2022-N-612)).
  Google's own FAQ (https://fonts.google.com/faq#privacy) describes the
  requests as decoupled from Google accounts and cookie-free, but the IP
  transmission is inherent to any third-party fetch and is exactly what the
  court objected to. Not a compliance emergency for a personal site, but
  self-hosting makes the question moot.

The token file's comment already says it: reference only, not to be copied.

## Trade-off summary

| | Fonts API | Fontsource npm | Google `<link>`/`@import` |
|---|---|---|---|
| Serving | first-party (`_astro/fonts`, ~1yr immutable cache) | first-party | Google CDN, cache-partitioned |
| FOUT/CLS | `display: swap` + auto metric-matched fallbacks | swap, hand-rolled fallbacks | swap, hand-rolled fallbacks |
| Preload | `<Font preload>` incl. selective per-file | manual `<link rel=preload>` | not practical (hashed gstatic URLs) |
| Subsetting | `subsets` config (+ experimental glyphs on google provider) | whatever the package CSS imports | best-in-class per-script slices |
| Privacy | no third-party requests | no third-party requests | IP sent to Google (LG München I 3 O 17493/20) |
| Weight control | explicit `weights` allowlist | per-weight CSS imports | URL query only |

## Honoring "never load or fake Public Sans 500"

Facts first:

- Public Sans is a **variable font, weight axis 100–900, plus italic**;
  Fontsource ships it as `@fontsource-variable/public-sans` (static instances
  100–900 also exist) ([fontsource.org/fonts/public-sans](https://fontsource.org/fonts/public-sans)).
- Fira Code is a **variable font, weight axis 300–700, normal style only**;
  500 exists as a static instance
  ([fontsource.org/fonts/fira-code](https://fontsource.org/fonts/fira-code)).
  Astro's own docs configure exactly this: `weights: ["300 700"]`,
  `styles: ["normal"]`
  ([variable fonts guide](https://docs.astro.build/en/guides/fonts/#using-variable-fonts)).

Two ways to read the constraint:

1. **Never ship files containing weight 500.** Only possible with static
   instances: `weights: [400, 600, 700, 800]`. But Astro's `weights`/`styles`
   are combinatorial per family, so `styles: ["normal", "italic"]` would also
   fetch italic 600/700/800, which the design system doesn't use — and the
   fallback-metric benefits apply either way. Cost: 5+ font files.
2. **Never *render* weight 500, real or faked** (the design intent — "hierarchy
   uses 400/600/700/800 only"). Load the variable font (2 files total: roman +
   italic), and enforce non-use at the CSS layer:
   - The design tokens only ever set `font-weight: 400 | 600 | 700 | 800` —
     500 is unreachable unless someone writes it, same as with static files.
   - Add `font-synthesis-weight: none` (or `font-synthesis: none`) on `:root`
     so the browser can never fake a bold/medium for a weight that isn't
     loaded — this is the guard against *faked* 500 (and faked italics), and
     it matters regardless of option 1 vs 2 (with statics, a stray
     `font-weight: 500` would otherwise trigger faux-bolding of the 400 file;
     with the variable font it would render a true 500, which is equally
     off-spec but at least not distorted).

Recommendation: **option 2** (variable fonts). Fewer, cacheable files; the
constraint is a design-system rule about *usage*, enforced where usage
happens (tokens + `font-synthesis-weight`), and a lint-able string
(`font-weight: 500`) rather than a build artifact. For Fira Code the variable
range `"300 700"` covers 400 and 500 in one file.

Ligatures: Fira Code's programming ligatures live in the default-on `calt`
feature — no opt-in needed; ensure nothing sets
`font-variant-ligatures: none` / `font-feature-settings: "calt" 0` on code
blocks. Astro exposes per-family `featureSettings` if explicit control is ever
wanted ([font.featureSettings](https://docs.astro.build/en/reference/configuration-reference/#fontfeaturesettings)).

## Concrete sketch

`astro.config.mjs`
([config shape](https://docs.astro.build/en/reference/configuration-reference/#fonts),
[variable-font weights](https://docs.astro.build/en/guides/fonts/#using-variable-fonts)):

```js
import { defineConfig, fontProviders } from "astro/config";

export default defineConfig({
  fonts: [
    {
      provider: fontProviders.fontsource(),
      name: "Public Sans",
      cssVariable: "--font-public-sans",
      weights: ["100 900"],           // variable axis range (2 files: roman + italic)
      styles: ["normal", "italic"],   // italic used at 400 only, per tokens
      subsets: ["latin"],
      fallbacks: ["sans-serif"],      // Astro generates metric-matched fallback
      // display: "swap" is the default
    },
    {
      provider: fontProviders.fontsource(),
      name: "Fira Code",
      cssVariable: "--font-fira-code",
      weights: ["300 700"],           // variable axis range; covers 400 + 500
      styles: ["normal"],             // Fira Code has no italic
      subsets: ["latin"],
      fallbacks: ["monospace"],
    },
  ],
});
```

Layout head
([applying fonts](https://docs.astro.build/en/guides/fonts/#applying-custom-fonts),
[preloading](https://docs.astro.build/en/guides/fonts/#preloading-fonts)):

```astro
---
import { Font } from "astro:assets";
---
<html lang="en">
  <head>
    <!-- Preload only the roman Public Sans file (above-the-fold text). -->
    <Font
      cssVariable="--font-public-sans"
      preload={[{ style: "normal", subset: "latin" }]}
    />
    <Font cssVariable="--font-fira-code" />
  </head>
  <body><slot /></body>
</html>
```

Global CSS (tokens layer):

```css
:root {
  --font-sans: var(--font-public-sans);
  --font-mono: var(--font-fira-code);
  font-synthesis-weight: none; /* never fake a weight (e.g. 500) */
  font-synthesis-style: none;  /* never fake an italic (Fira Code has none) */
}
body { font-family: var(--font-sans); }
code, pre { font-family: var(--font-mono); } /* calt ligatures on by default */
```

Notes:

- `fontsource()` vs `google()` provider: both end up self-hosted; fontsource
  matches the docs' own Fira Code example and keeps the build's upstream a
  versioned open-source mirror. `google()` is equally valid and adds
  `experimental.glyphs` / `experimental.variableAxis` options if ever needed
  ([providers](https://docs.astro.build/en/reference/font-provider-reference/#built-in-providers)).
- If the "never ship 500" reading is preferred later, it is a two-line change:
  `weights: [400, 600, 700, 800]` (and accept the extra italic files or drop
  `"italic"` and load italic 400 as a second config entry via `local()`).
- After building, verify the emitted files in `dist/_astro/fonts` once —
  provider resolution decides the exact set.

## Sources

- Astro fonts guide: https://docs.astro.build/en/guides/fonts/
- Config reference (`fonts`): https://docs.astro.build/en/reference/configuration-reference/#fonts
- `<Font />` reference: https://docs.astro.build/en/reference/modules/astro-assets/#font-
- Font provider reference: https://docs.astro.build/en/reference/font-provider-reference/
- Astro v6 upgrade (fonts stabilized): https://docs.astro.build/en/guides/upgrade-to/v6/#experimental-flags
- Fontsource Public Sans: https://fontsource.org/fonts/public-sans
- Fontsource Fira Code: https://fontsource.org/fonts/fira-code
- LG München I, 20.01.2022, 3 O 17493/20: https://www.gesetze-bayern.de/Content/Document/Y-300-Z-GRURRS-B-2022-N-612
- Google Fonts privacy FAQ: https://fonts.google.com/faq#privacy
- Starlight custom fonts (Fontsource npm idiom): https://starlight.astro.build/guides/customization/#custom-fonts
