# 9. `.astro` LSP via the `claude-astro-lsp` plugin

Date: 2026-07-23
Status: Accepted
Amends: ADR 0008 (Context only — the three tiers stand)

## Context

ADR 0008 built the three-tier typecheck gate around a specific premise: between
an agent writing `.astro` code and that code reaching production there was
**zero** correctness signal, because no LSP server was available for `.astro` in
the agent environment. That premise was carefully worded — an official server
does exist (`@astrojs/language-server`, pulled in transitively by
`@astrojs/check` and already in `package-lock.json`), but *nothing wired it up
as an LSP the agent could query*.

That last clause is what changed. `claude-astro-lsp`
(github.com/lukefredrickson/claude-astro-lsp) is a Claude Code plugin that wires
it up: a lazy-spawn proxy that resolves the language server from the *consuming
project's* `node_modules` and injects `initializationOptions.typescript.tsdk`
into the LSP `initialize` message. Without that injection the Astro server is
silently dead — it initializes, advertises every capability, and then answers
`undefined` to every request forever. Resolving from the project also guarantees
the LSP and `astro check` are the same binary, so the interactive signal and the
CI gate cannot disagree about what a type error is.

`.astro` is this repo's primary file type. A capability the repo depends on
should be declared by the repo.

## Decision

Enable the `astro-lsp` plugin from this repo's own `.claude/settings.json` —
the repo's first `.claude/` directory:

```json
{
  "extraKnownMarketplaces": {
    "claude-astro-lsp": {
      "source": { "source": "github", "repo": "lukefredrickson/claude-astro-lsp" }
    }
  },
  "enabledPlugins": { "astro-lsp@claude-astro-lsp": true }
}
```

The rationale mirrors ADR 0008's husky reasoning: no manual step, checked in,
applies to whoever opens the repo next. It declares both the marketplace and the
enablement, so a fresh clone needs no `/plugin` commands.

**ADR 0008 remains in force, in full.** The three tiers are unchanged.
`npm run check` is still the gate, the `pre-push` hook is still the local
backstop, and the branch ruleset is still the only real guarantee. Nothing in
0008's Decision, Alternatives, or Consequences is superseded.

**One premise narrowed; no decision reversed.** 0008's Agent-loop tier row —
*"The only feedback that exists — no `.astro` LSP in reach"* — is now historical.
It was accurate when written and is left in place unedited, with a status line on
0008 pointing here, so a reader who never opens this ADR still cannot draw the
wrong conclusion from it.

**The new tier gates nothing.** LSP diagnostics sit *above* the three tiers as
advisory signal, not as a fourth tier. The tempting wrong conclusion is *"we have
live diagnostics now, so the pre-push hook is redundant"*. It is not:

- The hook checks the **whole project**; LSP diagnostics cover only the files
  that were opened in the session.
- The hook fires **even when the agent never touched the offending file** — the
  common shape of a breakage, where a change in one file invalidates another.
- The hook is a **command exit code**; diagnostics are an observation nobody has
  to act on.

**Why per-edit LSP diagnostics are not the `PostToolUse` hook 0008 rejected.**
0008 rejected a hook that ran the typecheck after every edit, because during a
multi-file refactor it fires while the code is legitimately half-finished and
invites an agent to chase its own tail. LSP diagnostics differ on all three
counts that made that a problem: they are **per-file**, not whole-project, so a
half-updated consumer elsewhere does not shout; they are an **observation**, not
a command *failure*, and the tail-chasing pull comes from watching a command
fail; and they **gate nothing**, so ignoring a transient one costs nothing. This
is not a silent reversal of that rejection — the rejected mechanism is still
rejected.

## Alternatives considered

- **Do nothing; leave `npm run check` as the only signal** — rejected. The check
  is a whole-project batch command with a ~1.8s floor. It answers "is anything
  broken", never "what type does this expression have" or "where is this
  defined". Navigation questions were being answered by Grep and Read, which
  costs tokens and, on a `.astro` file, cannot see through the compiler at all.
- **Per-user install via `/plugin install`, left out of the repo** — rejected,
  on ADR 0008's husky reasoning: a capability the repo depends on should be
  declared by the repo, so a fresh clone is correct without a manual step and
  `AGENTS.md` can state the capability as fact rather than as a suggestion.
- **`.claude/settings.local.json` instead of `settings.json`** — rejected for the
  same reason: `settings.local.json` is per-user and gitignored, which is exactly
  the manual step being removed. It stays gitignored for genuinely local
  overrides.
- **Vendor the language server inside the plugin** — rejected, and the plugin
  deliberately does not. Resolving from the consuming project's `node_modules`
  guarantees the LSP and `astro check` are the same binary; a vendored copy could
  drift and let the interactive signal disagree with the CI gate about what a
  type error is.
- **Pin the marketplace to a commit SHA** rather than a repo — not available;
  marketplace entries take a source, and updates come via `version` bumps. The
  weakness is recorded under Consequences rather than solved.
- **The upstream `ricardo-nth/claude-astro-lsp`** — rejected. It spawns
  `astro-ls` from `PATH`, which requires a global install and reintroduces the
  drift the previous point rules out. `claude-astro-lsp` is derived from it and
  keeps the `tsdk`-injection idea.

## Verified behaviour

Observed in-session through Claude Code's LSP tool against `src/pages/index.astro`,
on the GitHub-sourced install this ADR ships — not on a local-path development
install, which runs a different code path:

| Operation | Result |
| --- | --- |
| `goToDefinition` on the `Welcome` import | resolves to `src/components/Welcome.astro:1:1` |
| `hover` | `(alias) function Welcome(_props: Record<string, any>): any` |
| `findReferences` | 2 refs (2:8, 10:3) |
| `documentSymbol` | `Layout` → `Welcome` |
| `workspaceSymbol` | works, with the declarations-only semantics below |
| Deliberate `.astro` type error | diagnostic surfaced; reverted clean |
| `npm run check` | caught the same error independently; 0 errors after revert |

Plus:

- **Lazy spawn confirmed.** No server process existed after the plugin loaded;
  one appeared only after the first LSP call. This is the evidence the plugin's
  `defaultEnabled: true` rests on — an always-on plugin that costs nothing until
  used.
- **Cache-anchored proxy confirmed.** `ps` showed the proxy running from
  `~/.claude/plugins/cache/claude-astro-lsp/astro-lsp/1.0.0/bin/astro-ls-proxy.mjs`
  at plugin commit `d01d1ff`, with install scope `project` — i.e. enabled by the
  `.claude/settings.json` this ADR adds, not by a user-level `/plugin install`.
- **Project-anchored resolution confirmed.** The server ran from this repo's
  `node_modules/@astrojs/language-server`, not a copy bundled with the plugin.
- **Memory: ~370–410 MB** for the server plus ~40 MB for the proxy process
  (409 MB / 41 MB observed on this repo).

## Consequences

- **Pinned by discipline, not by a lockfile.** The marketplace entry names a
  GitHub repo, not a commit; updates arrive via marketplace `version` bumps.
  This is knowingly weaker than how `@astrojs/check` is pinned two lines away in
  `package-lock.json`, and is accepted because the plugin is first-party.
- **`workspaceSymbol` will not find a component by name.** It indexes
  *declarations only*. Filenames and import aliases are excluded, and an Astro
  component's compiled default export is anonymous — so querying `Welcome` or
  `Layout` returns nothing even though both exist. Frontmatter and TS
  declarations (`interface Props`, consts, functions) *are* findable, correctly
  source-mapped. Diagnosed upstream and closed as **not a bug**: the plugin
  deliberately ships without synthesizing filename matches, because fabricating
  results the server never returned is the "LSP that lies" failure mode its spec
  forbids. "Where is component X" remains a Grep/Glob job.
- **Diagnostics arrive one tool-call late.** They do not appear on the `Edit`
  result itself but on the *next* tool result, and a stale diagnostic can echo
  once more after a revert before clearing. So "check diagnostics immediately
  after editing" is not reliable guidance, and `AGENTS.md` does not say it.
- **Yarn PnP would break it** (no `node_modules` to resolve from). This repo uses
  npm; noted so a future package-manager switch is not a silent regression.
- `AGENTS.md`'s Code Intelligence section is rewritten to lead with the corrected
  state rather than appending a correction below the stale claim — the bug class
  PR #11's review caught, where a top-down reader hits the wrong thing first.
