import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/*
  One `blog` collection, mixed `.md`/`.mdx` (ADR 0013), folder-per-post as
  `<year>/<slug>/post.{md,mdx}` (ADR 0015). Year folders are organizational
  only: the post directory name is the slug and the whole URL
  (`/blog/<slug>/`), so moving a post between years changes nothing rendered.
  Everything a post owns — photos, one-off components — sits beside `post.md`,
  where the loader pattern ignores it.
*/

// Lowercase kebab, so a tag string is also its route segment and pill label
// with no mapping layer (ADR 0014). `Bikes` vs `bikes` fails the build instead
// of quietly becoming two tag pages.
const TAG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// slug -> source path of the entry that claimed it.
const claimedSlugs = new Map<string, string>();

/*
  Taking the slug from one path segment narrows the filesystem's uniqueness
  guarantee to per-year, so nothing but this check stops `2025/foo/` and
  `2026/foo/` from resolving to the same id — and by `getCollection()` time the
  loser has already silently clobbered its twin in the id-keyed data store.

  The `prior !== entry` comparison is load-bearing: dev-server re-syncs re-run
  this for files already in the map. Cost of the module-scope map: moving a post
  to a different year folder trips a false positive until the dev server
  restarts.
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
  // Frontmatter is only what *other* pages need — the index, feeds, and OG
  // tags. The post body owns everything else; stat chips, figures and embeds
  // are components in the body, not fields here (ADR 0013).
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
