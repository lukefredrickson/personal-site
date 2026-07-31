# 18. Sandcastle: sequential stacked-PR orchestration

Date: 2026-07-30
Status: Accepted

Resolves
[#57](https://github.com/lukefredrickson/personal-site/issues/57). Reshapes
the Sandcastle setup landed in
[#17](https://github.com/lukefredrickson/personal-site/pull/17) before its
first real run over the build backlog (#42–52).

## Context

The committed Sandcastle template (parallel planner with review) merges agent
branches directly into the local branch and closes issues from inside the
sandbox. Run against the build backlog, that would bypass everything this
repo's working agreement hangs on: no pull requests means no diff review (the
learning contract's centerpiece), no CI typecheck gate, and no per-PR preview
URLs — which every build issue's done-when cites. It also had smaller rot: the
agent prompts gate on `npm run typecheck` and `npm run test`, neither of which
exists; the reviewer's standards file was an empty scaffold; and the planner
agent cannot see the native blocked-by edges wired between the build issues.

The owner wants two things at once: full AFK execution of the whole backlog,
and per-issue review granularity. Waiting to merge each PR before the next
issue builds would forfeit AFK; one mega-PR would forfeit the per-issue
lesson.

## Decision

### Sequential walk, one draft PR per issue, chained as a GitHub stack

The plan → parallel-execute → merge loop is replaced by a deterministic
sequential walk. Open issues labeled `Sandcastle` are ordered by their
`Build NN:` title prefix — a pure function in `.sandcastle/stack.ts`, no
planner agent, no LLM judgment in the ordering. Each issue runs implementer +
reviewer in a sandbox on `sandcastle/issue-<n>`, cut from the previous
issue's branch tip via `createSandbox`'s `baseBranch` (the first from
`main`), so each layer builds on unmerged dependencies. The implementer
pushes the branch and opens a draft PR based on the previous branch with
stock `gh`; per GitHub's stacked-PR model, correctly chained bases are all
the automation needs. The planner and merge agents — and the merge prompt —
are deleted. Nothing closes issues; each PR body's closing keyword does, on
merge.

The owner reviews bottom-up with the `gh-stack` extension (`gh stack link`
to bind, `sync`/`merge` to manage) — a local, human-side tool, deliberately
not added to the agent image. Branch protection evaluates against `main`, so
the required typecheck check guards every layer despite intermediate bases.

### The seam is `--dry-run`

`npm run sandcastle -- --dry-run` exercises the real path — issue fetch,
ordering, branch/base assignment — minus side effects, and prints the walk.
It is both the pre-flight before every paid run and the verification for
this change. No test framework is added: the repo intentionally has none,
and ~30 lines of sort-and-chain logic doesn't justify importing one.

The walk is also validated against GitHub's native blocked-by graph before
the dry-run exit (and before every paid run). The `Build NN:` order remains
the source of truth; the graph is a cross-check that fails the run if a
mis-ordered or mis-labeled backlog would build an issue before its blockers.
A closed blocker counts as satisfied; an open blocker outside the walk fails
it. The check is a pure function in `.sandcastle/stack.ts`; `main.ts` fetches
the edges via the REST dependencies endpoint and passes them in as data.

### Agent environment fixes

- The prompts' gate becomes `npm run check`; all `npm run typecheck` /
  `npm run test` references are removed, not made conditional.
- `CODING_STANDARDS.md` becomes a light north-star file: idiomatic Astro
  over other frameworks' habits and over the React-shaped specs; ADRs are
  binding (0010/0011/0012 first); zero-client-JS presumption, scoped styles
  on tokens, no UI-framework deps; gate is `npm run check`; there is no test
  runner and agents must not add one; consult the Astro docs MCP over
  training data. A per-rule digest was rejected — pointers over restatement,
  so the file can't drift from the ADRs.
- A repo-level `.mcp.json` registers the Astro docs MCP
  (`https://mcp.docs.astro.build/mcp`, verified live at implementation
  time), so sandboxed agents inherit it instead of it living only in the
  owner's user-level config.
- A step that errors or produces no commits aborts the walk: later layers
  are cut from earlier tips, so continuing would stack PRs onto a hole. A
  step whose commits landed but whose PR is missing (the implementer opens
  it in-sandbox, where a flaked `gh pr create` passes silently) only warns —
  the branch chain stays valid and the PR is recoverable by hand — but the
  host verifies each layer's PR with `gh pr view` and the run exits nonzero
  if any are missing.

Unchanged: model choices (opus-5), iteration limits, idle timeouts, the
Dockerfile, and sandbox setup. Branch names stay `sandcastle/issue-<n>`.

## Alternatives considered

- **Merge-per-wave (stock behavior), review after the fact** — rejected:
  review after merge is no gate at all.
- **`Blocked by:` lines in issue bodies for the planner** — superseded: the
  deterministic linear order removes the planner entirely.
- **Parallel execution within the stack** — rejected for v1: a
  rebase-conflict surface with no review-granularity benefit.

## Consequences

- One AFK run leaves an eleven-PR stack over #42–52; merging the bottom PR
  auto-retargets and rebases the rest server-side, re-running CI.
- The known tax of stacking: changes requested on a middle PR force a rebase
  of everything above (`gh stack sync` automates the mechanics; the
  mostly-disjoint files across build issues should keep conflicts rare).
- The sandbox's GitHub token now needs **Contents read/write** (branch
  pushes) on top of issues and pull-request scopes.
- Go-button steps, out of scope here: label #42–52 with `Sandcastle`,
  install `gh extension install github/gh-stack` locally, and dry-run first.
