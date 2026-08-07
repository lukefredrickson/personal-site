// @ts-check
import { defineConfig, envField, fontProviders } from 'astro/config';
import { satteri } from '@astrojs/markdown-satteri';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import expressiveCode, { ExpressiveCodeTheme } from 'astro-expressive-code';
import { readingTimePlugin } from './src/lib/reading-time.ts';
import dawnfox from './src/styles/code-themes/dawnfox.json';
import duskfox from './src/styles/code-themes/duskfox.json';

/**
 * Vendored dawnfox/duskfox VS Code themes (ADR 0016). The theme name drives
 * Expressive Code's default `[data-theme='<name>']` selector, so naming them
 * `light`/`dark` lands them straight on ADR 0012's attribute.
 * @param {{ colors: Record<string, string> }} json
 * @param {'light' | 'dark'} name
 */
const foxTheme = ({ colors, ...theme }, name) =>
  new ExpressiveCodeTheme({
    ...theme,
    name,
    // duskfox ships `tab.activeBorderTop: "default"`; Expressive Code takes hex
    // only and throws on anything else. Dropping the stray key beats editing
    // the vendored file, which stays a verbatim copy.
    colors: Object.fromEntries(
      Object.entries(colors).filter(([, value]) => String(value).startsWith('#')),
    ),
  });

/*
  The one host-specific touchpoint of draft visibility (ADR 0021). Workers
  Builds stamps `WORKERS_CI_BRANCH` on every build it runs; the `main` build is
  production. Fail closed: drafts show only when the signal is present AND says
  preview, so a local build, or Cloudflare renaming the variable, hides them.
*/
const branch = process.env.WORKERS_CI_BRANCH;
const isPreviewBuild = Boolean(branch) && branch !== 'main';

// https://astro.build/config
export default defineConfig({
  // Canonical site URL. Enables correct absolute URLs, sitemaps, canonical tags.
  site: 'https://lukefredrickson.dev',

  // The static build physically emits `slug/index.html`, so the trailing-slash
  // form is the real URL. Cloudflare redirects the slashless form in production;
  // this makes dev 404 it instead, so a sloppy internal link breaks loudly
  // before merge rather than shipping a permanent redirect hop.
  trailingSlash: 'always',

  env: {
    schema: {
      // Typed so the post query imports a boolean and knows nothing about
      // Cloudflare. An explicitly set `SHOW_DRAFTS` beats this default — that
      // is the local override (`SHOW_DRAFTS=true npm run build`), and nothing
      // in the Cloudflare dashboard sets it.
      SHOW_DRAFTS: envField.boolean({
        context: 'server',
        access: 'public',
        default: isPreviewBuild,
      }),
    },
  },

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

  vite: {
    build: {
      // esbuild strips vendor prefixes it reads as unnecessary for the CSS
      // target, and Vite's default target sits below this site's real floor —
      // the one oklch() + light-dark() already set (colors.css). Naming that
      // floor is what carries the hand-written prefixes (no autoprefixer here)
      // through to `dist`; prose.css's `-webkit-box-decoration-break` is the
      // one relying on it today.
      cssTarget: ['chrome123', 'safari17.5', 'firefox120'],
    },
  },

  markdown: {
    // Still Astro 7's default processor (ADR 0013) — `satteri()` spelled out is
    // what lets a plugin ride along. Read time is computed here rather than
    // from raw source so the estimate sees the parsed document (ADR 0020).
    processor: satteri({ mdastPlugins: [readingTimePlugin] }),
  },

  // Expressive Code goes first: it rewrites code blocks in the Markdown
  // pipeline, and MDX inherits that config only if it is already registered.
  // MDX itself takes no options — `.mdx` inherits the Markdown config, so the
  // read-time plugin covers both formats.
  integrations: [
    // Every fenced code block in every post, `.md` and `.mdx` alike (ADR 0016).
    // Fox palettes supply the syntax colors; everything around the code — frame,
    // filename tab, copy button — is the site's own tokens.
    expressiveCode({
      themes: [foxTheme(dawnfox, 'light'), foxTheme(duskfox, 'dark')],
      // A visitor who never touches the toggle has no `data-theme` at all
      // (ADR 0012), so the media query is what themes their code blocks.
      useDarkModeMediaQuery: true,
      styleOverrides: {
        borderColor: 'var(--border-strong)',
        borderWidth: 'var(--border-w)',
        borderRadius: 'var(--radius-card)',
        codeBackground: 'var(--code-bg)',
        codeFontFamily: 'var(--font-mono)',
        codeFontSize: 'var(--text-code)',
        codeLineHeight: 'var(--leading-code)',
        codePaddingBlock: 'var(--space-4)',
        codePaddingInline: 'var(--space-5)',
        uiFontFamily: 'var(--font-mono)',
        uiFontSize: 'var(--text-caption)',
        uiPaddingBlock: 'var(--space-2)',
        uiPaddingInline: 'var(--space-5)',
        frames: {
          // The design's header is a flat strip with a hairline under it, not a
          // raised editor tab: every tab-shaped affordance resolves away.
          editorTabBarBackground: 'transparent',
          editorTabBarBorderBottomColor: 'var(--code-border)',
          editorActiveTabBackground: 'transparent',
          editorActiveTabForeground: 'var(--text-muted)',
          editorActiveTabBorderColor: 'transparent',
          editorActiveTabIndicatorHeight: '0',
          editorActiveTabIndicatorTopColor: 'transparent',
          editorActiveTabIndicatorBottomColor: 'transparent',
          editorTabBorderRadius: '0',
          // Code cards sit flat in the prose; the lift belongs to real cards.
          frameBoxShadowCssValue: 'none',
          inlineButtonForeground: 'var(--text-muted)',
          inlineButtonBorder: 'var(--code-border)',
        },
      },
    }),
    // Posts graduate to `.mdx` when they need components in the body — stat
    // rows, framed photos, video embeds (ADR 0013). Stays behind
    // `expressiveCode()`, which only reaches MDX code blocks when registered
    // ahead of it.
    mdx(),
    sitemap(),
  ],
});
