# 32. Sandcastle run-output conventions: sequential log, stamps, tags

Date: 2026-08-07
Status: Accepted

Implements the renderer ticket
[#153](https://github.com/lukefredrickson/personal-site/issues/153) of
spec [#151](https://github.com/lukefredrickson/personal-site/issues/151).
Builds on the child-output capture of #152.

## Context

A Sandcastle run interleaves up to four concurrent stacks on one console
stream. With #152 the raw child noise is captured, but the factory's own
lines still carried no timestamps, no per-line attribution, ad-hoc ANSI
escapes, and easy-to-miss phase boundaries. The output needed conventions
— and a single module owning them.

## Decision

**A structured sequential log, not a live TUI.** Output stays
append-only; every line is made self-sufficient instead of repainted. A
repainting dashboard was rejected: it dies in scrollback (where most
reading happens) and needs a second renderer for non-TTY output anyway.

The conventions, implemented as pure formatting functions in
`.sandcastle/src/render.ts` with a thin console sink:

- **Wall-clock `HH:MM:SS` on every content line.** Wall-clock, not
  run-relative, because runs are correlated against the per-run log
  files and GitHub timestamps. Blank spacer lines stay blank.
- **A `[S2·#139]` stack/issue tag on walk-attributable lines** (`[S2]`
  when the line is stack-level, untagged when run-level), colored by a
  rotating per-stack hue keyed on stack index mod palette length. The
  hue palette is disjoint from the role palette so a tag's color never
  reads as a verdict.
- **Fixed role colors via Node's built-in `util.styleText`** — green
  success, red prune/fail, yellow warn, dim child-process summaries; no
  new dependency. styleText's stream validation owns the
  TTY/`NO_COLOR`/`FORCE_COLOR` matrix (stderr lines validate against
  stderr), so piped output is identical in content with the escapes
  simply absent. The one pre-existing ad-hoc escape (`printPlan`'s
  manual bold) is replaced.
- **Box-drawn `─` rules at phase boundaries** — approve, execute,
  per-step build headers, per-wave restacks, per-stack completion — and
  **block-letter banners for exactly three moments**: run start,
  planning, and the run summary. The lettering is checked-in literal
  constants (owner-picked, no figlet-style dependency at runtime);
  keeping banners rare keeps them meaningful as scrollback landmarks.

Formatting is specced in `render.test.ts` with an injected clock and
exact-string assertions against the default pass-through styler, per the
ADR 0028/0029 stance; the console sink (real clock, real streams) is
production-adapter residue, reviewable by eye.

## Consequences

- Interleaved concurrent output is attributable at a glance, and
  scrollback reading (how long a step took, where a phase began) needs
  no tooling.
- Every module's console lines route through `say`/`sayError`/
  `phaseRule`; a bare `console.log` in factory code is now a smell.
- `WalkEffects` is untouched — attribution is threaded as data (a tag)
  through existing call paths, not as a new seam.
- The tag hue repeats past five concurrent stacks, accepted as better
  than no color at plausible backlog sizes.
