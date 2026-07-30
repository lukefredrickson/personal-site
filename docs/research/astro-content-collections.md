# Research: content collections and markdown rendering for the blog

Resolves the fact-gathering half of
[#20](https://github.com/lukefredrickson/personal-site/issues/20) (part of the
[#18](https://github.com/lukefredrickson/personal-site/issues/18) map). This
document surfaces what Astro 7 offers against the blog reference designs
(`docs/design/ui-kit/PostTech.jsx`, `PostRide.jsx`, `BlogIndex.jsx`). It does
**not** lock the content model — that is a later decision ticket.

All claims are sourced from the official Astro docs (via the Astro docs MCP);
each section cites its source URL.

## What the designs demand of the pipeline

- **Tech post**: styled code block with a filename header, framed hero figure
  with caption, blockquote, tag pills, date + read time, author card, prev/next.
- **Ride post**: stat chips row (distance/climbing/time), captioned photos,
  video embed card, photo pair grid, prev/next.
- **Blog index**: year-grouped list, topic filter pills with counts
  (code/bikes/life), excerpts on recent posts, read time.

So the pipeline must support: (a) custom components *inside* prose,
(b) structured per-post metadata (stats, topic, tags, video), (c) themed syntax
highlighting, (d) sorted/filtered collection queries.

## 1. Content collections: loaders + zod schemas

Source: <https://docs.astro.build/en/guides/content-collections/>

- Collections are defined in `src/content.config.ts` with `defineCollection()`,
  each taking a **`loader`** (required) and a **`schema`** (optional, strongly
  recommended). A single `collections` object is exported.
- **`glob()` loader** (`astro/loaders`) is the fit for local posts: it reads
  Markdown/MDX/Markdoc/JSON/YAML/TOML from any directory
  (`glob({ pattern: "**/*.{md,mdx}", base: "./src/content/blog" })`). Content no
  longer has to live in a magic folder; entry `id`s are slugified from
  filenames, overridable per-file with a `slug` frontmatter property or
  globally with `generateId()`.
- **Schemas are Zod** (`import { z } from "astro/zod"`, Zod 4). They validate
  every entry at build time with helpful errors, and generate TypeScript types
  so `getCollection()` results are fully typed. Useful pieces for this blog:
  - `z.coerce.date()` for `pubDate` (year grouping falls out of a real Date).
  - `z.enum(["code", "bikes", "life"])` for the topic filter — the pill set in
    `BlogIndex.jsx` becomes a compile-time-checked vocabulary.
  - Optional nested objects for ride stats
    (`stats: z.object({ distanceMi: z.number(), climbingFt: z.number(), … }).optional()`)
    — chips render from frontmatter, not prose.
  - The schema can be a function receiving `{ image }` to validate that a
    frontmatter `cover` resolves to a real local image and gets optimized
    (<https://docs.astro.build/en/guides/images/#images-in-content-collections>).
- **`reference()`** lets one entry point at another collection's entry (e.g.
  `relatedPosts: z.array(reference("blog"))`) — an option for *manual* prev/next
  or related posts, though computed prev/next (section 5) needs no schema
  support.
- Other loaders exist (`file()` for one JSON/YAML file of many entries; custom
  loaders for remote sources; live collections rendered at request time) but a
  static blog on Cloudflare Workers static assets wants build-time `glob()`.

## 2. Markdown vs MDX (vs Markdoc)

Sources: <https://docs.astro.build/en/guides/markdown-content/>,
<https://docs.astro.build/en/guides/integrations-guide/mdx/>,
<https://docs.astro.build/en/guides/integrations-guide/markdoc/>

- **Plain Markdown (`.md`)** is built in, zero extra dependencies. GitHub
  Flavored Markdown + SmartyPants are applied automatically. But component use
  inside the prose body is not possible — custom visuals would have to come
  from raw HTML in Markdown or from remark/rehype plugins rewriting elements.
- **MDX (`.mdx`)** via the official `@astrojs/mdx` integration (v7.x,
  `npx astro add mdx`) allows importing and using Astro components *and*
  framework components inside the content body — exactly what stat chips,
  framed figures, and video cards need (see section 4). MDX also supports JSX
  expressions and exports. It extends the project's Markdown config by default
  (`extendMarkdownConfig: true`), so Shiki settings apply to both `.md` and
  `.mdx`. A collection can mix both: `pattern: "**/*.{md,mdx}"` — plain posts
  stay `.md`, component-heavy posts go `.mdx`.
- **Markdoc (`.mdoc`)** via `@astrojs/markdoc` is the third option: standard
  Markdown plus `{% tag %}` syntax, with components registered centrally in
  `markdoc.config.mjs` (no per-file imports) and the ability to remap built-in
  nodes (blockquote, heading, image) to Astro components. Stricter
  content/code separation, but a separate config surface and less common
  authoring syntax.
- **Processor note (new in Astro 6.4+):** the default Markdown/MDX processor is
  now **Sätteri** (`satteri()` from `@astrojs/markdown-satteri`), Astro's
  native pipeline with its own plugin model (`mdastPlugins`/`hastPlugins`).
  The classic **remark/rehype** pipeline is still available as `unified()` from
  `@astrojs/markdown-remark` (installed separately) via `markdown.processor`.
  The old `markdown.remarkPlugins`/`rehypePlugins` config keys are deprecated.
  Relevant because ecosystem recipes (e.g. reading time) are written for
  remark. Source:
  <https://docs.astro.build/en/reference/configuration-reference/#markdownprocessor>

Trade-off summary: MDX buys per-post component freedom at the cost of an extra
integration, per-file imports, and content that is no longer portable plain
Markdown. Markdoc buys central component registration and stricter authoring at
the cost of a second config file and unfamiliar tag syntax. Plain Markdown is
simplest but cannot express the ride-post designs on its own.

## 3. Shiki syntax highlighting

Source: <https://docs.astro.build/en/guides/syntax-highlighting/> and
<https://docs.astro.build/en/reference/configuration-reference/#markdown-options>

- Shiki is the default highlighter for all fenced code blocks in `.md`/`.mdx`
  (default theme `github-dark`, config default
  `{ type: 'shiki', excludeLangs: ['math'] }`). Output is inline `style`s — no
  stylesheet or client JS shipped. Astro 6 upgraded to **Shiki 4.0**.
- Configured under `markdown.shikiConfig` in `astro.config.mjs`: single
  `theme`, **dual `themes: { light, dark }`** (each token gets CSS variables;
  you add a small CSS rule targeting `.astro-code` — Astro's class name,
  replacing Shiki's `.shiki` — to flip via media query or class, which matches
  the site's existing light/dark toggle), custom theme JSON files, the
  `css-variables` theme (custom properties prefixed `--astro-code-`, an option
  for driving colors from the design tokens like `--code-selector` /
  `--code-property` in the UI kit), `defaultColor: false`, `wrap`, `langs`,
  `langAlias`, and `transformers` (Shiki transformers; note the `postprocess`
  hook does not run for `.md`/`.mdx` blocks).
- **The code-block header (filename) is not a Shiki feature.** Options:
  1. A custom `CodeBlock.astro` wrapper (header div + `<slot/>` or the built-in
     `<Code />` component, which takes `code`, `lang`, `theme`, `meta`,
     `transformers` props but does *not* inherit `shikiConfig`), used
     explicitly in MDX.
  2. A Shiki transformer / processor plugin that reads the fence meta string
     (e.g. ```` ```css title="card.css" ````) and wraps or annotates the
     rendered block — keeps plain fence syntax in content.
  3. Community integrations such as **Expressive Code**, which ship
     frames/titles/marking out of the box (mentioned in the Astro docs as the
     route for "more text marking and annotation options").

## 4. Custom components inside post content

Source: <https://docs.astro.build/en/guides/integrations-guide/mdx/#using-components-in-mdx>

- In MDX, components are imported at the top of the `.mdx` file and used as
  JSX: `import StatChip from "…"; <StatChip value="102" unit="mi" … />`.
  Astro components stay zero-JS; framework components need a `client:*`
  directive only if interactive.
- **HTML-element mapping:** when rendering a collection entry, the `<Content />`
  component (from `await render(entry)`) accepts a `components` prop mapping
  HTML elements to custom components, e.g.
  `<Content components={{ blockquote: Blockquote, img: FramedFigure, pre: CodeBlock }} />`.
  This styles *plain Markdown syntax* (blockquotes, images, code fences) with
  the design-system components without authors writing JSX — a middle path that
  keeps most post bodies plain Markdown. Components need a `<slot/>` for
  children. An MDX file can also export its own `components` map.
- In Markdoc the same is achieved via node/tag config in `markdoc.config.mjs`
  (e.g. `nodes.image.render: component('./src/components/MarkdocImage.astro')`),
  with attributes arriving as props.
- Design mapping: `FramedFigure`, `StatChip`, `VideoCard` are natural MDX
  components (or Markdoc tags); alternatively stat chips and hero figure can be
  driven purely from frontmatter by the post layout, leaving only mid-prose
  figures/videos needing in-body components.

## 5. Querying: index, year groups, topic filters, prev/next

Sources: <https://docs.astro.build/en/guides/content-collections/#querying-build-time-collections>,
<https://docs.astro.build/en/reference/modules/astro-content/>

- `getCollection('blog', filterFn?)` returns typed entries; the filter callback
  sees `{ id, data }`. Documented patterns: drafts
  (`data.draft !== true`, optionally only in `import.meta.env.PROD`) and
  subdirectory filtering by `id.startsWith(...)`.
- **Sorting/grouping is plain JS** — there is no query DSL. Index page:
  `posts.sort((a, b) => b.data.pubDate - a.data.pubDate)`, then group by
  `pubDate.getFullYear()` (e.g. `Object.groupBy` or a reduce). Topic filter
  pills with counts are a simple pass over `data.topic`. Note: the design's
  client-side pill toggling either becomes static per-topic pages
  (`/blog/topic/[topic]`), or an island, or light inline JS — a decision for
  the build ticket, not a pipeline constraint.
- **Routes:** posts are *not* auto-routed. A dynamic route
  (`src/pages/blog/[...id].astro`) exports `getStaticPaths()`, calls
  `getCollection()`, and maps entries to `{ params: { id: post.id }, props: { post } }`.
  Rendering is `const { Content, headings, remarkPluginFrontmatter } = await render(post)`.
- **Prev/next:** the idiomatic static pattern is to compute it inside
  `getStaticPaths()` — sort once, then pass neighbors as props:
  `props: { post, prev: sorted[i + 1], next: sorted[i - 1] }`. Zero extra
  queries at page render; `reference()` remains the manual/editorial
  alternative.
- **Read time** ("6 min read" in the designs) is not built in. The official
  recipe (<https://docs.astro.build/en/recipes/reading-time/>) uses a remark
  plugin (`reading-time` + `mdast-util-to-string`) with the `unified()`
  processor, surfaced via `remarkPluginFrontmatter.minutesRead` from
  `render(entry)`. Using it as written means opting into the remark pipeline
  (or finding/writing the Sätteri equivalent); alternatives are computing from
  `entry.body` at query time or hand-writing it in frontmatter.

## Open questions for the decision ticket

- `.md` + `components` mapping vs `.mdx` everywhere vs mixed vs Markdoc.
- Sätteri (default) vs `unified()` processor — decided largely by whether the
  reading-time remark plugin (and any other remark/rehype plugins) is wanted.
- Code block header: wrapper component vs meta-string transformer vs
  Expressive Code.
- Topic filter interactivity: static topic routes vs client-side filtering.
- Shiki theming: dual built-in themes vs `css-variables` theme wired to the
  design tokens.
