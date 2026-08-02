# 28. Factory test suite: re-scoping the no-test-runner stance

Date: 2026-08-02
Status: Accepted

Resolves the testing decisions of
[#102](https://github.com/lukefredrickson/personal-site/issues/102)
(ticket [#103](https://github.com/lukefredrickson/personal-site/issues/103)),
closing [#82](https://github.com/lukefredrickson/personal-site/issues/82).
Amends the testing stance recorded in ADR 0018 ("the repo intentionally has
no test runner"). ADR numbers 0019–0027 are retired (see ADR 0018); this is
the next number.

## Context

Sandcastle's host tooling — the code that performs git surgery on the
operator's repo and origin — had zero committed verification. Three facts
compounded:

- **The typecheck gate is blind to it.** TypeScript's `**/*` include
  pattern skips dot-directories, so `npm run check` has never covered
  `.sandcastle/*.ts` (#82). A deliberate type error there sails through
  CI green.
- **The no-test-runner rule over-covered.** ADR 0018's stance was written
  for the site — a static Astro site whose gate is `astro check` — but as
  written it also forbade tests for the factory, whose failure mode is
  rewriting the operator's branches, not a rendering glitch.
- **Existing verification was prose.** PR #100's hardening was verified by
  24 behavioral assertions that exist only in a PR body: they cannot be
  re-run, so the next change to the restack/resume/ref-sync code can
  silently regress exactly the behavior that caused the run-1 incident.

The factory directory was also a flat pile of three unrelated populations
(library-pinned files, host source, agent prompts), leaving new test and
config files no coherent home.

## Decision

**Re-scope, not reverse.** The site stays test-runner-free — its gate
remains `npm run check`, and the sandbox prompts still forbid adding a
runner (no carve-out for factory-touching agents; deferred until needed).
The factory gets a committed, repeatable Vitest suite.

**Runner: Vitest**, as a devDependency, with its config scoped inside the
factory (`.sandcastle/vitest.config.ts`, rooted at the factory dir). The
site root gains no test-runner config; `npm run check` is unchanged.
Invocation: `npm run test:sandcastle`.

**Inner seams, not eviction.** `.sandcastle/src/` holds the host modules
with colocated `*.test.ts`; `.sandcastle/prompts/` holds the four agent
prompts plus `CODING_STANDARDS.md`. Library-pinned files (Dockerfile,
`.env`, plan file, runtime dirs `worktrees/`, `logs/`, `restack/`) stay at
the root — `@ai-hero/sandcastle` hardcodes the config-dir convention.
Moving host code out of the dot-directory entirely was rejected: it would
silently change what `npm run check` covers for every sandboxed agent.

**Scoped typecheck.** `.sandcastle/tsconfig.json` (extends root, Node
types, `src/` only) gives `tsc --noEmit -p .sandcastle` the dot-dir
coverage the root gate excludes. Closes #82.

**CI: path-filtered, not required.** A `Sandcastle` workflow job runs the
scoped typecheck then `vitest run`, triggered only by changes under
`.sandcastle/` (and the workflow file itself). It is deliberately not a
required check on `main`: site PRs stay untouched, a red X is visible
without merge-button plumbing, and promotion to required can happen later
if a red-X-ignored incident occurs.

**Test standard.** Specs assert observable behavior at the highest
existing seam — ref positions, commit lists, exit codes, printed
warnings — never internal function structure. Coverage lands in follow-up
tickets (PR #100's 24 prose assertions, the pure graph functions, the
walk/resume state machine); this ADR ships the pipeline with a smoke spec.
End-to-end orchestration is explicitly out of scope: the run itself is
that test.

## Consequences

- "The factory works" becomes a machine-checked claim instead of a
  remembered one; regressions in git-surgery code fail a test, not a live
  run.
- Two testing regimes now coexist in one repo, distinguished by
  directory. The rule is recorded here and in ADR 0018's amendment note.
- The factory's internal paths are now load-bearing in three places
  (path constants in `src/`, prompt `@`-references, the `sandcastle` npm
  script); a future restructure must update all three.
- Vitest and `@types/node` join the devDependencies the site itself never
  imports — accepted cost of keeping one lockfile.
