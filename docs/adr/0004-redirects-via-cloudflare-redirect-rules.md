# 4. Redirects via Cloudflare Redirect Rules

Date: 2026-07-03
Status: Accepted

## Context

Three hostnames must 301 to `https://lukefredrickson.dev` (see ADR 0003):
`www.lukefredrickson.dev`, `lukefredrickson.com`, `www.lukefredrickson.com`.

## Decision

Implement the redirects as **Cloudflare Redirect Rules** (Single Redirects),
zone-level, preserving path and query:

- `.dev` zone: one rule, `www` → apex.
- `.com` zone: one rule, any hostname → `https://lukefredrickson.dev`.

Each redirect source needs a **proxied** DNS record so traffic reaches
Cloudflare's edge, where the rule fires. Placeholder proxied records are added
for the three hostnames; they never serve content, they just let the edge catch
and redirect.

## Alternatives considered

- **Worker code does the redirect** — attach the hostnames to the Worker and
  `301` in code. Rejected: runs Worker for pure redirects; edge rules are
  cheaper and need no code.
- **Astro `_redirects` file / configured redirects** — these handle in-site
  path redirects, not cross-hostname/apex canonicalization. Wrong layer.

## Consequences

- No Worker code for redirects; rules live in Cloudflare, not the repo.
- Rules are account state, not version-controlled — documented here instead.
