# personal-site

Astro static site, deployed to Cloudflare Workers at lukefredrickson.dev.

## Learning contract

This is a learning project. Luke is proficient in React + TypeScript and
understands basic backend concepts (serverless functions, databases) but is
**new to Astro and Cloudflare**. Before executing non-trivial work:

- Explain the reasoning, the alternatives, and the trade-offs — don't just do it.
- Don't pure-delegate. Favor understanding over speed.
- Land changes as PRs; the diff review is the lesson, not the PR body. The body
  follows `.github/pull_request_template.md` and stays under ~200 words — it is
  a scan surface. State the root problem and the decided solution at high
  altitude, then let the code speak for itself. The full explainer (reasoning,
  alternatives, trade-offs) belongs in the ADR, which the PR links to.
  Never hard-wrap prose in a PR or issue body: GitHub renders a single newline
  there as a `<br>`, so wrapped paragraphs come out as a ragged column. Wrap
  Markdown *files* as usual — the rule is specific to PR/issue bodies.
- Record decisions as ADRs (see Domain docs).

## Tooling

- **Astro docs MCP** — available. Search it before Astro work; don't rely on
  training data (Astro 7 is recent).
- **Cloudflare MCPs** — docs search + live-account API + bindings/builds/
  observability. Use docs MCP before CF work, API MCP for account changes.
- **`gh` CLI** — installed and authenticated. Use it for all GitHub work
  (issues, PRs, releases). There is intentionally **no GitHub MCP** — the CLI
  burns far fewer tokens. Prefer `gh` over any MCP equivalent.
- Prefer the MCPs over model memory for Astro/Cloudflare — both stacks move fast.

## Code Intelligence

**LSP covers `.astro` as well as `.ts`/`.js`.** The `astro-lsp` plugin is
enabled by this repo's `.claude/settings.json`, and runs
`@astrojs/language-server` out of this project's own `node_modules` — the same
binary `npm run check` uses. See ADR 0009.

Prefer LSP over Grep/Read for code navigation — faster, precise, avoids reading
entire files:

- `goToDefinition` / `goToImplementation` to jump to source
- `findReferences` to see all usages across the codebase
- `hover` for type info without reading the file
- `workspaceSymbol` to find where something is **declared** — but see the caveat
  below

What LSP does *not* do here:

- **`workspaceSymbol` will not find a component by name.** It indexes
  declarations only; filenames and import aliases are not declarations, and an
  Astro component's compiled default export is anonymous. Querying `Welcome`
  returns nothing even though `Welcome.astro` exists. Frontmatter and TS
  declarations (`interface Props`, consts, functions) *are* findable. **"Where
  is component X" is a Grep/Glob job** — search for the filename.
- **Diagnostics lag one tool call.** They surface on the *next* tool result, not
  on the `Edit` that caused them, and a stale one can echo once after a fix
  before clearing. Treat them as eventually consistent: useful when they appear,
  never something to poll for. `npm run check` is the authoritative signal.

Use Grep for text/pattern searches (comments, strings, config) and for finding
files by name.

### Typechecking (the gate)

    npm run check

Run it after editing `.astro` or `.ts` files, at the point the work is finished
rather than after each individual write — mid-refactor failures are expected and
not worth chasing. It prints errors, warnings, and hints; only errors fail it.
The same script runs in a `pre-push` hook and in CI (the `typecheck` job,
required on `main`), so an unfixed type error cannot reach production. See
ADR 0008.

LSP diagnostics do **not** replace this. They cover only the files opened this
session; the check covers the whole project and fires even when the breakage is
in a file nobody touched.

## Workflow (Matt Pocock skills)

This repo follows the matt-pocock skills flow (github.com/mattpocock/skills):
grill the idea (`/grill-with-docs`) → model the domain (`/domain-modeling`,
`CONTEXT.md`) → build test-first (`/implement`, `/tdd`) → review
(`/code-review`). Record decisions as ADRs. Use `/teach` to learn a concept
over multiple sessions. Reach for the grill before writing code on anything
non-trivial. Run `/ask-matt` if unsure which skill fits.

## Deployment

Cloudflare Workers (static assets), auto-deployed via Workers Builds on merge
to `main`. Preview URLs per PR. Canonical domain: lukefredrickson.dev
(www + .com 301-redirect to it). See `docs/adr/` for the why.

## Issue tracker

Issues and PRDs live as GitHub issues (`gh` CLI). External PRs are not a
triage surface. See `docs/agents/issue-tracker.md`.

## Triage labels

Canonical five-role vocabulary (`needs-triage`, `needs-info`,
`ready-for-agent`, `ready-for-human`, `wontfix`). See
`docs/agents/triage-labels.md`.

## Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at repo root. See
`docs/agents/domain.md`.

## Development

Start the dev server in background mode:

    astro dev --background

Manage with `astro dev stop`, `astro dev status`, `astro dev logs`.
