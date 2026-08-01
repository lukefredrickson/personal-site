// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
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

  integrations: [sitemap()],

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
});
