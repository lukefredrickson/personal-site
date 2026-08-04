# CONTEXT

Ubiquitous language for this project. One clean definition per term. When a
term gets fuzzy or overloaded, sharpen it here (see `/domain-modeling`).

## Domain

**Personal site** — the Astro static site served at `lukefredrickson.dev`.

**Base layout** — the shared page structure every screen renders inside: site
header, site footer, and the shared head/theme plumbing around a content slot.
Realized by `BaseLayout.astro`.
_Avoid_: "chrome" for this (or anything else that isn't the browser itself).

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
