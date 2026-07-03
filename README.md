# personal-site

Personal site for lukefredrickson.dev. Astro static site, deployed to Cloudflare Workers.

## Develop

```sh
npm install
npm run dev      # localhost:4321
npm run build    # -> ./dist
npm run preview
```

## Deploy

Merge to `main` → Cloudflare Workers Builds builds and deploys to lukefredrickson.dev. PRs get preview URLs. See `docs/adr/` for architecture decisions.
