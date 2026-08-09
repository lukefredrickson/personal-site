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
 * Expressive Code's `[data-theme='<name>']` selector, so `light`/`dark`
 * lands on ADR 0012's attribute.
 * @param {{ colors: Record<string, string> }} json
 * @param {'light' | 'dark'} name
 */
const foxTheme = ({ colors, ...theme }, name) =>
  new ExpressiveCodeTheme({
    ...theme,
    name,
    // duskfox ships `tab.activeBorderTop: "default"`; Expressive Code
    // accepts hex only. Dropping the key keeps the vendored file verbatim.
    colors: Object.fromEntries(
      Object.entries(colors).filter(([, value]) => String(value).startsWith('#')),
    ),
  });

/* The one host-specific touchpoint of draft visibility (ADR 0021). Fails
   closed: drafts show only when `WORKERS_CI_BRANCH` is present and not `main`. */
const branch = process.env.WORKERS_CI_BRANCH;
const isPreviewBuild = Boolean(branch) && branch !== 'main';

// https://astro.build/config
export default defineConfig({
  // Canonical site URL. Enables correct absolute URLs, sitemaps, canonical tags.
  site: 'https://lukefredrickson.dev',

  // The static build emits `slug/index.html`, so the trailing-slash form is
  // the real URL. Dev 404s the slashless form; production redirects it.
  trailingSlash: 'always',

  env: {
    schema: {
      // Typed so the post query imports a boolean and knows nothing about
      // Cloudflare. An explicitly set `SHOW_DRAFTS` beats this default.
      SHOW_DRAFTS: envField.boolean({
        context: 'server',
        access: 'public',
        default: isPreviewBuild,
      }),
    },
  },

  // Fontsource fonts are fetched at build time and served first-party as
  // variable fonts. Metric-matched fallbacks keep the swap from shifting layout.
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
    // One responsive pipeline for every image (ADR 0015). Global, so plain
    // `![]()` images in post bodies get it too.
    layout: 'constrained',
    // The layout only resizes with the global styles that back it; off,
    // markdown images render at intrinsic width and overflow.
    responsiveStyles: true,
  },

  markdown: {
    // Astro 7's default processor, spelled out so a plugin can attach
    // (ADR 0013). Read time computes on the parsed document (ADR 0020).
    processor: satteri({ mdastPlugins: [readingTimePlugin] }),
  },

  // Minification drops the `-webkit-` prefix in `prose.css` unless the target
  // names the browser floor. `colors.css` states that floor (ADR 0036).
  vite: {
    build: { cssTarget: ['chrome123', 'safari17.5', 'firefox120'] },
  },

  // Expressive Code goes first: MDX inherits its code-block rewrite only
  // when it is already registered.
  integrations: [
    // Every fenced code block, `.md` and `.mdx` alike (ADR 0016). The fox
    // palettes color the syntax; the site tokens style the frame.
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
          // The header is a flat strip with a hairline, not a raised editor
          // tab; every tab-shaped affordance resolves away.
          editorTabBarBackground: 'transparent',
          editorTabBarBorderBottomColor: 'var(--code-border)',
          editorActiveTabBackground: 'transparent',
          editorActiveTabForeground: 'var(--text-muted)',
          editorActiveTabBorderColor: 'transparent',
          editorActiveTabIndicatorHeight: '0',
          editorActiveTabIndicatorTopColor: 'transparent',
          editorActiveTabIndicatorBottomColor: 'transparent',
          editorTabBorderRadius: '0',
          // Code cards sit flat in the prose, without the card shadow.
          frameBoxShadowCssValue: 'none',
          inlineButtonForeground: 'var(--text-muted)',
          inlineButtonBorder: 'var(--code-border)',
        },
      },
    }),
    // Posts graduate to `.mdx` when the body needs components (ADR 0013).
    // `.mdx` inherits the Markdown config, so the read-time plugin covers both.
    mdx(),
    sitemap(),
  ],
});
