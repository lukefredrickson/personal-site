import type { Post } from './posts';

/** A tag and the number of published posts carrying it. */
export interface TagCount {
	tag: string;
	count: number;
}

/**
 * Every tag in use, ordered for the filter row: most-used first, with an
 * alphabetical tie-break for deterministic builds (ADR 0014). The tag routes
 * generate from this list, so a tag has a pill exactly when it has a page.
 * "everything" is not a tag and is not in here.
 */
export function getTagCounts(posts: Post[]): TagCount[] {
	const counts = new Map<string, number>();
	for (const { data } of posts) {
		for (const tag of data.tags) {
			counts.set(tag, (counts.get(tag) ?? 0) + 1);
		}
	}

	// Posts carry several tags, so the counts sum past the post count (ADR 0014).
	return [...counts]
		.map(([tag, count]) => ({ tag, count }))
		.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
