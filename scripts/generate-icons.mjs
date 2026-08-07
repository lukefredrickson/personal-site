// Brand-asset generator: committed vector source (scripts/brand/) -> public/.
// Every brand asset the site ships is written from here; nothing in public/ is
// hand-maintained. Output is deterministic, so a run on unchanged source leaves
// a clean `git diff` (ADR 0032).
//
//   npm run generate:icons

import { writeFile } from 'node:fs/promises'
import { faviconSvg } from './brand/favicon-svg.mjs'

const publicDir = new URL('../public/', import.meta.url)

const assets = {
	'favicon.svg': faviconSvg(),
}

for (const [name, contents] of Object.entries(assets)) {
	await writeFile(new URL(name, publicDir), contents)
	console.log(`wrote public/${name}`)
}
