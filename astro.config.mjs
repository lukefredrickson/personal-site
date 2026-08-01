// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  // Canonical site URL. Enables correct absolute URLs, sitemaps, canonical tags.
  site: 'https://lukefredrickson.dev',

  // The static build physically emits `slug/index.html`, so the trailing-slash
  // form is the real URL. Cloudflare redirects the slashless form in production;
  // this makes dev 404 it instead, so a sloppy internal link breaks loudly
  // before merge rather than shipping a permanent redirect hop.
  trailingSlash: 'always',

  // Posts start as `.md` and graduate to `.mdx` when they need components
  // (ADR 0013). No options: `.mdx` inherits the Markdown config, which is the
  // default Sätteri processor with no plugins.
  integrations: [mdx(), sitemap()],

  // Fonts are fetched from Fontsource at build time and emitted to
  // `_astro/fonts`, so visitors get first-party, year-cached files and Google
  // never sees their IP. Both families load as variable fonts: one file covers
  // the whole weight range, and Astro generates metric-matched fallbacks from
  // the trailing generic family, which is what keeps the swap from shifting
  // layout. The other half of "never fake Public Sans 500" is
  // `font-synthesis-*: none` in base.css.
  fonts: [
    {
      provider: fontProviders.fontsource(),
      name: 'Public Sans',
      cssVariable: '--font-public-sans',
      weights: ['100 900'],
      styles: ['normal', 'italic'],
      subsets: ['latin'],
      fallbacks: ['sans-serif'],
    },
    {
      provider: fontProviders.fontsource(),
      name: 'Fira Code',
      cssVariable: '--font-fira-code',
      // Covers 400 and the 500 used for active states. No italic exists.
      weights: ['300 700'],
      styles: ['normal'],
      subsets: ['latin'],
      fallbacks: ['monospace'],
    },
  ],

  image: {
    // One responsive pipeline for every optimized image (ADR 0015): multi-width
    // srcset, lazy loading, reserved dimensions. Set globally so plain `![]()`
    // images in post bodies get it too, not just the `<Image>` call sites.
    layout: 'constrained',
    // The layout only resizes with the global styles that back it; off (the
    // default), markdown images render at intrinsic width and overflow.
    responsiveStyles: true,
  },
});
