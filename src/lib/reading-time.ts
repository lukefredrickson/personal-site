import type { SatteriProcessorOptions } from '@astrojs/markdown-satteri';

type MdastPlugin = NonNullable<SatteriProcessorOptions['mdastPlugins']>[number];

/** The `reading-time` package's default, and the de-facto standard rate. */
const WORDS_PER_MINUTE = 200;

const countWords = (value: string) => value.split(/\s+/).filter(Boolean).length;

/*
  Read time as an mdast plugin on the default Sätteri processor — the official
  remark recipe would drag the whole pipeline onto `unified()` (ADR 0020,
  amending ADR 0013). Registered once on `markdown.processor`, which `.mdx`
  inherits, so both formats get the same number.

  Code is excluded structurally rather than by a skip test: mdast `code` and
  `inlineCode` are literals holding a `value`, so a `text` subscription never
  reaches them.
*/
export const readingTimePlugin: MdastPlugin = {
	name: 'reading-time',
	text(node, ctx) {
		// The tally rides `ctx.data` — that bag is per document, while this
		// definition is shared across every compile, so a closure would total
		// the whole site.
		const prior = typeof ctx.data.readingWords === 'number' ? ctx.data.readingWords : 0;
		const words = prior + countWords(node.value);
		ctx.data.readingWords = words;

		// `data.astro.frontmatter` is the hand-off to `render()`'s
		// `remarkPluginFrontmatter`. There is no end-of-document hook, so every
		// text node republishes the running total; the last one wins.
		if (ctx.data.astro) {
			ctx.data.astro.frontmatter.readingMinutes = Math.max(
				1,
				Math.ceil(words / WORDS_PER_MINUTE),
			);
		}
	},
};
