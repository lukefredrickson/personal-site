import type { Post } from './posts';

/** A tag and the number of published posts carrying it. */
export interface TagCount {
	tag: string;
	count: number;
}

/**
 * Every tag in use, ordered for the filter row: most-used first, alphabetical
 * tie-break so builds are deterministic (ADR 0014). Also the list the tag
 * routes are generated from — a tag has a pill exactly when it has a page.
 *
 * "everything" is not in here: it is the unfiltered index, not a tag, and its
 * count is simply the length of the list passed in.
 */
export function getTagCounts(posts: Post[]): TagCount[] {
	const counts = new Map<string, number>();
	for (const { data } of posts) {
		for (const tag of data.tags) {
			counts.set(tag, (counts.get(tag) ?? 0) + 1);
		}
	}

	// Posts carry several tags, so these counts legitimately sum past the number
	// of posts — inherent to tags (ADR 0014).
	return [...counts]
		.map(([tag, count]) => ({ tag, count }))
		.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
