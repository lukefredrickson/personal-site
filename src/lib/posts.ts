import { getCollection, type CollectionEntry } from 'astro:content';
import { SHOW_DRAFTS } from 'astro:env/server';

export type Post = CollectionEntry<'blog'>;

/*
  Drafts always render in `astro dev`; a build shows them only where it proved
  itself a preview (ADR 0021). Production and every ambiguous case hide them —
  that asymmetry is the whole point, so the flag is read once, here.
*/
const includeDrafts = import.meta.env.DEV || SHOW_DRAFTS;

/*
  The one way to read the blog collection. It bundles the draft filter and the
  sort so no call site can forget either (ADR 0013): pages, tag routes, feeds
  and prev/next all start here and narrow from the result. Drafts therefore
  reach every derived surface — prev/next chains, tag pills, counts, sitemap —
  or none of them.
*/
export async function getPublishedPosts(): Promise<Post[]> {
  const posts = await getCollection('blog', ({ data }) => includeDrafts || !data.draft);

  // Newest first; id tie-break keeps same-day posts in a stable build order.
  return posts.sort(
    (a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime() || a.id.localeCompare(b.id),
  );
}

/**
 * A post date as the mono meta line writes it: `jun 21, 2026`, or
 * `jun 2026` at month precision. Lowercase because that meta always is, and
 * UTC — a date stamped at midnight renders as the day before out west.
 */
export function formatPostDate(date: Date, precision: 'day' | 'month' = 'day'): string {
	return date
		.toLocaleDateString('en-US', {
			month: 'short',
			day: precision === 'day' ? 'numeric' : undefined,
			year: 'numeric',
			timeZone: 'UTC',
		})
		.toLowerCase();
}

/**
 * The read-time plugin's minute count as the meta line writes it. The count is
 * absent only when a post holds no prose at all (an all-code page), and the
 * shortest read is still one minute.
 */
export function formatReadTime(minutes = 1): string {
	return `${minutes} min read`;
}
