# 2. CI/CD via Cloudflare Workers Builds

Date: 2026-07-03
Status: Accepted

## Context

The site should build and deploy automatically when a PR merges to `main`, with
a way to preview changes before merging.

## Decision

Use **Cloudflare Workers Builds** — Cloudflare's native Git integration.
Connect the GitHub repo in the dashboard; pushes to `main` build
(`npx astro build`) and deploy (`npx wrangler deploy`). Enable non-production
branch builds so each PR branch deploys to a stable preview URL, posted as a PR
comment.

## Alternatives considered

- **GitHub Actions + wrangler** — a workflow storing a `CLOUDFLARE_API_TOKEN`
  secret and running `wrangler deploy`. More control (custom gates before
  deploy) but more setup and secret management. Rejected: no need for custom
  gates yet, and it duplicates what Workers Builds gives for free.

## Consequences

- Near-zero config; no API tokens stored in GitHub.
- Free per-PR preview deploys with stable URLs.
- Connecting the repo is a one-time dashboard/OAuth action (human-only).
- If custom pre-deploy gates (tests must pass, etc.) become necessary later,
  revisit GitHub Actions.
