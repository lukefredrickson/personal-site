# 1. Deploy to Cloudflare Workers (static assets)

Date: 2026-07-03
Status: Accepted

## Context

The site is a static Astro build. It needs a host. The account is already on
Cloudflare, so Cloudflare is the natural platform.

## Decision

Deploy as **Cloudflare Workers static assets** — a Worker (`personal-site`)
that serves `./dist` directly from the edge. No `@astrojs/cloudflare` adapter,
because the site is pure static (an adapter is only needed for on-demand
server rendering).

## Alternatives considered

- **Cloudflare Pages** — the older product. Works for static sites, but
  Cloudflare now steers new projects to Workers, and the Astro adapter has
  dropped Pages support. Rejected: legacy path.
- **GitHub Pages** — the current host of `lukefredrickson.dev`. Being replaced
  to consolidate on Cloudflare and unlock the upgrade path below.

## Consequences

- Same static hosting as Pages, but a clean upgrade path: server routes / APIs
  can be added later on the same Worker without changing platforms (would then
  need the adapter).
- No bindings today (static site) → the Workers "no separate prod/preview
  bindings" limitation does not apply.
