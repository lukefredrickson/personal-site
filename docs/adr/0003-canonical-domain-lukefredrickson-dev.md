# 3. Canonical domain is lukefredrickson.dev

Date: 2026-07-03
Status: Accepted

## Context

Two domains point at this site: `lukefredrickson.dev` and
`lukefredrickson.com`, each with a `www` variant. Serving the same content at
multiple URLs splits SEO and confuses canonical identity.

## Decision

`lukefredrickson.dev` (apex) is the single canonical URL. It alone serves the
Worker. Every other hostname 301-redirects to it:

- `www.lukefredrickson.dev`
- `lukefredrickson.com`
- `www.lukefredrickson.com`

## Alternatives considered

- **`.com` as canonical** — more conventional TLD. Rejected: `.dev` is the
  preferred personal brand and already holds the Bluesky (`_atproto`) identity.
- **Serve both `.dev` and `.com` identically** — no redirect. Rejected:
  duplicate content, two canonical URLs, weaker SEO.

## Consequences

- One canonical URL; `astro.config.mjs` `site` is set to it.
- Redirects add a small edge hop for non-canonical hosts (negligible).
