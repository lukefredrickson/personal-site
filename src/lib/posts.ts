import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'blog'>;

/*
  The one way to read the blog collection. It bundles the draft filter and the
  sort so no call site can forget either (ADR 0013): pages, tag routes, feeds
  and prev/next all start here and narrow from the result.

  Drafts are hidden in production only, so an unfinished post can merge to
  `main` and still be visible in `astro dev`. Preview deploys are PROD builds,
  so drafts are hidden there too (issue #56).
*/
export async function getPublishedPosts(): Promise<Post[]> {
  const posts = await getCollection('blog', ({ data }) =>
    import.meta.env.PROD ? !data.draft : true,
  );

  // Newest first; id tie-break keeps same-day posts in a stable build order.
  return posts.sort(
    (a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime() || a.id.localeCompare(b.id),
  );
}

/**
 * A post date as the design's mono meta writes it: `jun 21, 2026`, or
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
