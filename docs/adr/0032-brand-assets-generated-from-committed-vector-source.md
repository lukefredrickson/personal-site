# 32. Brand assets generated from committed vector source

Date: 2026-08-07
Status: Accepted

Resolves [#141](https://github.com/lukefredrickson/personal-site/issues/141),
the first ticket of the brand-asset generator
[PRD #135](https://github.com/lukefredrickson/personal-site/issues/135).
Extends [15. Asset and icon pipeline](0015-asset-and-icon-pipeline.md), which
decided where images live and how pages render them but left open where the
brand assets themselves come from.

## Context

The six brand assets in `public/` — `favicon.svg`, `favicon.ico`,
`apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `og-default.png` —
shipped from a throwaway worktree; the tooling that produced them was never
committed and is gone. They are the only artifacts in the repo nobody can
rebuild. Nudging a letter or a hex value means redoing six exports by hand and
trusting that they still agree with each other.

The mark is text — `lf.` in Fira Code 700 — but the shipped `favicon.svg`
already carries it as outlined `<path>` data, so recovering a source of truth
needs no font tooling at all.

## Decision

**Committed outlines are the source; `public/` holds build products.**
`scripts/brand/mark.mjs` holds the mark's outlines, its placement transform,
and the palette, as data. Every brand asset derives from it, and hand-editing
one in `public/` only survives until the next run.

**Emitters are pure functions; one entry point writes.** Each output format is
a module exporting source → bytes (`scripts/brand/favicon-svg.mjs` today), and
`scripts/generate-icons.mjs` writes what they return into `public/`. Adding a
format is a new emitter plus a line in the entry's asset map; no emitter
touches the filesystem. The raster formats (#142) and the OG card (#143) land
as emitters against this seam, each bringing its own devDeps.

**Deterministic output, committed to the repo.** No timestamps, no randomness,
no text shaping, no font lookup, no network — same source, same bytes. That
makes `git diff` after a run the verification: clean means the shipped assets
are exactly what the source produces. Today's run reproduces the shipped
`favicon.svg` byte for byte, down to the inert `fill=""` on each path.

**Run by hand, not by the build.** Workers Builds serves `public/` verbatim, so
generation is a deliberate act on a brand change and its result is reviewed in
the PR diff like any other file.

## Alternatives considered

- **Commit `mark.svg` and wrap it at generation time.** Editable in a vector
  tool, but lifting the paths back out needs an XML parser (or a brittle
  regex), and for the SVG output the "source" would be a near-copy of the
  product. Data in, documents out, is the cleaner seam — and editing the mark
  is a design-tool round trip either way.
- **Shape the mark from a Fira Code devDep at generation time.** Closer to the
  true source, since the mark _is_ text, and it is what the PRD reserves for
  the OG wordmark, which has no shipped vector to lift. For the mark it buys
  nothing: a font dependency, plus determinism newly hostage to a shaping
  library's version.
- **Regenerate during `astro build` (or an integration).** Removes the
  possibility of drift, but a generator bug would then reach production as a
  diff nobody reviewed, and every deploy would pay for asset work that changes
  a few times a year.
- **A `--check` mode in CI.** Worth revisiting once the raster emitters land —
  it is the only thing that would catch source edited without a run. Today the
  gap is one command wide and `git diff` closes it.
- **An SVGO or formatter pass in the chain.** Another dependency whose output
  could shift underneath a "deterministic" pipeline. The emitter writes final
  bytes instead.

## Consequences

- A brand change is: edit `scripts/brand/mark.mjs`, run `npm run
  generate:icons`, commit the regenerated assets.
- The five raster assets stay hand-made until #142 and #143 land. Until then
  the generator claims `favicon.svg` only, and the rest of `public/` is
  generated-in-principle but not yet in fact.
- Nothing enforces that `public/` matches the source. Drift between a source
  edit and a run is possible, and only a run reveals it.
- The mark can only be edited as outlines. Re-tracking the letters or changing
  the typeface means returning to the design tool and pasting new path data.
