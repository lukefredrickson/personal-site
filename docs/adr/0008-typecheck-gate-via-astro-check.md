# 8. Typecheck gate via `astro check`

Date: 2026-07-23
Status: Accepted

## Context

Nothing in this repo verified TypeScript. `astro build` transpiles with esbuild,
which **strips** types rather than checking them, and the dev server does not
check either. A genuine type error in an `.astro` file compiled clean, passed
Workers Builds, and deployed to lukefredrickson.dev.

That gap matters more here than in a typical repo because of how the code gets
written. Most code in this project is written by an agent, not by a human in an
editor, and two consequences compound:

- The Astro VS Code extension's live diagnostics — the usual first line of
  defence — are never in the loop, because there is no editor in the loop.
- **There is no LSP server for `.astro`** in the agent environment. `AGENTS.md`'s
  Code Intelligence section, which tells agents to "check LSP diagnostics and fix
  errors before proceeding", was therefore unactionable for this repo's primary
  file type.

Net: between an agent writing `.astro` code and that code reaching production,
there was **zero** correctness signal of any kind. Nothing is broken today — the
site is still the Astro starter and there is no TypeScript to get wrong — but the
gap opens with the first component that declares a `Props` interface.

## Decision

Adopt `astro check` as the project's typecheck, invoked through a single `check`
npm script, and enforce it at three tiers that each do one job.

| Tier | Mechanism | Job |
| --- | --- | --- |
| Agent loop | `AGENTS.md` instruction + `npm run check` | The only feedback that exists — no `.astro` LSP |
| Local backstop | husky `pre-push` hook | Saves a CI round-trip; ~1.8s, once per push |
| Enforcement | Actions `typecheck` job + branch ruleset | Unbypassable; the only real gate |

**One seam.** All three tiers invoke `npm run check`; none spell out `astro
check` themselves. Changing flags later is a one-line edit that propagates to
every consumer. This is the only new entry point the change introduces.

**Dependencies.** `@astrojs/check` and `typescript` (which it requires — `astro
check` is not bundled with Astro, because it pulls in the full compiler that the
esbuild path deliberately avoids), plus `husky`.

**CI.** `.github/workflows/typecheck.yml`, with a job named exactly `typecheck` —
the job name becomes the status-check context string, so it is load-bearing
rather than cosmetic. Triggers on `pull_request` and on `push` to `main`. Node
pinned to 22 per `engines: >=22.12.0`, installs with `npm ci`. This is the repo's
first GitHub Actions workflow; **Workers Builds** remains the deploy CI and is
untouched.

**Severity: default.** `minimumSeverity` defaults to `hint`, so everything is
printed, but only errors set a non-zero exit. Verified on this repo: a type
mismatch reports as an `error` and exits 1; an unused variable reports as
`ts(6133)` at hint severity and exits 0. The merge gate is about correctness, not
tidiness.

**Not a lint.** `astro check` produces no accessibility diagnostics — a missing
`alt`, an inline `onclick`, and a bare `href="#"` all produce nothing. Linting,
formatting, and a11y checking are separate decisions, out of scope here.

**Ruleset changes are performed manually by the owner** in the GitHub UI after
this merges: enable *Require branches to be up to date before merging* and add
`typecheck` to required status checks, with no bypass actors. Landing order is
forced — GitHub can only require a status-check context it has already observed,
so requiring `typecheck` before the workflow exists on `main` would deadlock the
introducing PR.

## Alternatives considered

- **Change the `build` script to `astro check && astro build`**, as the Astro
  docs recommend — rejected. Workers Builds runs the build script, so a type
  error would fail the deploy and mint no **Preview URL**, removing the ability to
  view a branch precisely when a type error means you most want to look at it.
  Correctness and deployability stay decoupled.
- **Fold the check into the existing Workers Builds check**, already required on
  `main` and zero new infrastructure — rejected. Diagnostics would surface in the
  Cloudflare dashboard rather than the GitHub PR UI, and a failure would take the
  preview down with it.
- **A `pre-commit` hook instead of `pre-push`** — rejected. Pre-push fires once
  per push regardless of commit count, at the boundary where CI is imminent
  anyway, making it a true local mirror of the gate. Pre-commit would tax every
  WIP commit in a multi-commit session; it also checks the working tree rather
  than the index, though that footgun is mild here since agents stage wholesale.
- **A Claude Code `PostToolUse` hook** checking after every edit — rejected.
  During a multi-file refactor it fires while the code is legitimately
  half-finished (a prop renamed in one file, its consumer not yet updated),
  producing transient failures that invite an agent to chase its own tail.
- **`--noSync`** to reclaim ~300ms in the hook — rejected. `astro sync` is what
  regenerates `.astro/types.d.ts`; skipping it makes the check quietly wrong on a
  fresh clone or after a config change.

## Consequences

- A type error can no longer reach lukefredrickson.dev. It is caught locally at
  push time if the agent forgot to run the check, and blocked at merge if the
  hook was bypassed.
- A branch with a type error **still gets a Preview URL**, so a half-finished
  branch remains visually reviewable. This is the point of leaving `build` alone.
- The hook is installed by `npm install` via the `prepare` script, with no manual
  step. Husky v9 does not self-skip when `CI=true`, but installing hooks in CI is
  harmless and exits 0 (verified), and `npm ci` in the workflow installs
  devDependencies so `prepare` always resolves.
- **Bypass is possible and accepted.** `git push --no-verify` skips the hook; the
  hook is convenience, not enforcement. The ruleset is the actual guarantee.
- `tsconfig.json` needed no changes — it already extends `astro/tsconfigs/strict`
  and includes `.astro/types.d.ts`. Only the runner was missing.
- **Cost:** ~1.8s on this repo versus ~0.70s for `astro build`. There is no
  warm-cache effect — the type graph is rebuilt each run — so that is the floor,
  and it grows with the codebase.
- Once strict checks are enabled, any open PR whose branch is behind `main` will
  need "Update branch" before it can merge.
- No test framework is introduced, consistent with ADR 0006. Verification is the
  observed exit code of the seam and the observed state of the PR, never the
  internals of `astro check`, which is a vendored tool and not ours to test.
