# 21. Draft visibility on preview deploys

Date: 2026-08-04
Status: Accepted
Amends: [13. Blog content model](0013-blog-content-model.md) — its
`import.meta.env.PROD ? !draft : true` filter and the deferred consequence that
came with it. The one-helper rule stands; the condition inside it does not.

Resolves ticket
[#56](https://github.com/lukefredrickson/personal-site/issues/56), grilled from
the [realize-the-design-system map,
#18](https://github.com/lukefredrickson/personal-site/issues/18).

## Context

ADR 0013 hid drafts on `import.meta.env.PROD`, which is exactly true of a
production deploy and accidentally true of a preview deploy: Workers Builds runs
the same `astro build` for both. So the one place an author most wants to proof
an unfinished post — the per-PR preview URL — was the one place it could not be
seen. The remaining ways to look at a draft were `astro dev` (not the built
site) and publishing it for real.

The decision is not "show drafts on previews" — it is what the build is allowed
to conclude from its environment. The two failure directions are wildly
asymmetric: wrongly hiding a draft on a preview costs an author one annoyed
`astro dev`; wrongly showing one on `lukefredrickson.dev` publishes writing that
was never meant to be read.

## Decision

**Fail closed.** Drafts render only where the build can positively prove it is a
preview: `WORKERS_CI_BRANCH` — set by Workers Builds on every build it runs — is
present *and* is not `main`. Every other reading of the environment hides them:
a local `astro build`, a CI runner that isn't Workers Builds, or Cloudflare
renaming the variable out from under us. The rule is stated as proof-of-preview
rather than proof-of-production precisely so that an upstream change degrades
into hiding.

**A typed flag via `astro:env`.** `astro.config.mjs` computes the branch test
and declares `SHOW_DRAFTS` as a public server boolean whose *default* is that
result. The config is the single host-specific touchpoint; `src/lib/posts.ts`
imports a boolean from `astro:env/server` and knows nothing about Cloudflare.

**The local override falls out for free.** An explicitly set environment
variable beats a schema default, so `SHOW_DRAFTS=true npm run build` inspects
the built output with drafts in it, and `SHOW_DRAFTS=false` disarms a preview.
Nothing in the Cloudflare dashboard sets this variable, and nothing should — a
dashboard value would be a second, invisible source of truth for the one
behavior that must never surprise anyone.

**Dev is unconditional.** The helper reads `import.meta.env.DEV || SHOW_DRAFTS`.
Local writing is unchanged, and the flag stays honest about the one thing it
means: this build proved itself a preview.

**One helper, one flag, no split paths.** Drafts enter through
`getPublishedPosts()` or not at all, so they reach every derived surface —
prev/next chains, tag pills, tag counts, the sitemap — together. A preview is
"the site as if drafts were published," not a rehearsal of the exact production
diff.

**Drafts on previews are public.** Preview URLs are unauthenticated and carry no
`noindex`. A draft here means unfinished writing, not a secret; a sensitive
draft simply isn't pushed. That is part of what the word means on this site.

**The marker reads the entry, never the environment.**
`DraftBadge.astro` renders off `data.draft` alone, because a draft only exists
as a page in the contexts where the marker belongs — production filters it
before anything renders. It appears on the post header meta row, on index rows,
and on the home featured card: every surface a post can lead with. Visually it
is a `TagPill` in rose — a hue no tag maps to, so the badge cannot be misread as
one more chip in the row. Rose gains a `--tint-rose-fg` here, the design ADR
0030 said the wash-only hues were waiting for.

## Alternatives considered

- **Fail open** — show drafts unless the build proves it is production
  (`WORKERS_CI_BRANCH === 'main'`). Reads more naturally and needs no local
  override, and it is precisely backwards: the day Cloudflare renames the
  variable, every draft on the site publishes itself.
- **Split query paths** — drafts on their own pages but out of the index, or
  out of tag counts. Every split is a place for a surface to disagree with the
  others about what exists, and it makes the preview a worse model of the site
  than the simple rule does. The sitemap oddity below is the price of not
  taking this.
- **Cloudflare Access in front of preview URLs** — real protection, and the
  right answer if drafts were confidential. They aren't, and it buys an auth
  dependency plus a login prompt between a reviewer and the PR they were asked
  to look at.
- **A dashboard-set environment variable** — Cloudflare's own UI offers
  per-environment variables, which would skip the config logic entirely.
  Rejected: draft visibility would then live in a web console nobody diffs, and
  a misclick there is unreviewable.
- **`import.meta.env.MODE` with a custom `--mode preview`** — needs the build
  command to differ between production and preview, which means configuring the
  same fact in the dashboard anyway.

## Consequences

- A preview's sitemap lists draft URLs against the canonical domain, where they
  404. Sitemaps are absolute and built from `site`; only production's sitemap is
  ever fetched, so this is noise on a surface nobody consumes.
- A published post's prev/next neighbors can differ between preview and
  production, and the home featured card can be a draft. Both are the whole-site
  semantics working as intended.
- Adding a second host would mean teaching the config a second signal — one
  edit, in the one file that is allowed to know about hosting.
- `astro:env` is now in use for the first time. Future typed configuration has a
  home, and the schema is the place to look for what the build reads.
