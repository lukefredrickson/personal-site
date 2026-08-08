import type { SatteriProcessorOptions } from '@astrojs/markdown-satteri';

type MdastPlugin = NonNullable<SatteriProcessorOptions['mdastPlugins']>[number];

/** The `reading-time` package's default, and the de-facto standard rate. */
const WORDS_PER_MINUTE = 200;

const countWords = (value: string) => value.split(/\s+/).filter(Boolean).length;

/*
  Read time as an mdast plugin on the default Sätteri processor (ADR 0020).
  `.mdx` inherits `markdown.processor`, so both formats get the same number.
  Code is excluded structurally: mdast `code` and `inlineCode` hold their
  text as a `value`, so a `text` subscription never reaches them.
*/
export const readingTimePlugin: MdastPlugin = {
	name: 'reading-time',
	text(node, ctx) {
		// The tally lives on `ctx.data`, which is per document; this shared
		// definition with a closure would total the whole site.
		const prior = typeof ctx.data.readingWords === 'number' ? ctx.data.readingWords : 0;
		const words = prior + countWords(node.value);
		ctx.data.readingWords = words;

		// `data.astro.frontmatter` hands off to `render()`. There is no
		// end-of-document hook; every text node republishes, the last wins.
		if (ctx.data.astro) {
			ctx.data.astro.frontmatter.readingMinutes = Math.max(
				1,
				Math.ceil(words / WORDS_PER_MINUTE),
			);
		}
	},
};
