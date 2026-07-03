# CONTEXT

Ubiquitous language for this project. One clean definition per term. When a
term gets fuzzy or overloaded, sharpen it here (see `/domain-modeling`).

## Domain

**Personal site** — the Astro static site served at `lukefredrickson.dev`.

## Astro

**Static output** — Astro's default build mode: every page is pre-rendered to
plain HTML/CSS/JS at build time. No server runs per request. Output lands in
`./dist`.

**Adapter** — a plugin (`@astrojs/cloudflare`) that lets Astro server-render on
a specific platform. **Not used here** — a pure static site needs no adapter.

**Island** — an interactive component (React/Vue/etc.) hydrated on an otherwise
static page. Not used yet; noted because it's core Astro vocabulary.

## Cloudflare

**Zone** — a domain managed by Cloudflare (DNS + settings). This project has
two: `lukefredrickson.dev` (canonical) and `lukefredrickson.com` (redirects in).

**Worker** — a script deployed to Cloudflare's edge. Here it does nothing but
serve static assets; the name is `personal-site`.

**Static assets** — files (`./dist`) uploaded with a Worker and served directly
from the edge without running code. The whole site is these.

**Binding** — a named connection from Worker code to a Cloudflare resource (KV,
D1, R2, secret). **None here** — a static site has no bindings.

**Custom domain** — a Worker route attached to a real domain (`lukefredrickson.dev`),
so visitors reach the Worker at that hostname. Cloudflare manages the DNS record.

**Workers Builds** — Cloudflare's built-in CI/CD. Watches the GitHub repo,
builds on push to `main`, deploys. Also builds non-production branches to
preview URLs.

**Preview URL** — a stable per-branch URL (`<branch>-personal-site.<account>.workers.dev`)
that Workers Builds deploys each PR branch to, and posts as a PR comment.

**Redirect Rule** — a zone-level rule that 301-redirects at the edge before any
Worker runs. Used to send `www.dev`, `.com`, `www.com` → `lukefredrickson.dev`.

**`_atproto` TXT** — DNS record on `.dev` that verifies the Bluesky handle.
Preserved through all DNS changes.
