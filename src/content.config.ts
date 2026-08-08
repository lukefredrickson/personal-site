import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/*
  One `blog` collection, mixed `.md`/`.mdx` (ADR 0013), folder-per-post as
  `<year>/<slug>/post.{md,mdx}` (ADR 0015). The post directory name is the
  slug and the whole URL, so the year folder changes nothing rendered. A
  post's assets sit beside `post.md`, where the loader pattern ignores them.
*/

// Lowercase kebab: a tag string is also its route segment and pill label
// (ADR 0014). `Bikes` beside `bikes` fails the build.
const TAG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// slug -> source path of the entry that claimed it.
const claimedSlugs = new Map<string, string>();

/*
  The slug is one path segment, so the filesystem guarantees uniqueness only
  per year; without this check `2025/foo/` and `2026/foo/` silently clobber
  one id. `prior !== entry` is load-bearing: dev-server re-syncs re-run this
  for files already in the map. Moving a post between year folders trips a
  false positive until the dev server restarts.
*/
function generateId({ entry }: { entry: string }): string {
  // entry is `<year>/<slug>/post.md`, per the loader pattern below.
  const [, slug] = entry.split('/');
  const prior = claimedSlugs.get(slug);
  if (prior !== undefined && prior !== entry) {
    throw new Error(
      `Duplicate blog slug "${slug}": both "${prior}" and "${entry}" resolve to /blog/${slug}/. ` +
        `Post directory names must be unique across year folders.`,
    );
  }
  claimedSlugs.set(slug, entry);
  return slug;
}

const blog = defineCollection({
  loader: glob({
    pattern: '*/*/post.{md,mdx}',
    base: './src/content/blog',
    generateId,
  }),
  // Frontmatter is only what other pages need: the index, feeds, OG tags.
  // The post body owns everything else (ADR 0013).
  schema: ({ image }) =>
    z
      .object({
        title: z.string(),
        description: z.string(), // doubles as the meta description
        pubDate: z.coerce.date(),
        updatedDate: z.coerce.date().optional(),
        tags: z
          .array(z.string().regex(TAG_PATTERN, 'tags must be lowercase kebab-case'))
          .default([]),
        hero: image().optional(),
        heroAlt: z.string().optional(),
        heroCaption: z.string().optional(),
        draft: z.boolean().default(false),
      })
      .refine((data) => data.hero === undefined || data.heroAlt !== undefined, {
        message: 'heroAlt is required when hero is set',
        path: ['heroAlt'],
      }),
});

export const collections = { blog };
