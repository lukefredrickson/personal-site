# CONTEXT

Ubiquitous language for this project. One clean definition per term. When a
term gets fuzzy or overloaded, sharpen it here (see `/domain-modeling`).

## Domain

**Personal site** — the Astro static site served at `lukefredrickson.dev`.

## Astro

**Static output** — Astro's default build mode: every page is pre-rendered to
plain HTML/CSS/JS at build time. No server runs per request. Output lands in
`./dist`.

**Adapter** — a plugin (`@astrojs/cloudflare`) that lets Astro server-render on
a specific platform. **Not used here** — a pure static site needs no adapter.

**Island** — an interactive component (React/Vue/etc.) hydrated on an otherwise
static page. Not used yet; noted because it's core Astro vocabulary.

## Cloudflare

**Zone** — a domain managed by Cloudflare (DNS + settings). This project has
two: `lukefredrickson.dev` (canonical) and `lukefredrickson.com` (redirects in).

**Worker** — a script deployed to Cloudflare's edge. Here it does nothing but
serve static assets; the name is `personal-site`.

**Static assets** — files (`./dist`) uploaded with a Worker and served directly
from the edge without running code. The whole site is these.

**Binding** — a named connection from Worker code to a Cloudflare resource (KV,
D1, R2, secret). **None here** — a static site has no bindings.

**Custom domain** — a Worker route attached to a real domain (`lukefredrickson.dev`),
so visitors reach the Worker at that hostname. Cloudflare manages the DNS record.

**Workers Builds** — Cloudflare's built-in CI/CD. Watches the GitHub repo,
builds on push to `main`, deploys. Also builds non-production branches to
preview URLs.

**Preview URL** — a stable per-branch URL (`<branch>-personal-site.<account>.workers.dev`)
that Workers Builds deploys each PR branch to, and posts as a PR comment.

**Redirect Rule** — a zone-level rule that 301-redirects at the edge before any
Worker runs. Used to send `www.dev`, `.com`, `www.com` → `lukefredrickson.dev`.

**`_atproto` TXT** — DNS record on `.dev` that verifies the Bluesky handle.
Preserved through all DNS changes.

## Blog

**Post** — one entry in the single `blog` collection: a folder
`src/content/blog/<year>/<slug>/` holding `post.md` (or `.mdx`) plus
everything the post owns (photos, one-off components). There are no post
types — any post may use any block (ADR 0013).
_Avoid_: "tech post" / "ride post" as kinds — they are one layout whose
optional sections render when their data exists.

**Slug** — the post's directory name, verbatim: it is the entry id and the
whole URL (`/blog/<slug>/`), unique across all year folders (build-guarded).
_Avoid_: frontmatter slug overrides; dated URLs.

**Year folder** — the `<year>/` level above a post, for browsability only.
Not part of the URL; moving a post between years changes nothing rendered.

**Draft** — a post with `draft: true`: visible in dev, hidden in every
production build — including preview deploys, which are PROD builds.

**Published post** — a non-draft post as production sees it, newest first.
Every listing, feed, and neighbor derives from the one helper
(`getPublishedPosts()`) that applies the filter and the sort.

**Featured post** — the newest published post, shown as the home page's big
card. Purely positional — there is no featured flag and no curation.

**Graduation** — renaming a post from `.md` to `.mdx` at the moment it needs
components in its body. The only difference between plain and rich posts.

**Hero** — a post's optional lead image; alt text is required with it.

**Prev / Next** — a post's chronological neighbors: **prev = older,
next = newer**.

### Tags

**Tag** — the open taxonomy: a lowercase-kebab string in a post's `tags`
list. The tag string is simultaneously the route segment and the pill label —
no mapping layer, so `Bikes` vs `bikes` fails the build.
_Avoid_: "category"; "topic" as a taxonomy word — a topic is a tint (below).

**Tag page** — `/blog/tags/<tag>/`: the blog index screen filtered to one
tag. Every tag in use gets one; there is no bare `/blog/tags/` index — the
pill row on the blog index is the tag directory.

**Everything** — the unfiltered blog index at `/blog/`. Not a tag: its pill
links to the index, and its count is the number of published posts. Tag
counts legitimately sum past it, since posts carry several tags.

**Filter pill** — one entry in the pill row on the index and tag pages:
"everything" first, then every tag in use, most-used first. Always a link,
even when active.

**Tag pill** — the small tag chip on list items, cards, and posts, linking to
its tag page (the "more like this" affordance).
_Avoid_: conflating with filter pill — that one filters a list; this one
labels a post.

**Topic** — a presentation **tint**, not a classification: the color a chip
or pill wears (`code`, `bikes`, `video`, `neutral`). One map assigns tints to
tags; an unmapped tag is fully functional, just neutral. `video` tints
in-prose video cards only, never a tag.
_Avoid_: "topic" for what a post is about — that's its tags.

## Theming

**Theme override** — the `data-theme` attribute on `<html>`, stamped and
persisted only when the visitor clicks the toggle. No override means the OS
preference rules via pure CSS, zero JS involved; there is no third
"follow system" UI state (ADR 0012).

## Sandcastle

The name is overloaded three ways; each gets its own term. Full design:
ADR 0018.

**Orchestrator** — the stacked-PR system in `.sandcastle/` at this repo's
root, run via `npm run sandcastle <plan|run>`. When "Sandcastle" appears
unqualified in this repo, it means this.
_Avoid_: bare "Sandcastle" where the library or label could be meant.

**Sandcastle library** — `@ai-hero/sandcastle`, the upstream npm package
(github.com/mattpocock/sandcastle) that provides sandbox lifecycle and
agent invocation. The orchestrator is a consumer; stacking, planning, and
restacking are all this repo's code, not the library's.

**Sandcastle label** — the GitHub issue label that is the orchestrator's
queue: planning reads exactly the open issues carrying it. Meta-fixes to
the orchestrator itself are deliberately not labeled.

### Planning

**Plan** — the persisted proposal (`.sandcastle/plan.json`, gitignored)
that `run` executes byte-for-byte. Records intent, never progress; spent
(deleted) on a fully successful run, retained on failure for resume.
_Avoid_: treating the plan as run state or a progress log.

**Replan** — overwriting the plan by re-running `plan`. The only refresh
gesture; there is no separate command.

**Judgment agent** — the read-only host-run agent that proposes blocked-by
edge additions and removals during planning. Proposes only; host code
screens and applies.
_Avoid_: planner, planning agent.

**Mutation** — one proposed blocked-by edge addition or removal.
Screened mechanically (`screenMutations`): cycle-creating or
unknown-issue mutations drop with a logged reason. `run` is the only
writer of surviving mutations to GitHub.

### Stacks

**Blocked-by graph** — GitHub's native issue-dependency edges over the
labeled issues, as amended by screened mutations. The sole input to
grouping and ordering; its accuracy is load-bearing.

**Stack** — one ordered chain of steps per connected component of the
blocked-by graph, chained from `main`. A one-issue component is a
standalone PR, not a stack.

**Step** — one issue's unit of work: (issue, branch `sandcastle/issue-<n>`,
base). Complete exactly when its branch has an open PR — progress lives
on GitHub, not in local state.

**Level** — one topological rank of a stack's blocked-by graph: the
issues with no unbuilt blockers, ordered ascending by issue number
(level-major order).

**Wave** — the concurrent execution of one level: each member builds in
its own sandbox cut from the same chain tip. Level is graph structure;
wave is its execution.

### Execution

**Sandbox** — the isolated Docker environment (via the Sandcastle
library) in which one step's agents build. Drawn from a global pool
capped at 3, shared across all stacks.

**Implementer / Reviewer** — the sandboxed agents for one step: the
implementer builds, pushes, and opens the draft PR; the reviewer runs
after it in the same sandbox, only if commits were produced.

**Check gate** — `npm run check`, the single mechanical pass/fail signal.
Gates the implementer in the sandbox and every rewritten tip on the host;
the repo intentionally has no test runner.

**Restack** — the serial post-wave rebase of each branch onto the growing
chain in a dedicated host worktree under a lock, gated per tip, then
force-pushed with its PR base retargeted. Owns all raw git for the run
(structural invariant).

**Detected no-op** — a restack step whose branch already descends from
the chain tip: nothing rewritten, no re-check, no push. How completed
steps resume for free.

**Resolver agent** — the host-run agent given one attempt at a conflicted
rebase, inside the restack worktree. Judged mechanically by the git state
it leaves; its self-report is ignored (as is the implementer's).

**Prune** — removing from the chain a step that cannot join it, together
with its dependency-descendants (prune closure) — including any branch
whose history contains a pruned step's commits. Pruned branches and PRs
are left untouched for the operator or a re-run; any prune makes the run
exit non-zero.
