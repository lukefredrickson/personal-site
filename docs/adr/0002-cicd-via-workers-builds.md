# 2. CI/CD via Cloudflare Workers Builds

Date: 2026-07-03
Status: Accepted

## Context

The site should build and deploy automatically when a PR merges to `main`, with
a way to preview changes before merging.

## Decision

Use **Cloudflare Workers Builds** — Cloudflare's native Git integration.
Connect the GitHub repo in the dashboard; pushes to `main` build
(`npx astro build`) and deploy. Enable non-production branch builds so each PR
branch produces a preview URL, posted as a PR comment.

Two distinct deploy commands (both configured in the dashboard, not in git):

- **Deploy command** (production / `main`): `npx wrangler deploy` — promotes the
  build to the live production deployment.
- **Non-production branch deploy command** (PR branches): `npx wrangler versions
  upload` — uploads a version and mints a preview URL **without touching
  production**. This is the Cloudflare default; it must not be overridden to
  `wrangler deploy`, or every PR branch would deploy straight to production.

`preview_urls: true` in `wrangler.jsonc` ensures uploaded versions get a public
preview URL.

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
