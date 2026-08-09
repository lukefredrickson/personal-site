# CONTEXT

Ubiquitous language for this project. One clean definition per term. When a
term gets fuzzy or overloaded, sharpen it here (see `/domain-modeling`).

## Domain

**Personal site** — the Astro static site served at `lukefredrickson.dev`.

**Base layout** — the shared page structure every screen renders inside: site
header, site footer, and the shared head/theme plumbing around a content slot.
Realized by `BaseLayout.astro`.
_Avoid_: "chrome" for this (or anything else that isn't the browser itself).

**Tag** — an open lowercase-kebab string on a post, the one name for the
concept: schema field, route segment, chip label, map key (ADR 0014).
_Avoid_: "topic".

**Tint** — the color a chip, filter pill, logo tile, or framed figure wears.
One vocabulary, named by the palette hue it is (`blue`, `foam`, `gold`,
`rose`), plus `neutral` for the untinted role.

**Inline link** — a link styled as part of running text: every link in a post's
prose, plus the author card's link. Wears the link color and the underline, from
one shared definition a component opts into with `.inline-link` (ADR 0036). Not
a nav link, a button, a pill, or a card link — those carry their own identities.
_Avoid_: "prose link" for the treatment as a whole.

**Promotion ladder** — the vertical timeline running down the left of a company
card's roles: one dot per role, joined by rails. Home page only, realized by
`RoleEntry.astro`.
_Avoid_: "the timeline" or "the role dots" for the whole motif.

**Dot** — the ladder's circular marker for one role; filled with the accent on
the current role, a ring otherwise. Text-anchored decoration: it sizes in rem so
it stays centered on its role title at any reader font size (ADR 0030).

**Rail** — the hairline segment from one dot down to the next, inside a company
card. The card's last role has none.

**Connector** — the dotted vertical run between two company cards, carrying the
ladder across the gap. Page-centered decoration, not aligned to the dot column.

**Draft** — a post carrying `draft: true`: hidden from production, visible in
`astro dev` and on every preview deploy, and publicly reachable there. Not a
secret — a sensitive post simply isn't pushed. Marked wherever it surfaces by
the rose `draft` badge (ADR 0021).

**Read time** — a post's estimated minutes, counted from its prose only (never
code) at build time and shown in the post header. Never in frontmatter, never
on list surfaces. See ADR 0020.

## Brand assets

**Brand asset** — a file in `public/` that carries the site's identity: the
favicon, the touch and manifest icons, and the OG card. Every one is written by
the generator; none is hand-maintained (ADR 0036, ADR 0038).

**Mark** — the `lf.` lockup: the letters `l` and `f` plus a period, set at
fixed offsets. The letters wear the ink fill, the period the gold accent.
_Avoid_: "logo", and "dot" for the period — that is the ladder's marker.

**Mark source** — `scripts/FiraCode-VariableFont_wght.ttf`, the committed Fira
Code variable font. Every letterform in every brand asset is outlined from it:
the mark and the wordmark at weight 700, the tagline at 400 (ADR 0038). A
shipped asset is a visual reference target, never a source.

**Generator** — `scripts/generate-icons.mjs`, run by `npm run generate:icons`.
It outlines the mark from the mark source and writes the brand assets. Its
output is deterministic: two runs produce identical bytes.

**Tile** — the `#211d38` square behind the mark in every raster brand asset. It
carries the dark fills, because a raster brand asset answers no theme query
(ADR 0037). `favicon.svg` is an SVG and has no tile.

**Frame** — one rendered size of a raster brand asset. `favicon.ico` packs two
frames, 16 and 32; every other raster brand asset is a single frame.

**OG card** — `public/og-default.png`, the 1200×630 preview image a link to the
site unfurls into. It sets the mark on its tile, the wordmark, and the tagline
inside a rounded card, in the dusk theme (ADR 0038).

**Wordmark** — the `lukefredrickson.dev` lockup on the OG card: the site
header's logo, enlarged. The domain wears the ink fill, the `.dev` the gold
accent.

**Tagline** — the OG card's one line under the wordmark: "building software for
the energy transition".

**Run** — one string of set type. The generator outlines every run from the
mark source, and steps the pen by a fixed em fraction rather than by the font's
advance (ADR 0038). The OG card carries three runs: the wordmark's domain, its
`.dev`, and the tagline.

**Highlighter** — the translucent gold stroke behind a run of words: the home
hero's, and the OG card's under the wordmark's domain. It covers the run's
bottom 36%.
_Avoid_: "marker" for this — that is the ladder's dot.

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
base). Complete exactly when its ledger's verdict says so — an open PR,
or a newest-PR-merged. Progress lives on GitHub, not in local state.

**PR ledger** — every PR whose head is a step's branch, in any state;
fetched once per step at step start. The walk's only cross-run memory:
an open PR wins, otherwise the newest PR decides (merged → complete,
closed → rejected).
_Avoid_: treating branch contents as progress.

**Stale branch** — a step's branch whose newest PR is closed-unmerged,
or which has commits but no PR: deleted (origin and local refs) and
rebuilt fresh under the same name. The rejected history survives in its
closed PRs.

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
implementer builds and commits; the reviewer runs in a fresh sandbox on
the same branch when it carries commits ahead of its base. Neither
pushes nor opens the PR — the host does both, opening the draft PR only
after the review (ADR 0036).

**Check gate** — `npm run check`, the single mechanical pass/fail signal.
Gates the implementer in the sandbox and every rewritten tip on the host;
the repo intentionally has no test runner.

**Restack** — the serial post-wave rebase of each branch onto the growing
chain in a dedicated host worktree under a lock, gated per tip, then
force-pushed with its PR base retargeted. Owns all raw git for the run
(structural invariant).

**Detected no-op** — a restack step whose branch already descends from
the chain tip: nothing rewritten, no re-check, no push. How open-PR
completed steps resume for free (merged steps skip restack entirely).

**Replay window** — the range a restack rebase replays: onto the chain
tip, from the base sha the branch was built on, so only the branch's own
commits ever replay (ADR 0018).

**Ancestry gate** — the resume check on a leftover branch: a ref that
does not descend from the step's assigned base resets to it, and a
checked-out or diverged local ref blocks the step untouched (ADR 0018).

**Resolver agent** — the host-run agent given one attempt at a conflicted
rebase, inside the restack worktree. Judged mechanically by the git state
it leaves; its self-report is ignored (as is the implementer's).

**Prune** — removing from the chain a step that cannot join it, together
with its dependency-descendants (prune closure) — including any branch
whose history contains a pruned step's commits. Pruned branches and PRs
are left untouched within the run — the next run judges them by their
ledger like any other step; any prune makes the run exit non-zero.
