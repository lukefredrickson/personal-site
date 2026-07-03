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

## Implementation notes

The rules and settings below are **account state**, not in git. This section is
the source of truth for recreating them if a zone is ever rebuilt.

### Redirect Rules

Created in the **Cloudflare dashboard** (Rules → Redirect Rules), not via API:
the `cloudflare-api` MCP token is scoped to DNS + Workers only and cannot write
Rulesets/Page Rules (`10000` / `9109`).

Both rules are dynamic redirects, status **301**, preserve query string, target
expression:

```
concat("https://lukefredrickson.dev", http.request.uri.path)
```

- `.dev` zone — when `http.host eq "www.lukefredrickson.dev"`
- `.com` zone — when `http.host eq "lukefredrickson.com" or http.host eq "www.lukefredrickson.com"`

### Placeholder DNS

Redirect sources use a proxied `AAAA <host> -> 100::` record (IPv6 discard) so
requests reach the edge, where the rule fires before any origin fetch:
`www.lukefredrickson.dev`, `lukefredrickson.com`, `www.lukefredrickson.com`.

The `.dev` apex is the Worker custom domain (its own managed `AAAA 100::`
record); the `_atproto` TXT is preserved.

### HTTP → HTTPS

**Always Use HTTPS** is enabled per zone so http requests 301 to https (covers
non-browser clients; `.dev` is also HSTS-preloaded, forcing https in browsers).
