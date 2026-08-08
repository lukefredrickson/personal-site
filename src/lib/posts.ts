import { getCollection, type CollectionEntry } from 'astro:content';
import { SHOW_DRAFTS } from 'astro:env/server';

export type Post = CollectionEntry<'blog'>;

/* Drafts render in `astro dev` and on previews; production and every
   ambiguous case hide them (ADR 0021). The flag is read once, here. */
const includeDrafts = import.meta.env.DEV || SHOW_DRAFTS;

/*
  The one way to read the blog collection: it bundles the draft filter and
  the sort so no call site can forget either (ADR 0013). Every surface
  starts here, so drafts reach all derived surfaces or none.
*/
export async function getPublishedPosts(): Promise<Post[]> {
  const posts = await getCollection('blog', ({ data }) => includeDrafts || !data.draft);

  // Newest first; id tie-break keeps same-day posts in a stable build order.
  return posts.sort(
    (a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime() || a.id.localeCompare(b.id),
  );
}

/**
 * A post date as the mono meta line writes it: `jun 21, 2026`, or `jun 2026`
 * at month precision. Lowercase matches the meta; UTC keeps a
 * midnight-stamped date on its own day.
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
 * The read time as the meta line writes it. The count is absent only for a
 * prose-free post; the shortest read is one minute.
 */
export function formatReadTime(minutes = 1): string {
	return `${minutes} min read`;
}
