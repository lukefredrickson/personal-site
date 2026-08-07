// Brand-asset generator: committed vector source (scripts/brand/) -> public/.
// Emitters return file contents; this is the only place that writes them, and
// the asset map below is the whole set it claims — the rest of public/ stays
// hand-made until its emitter lands. Output is deterministic, so a run on
// unchanged source leaves a clean `git diff` (ADR 0032).
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
