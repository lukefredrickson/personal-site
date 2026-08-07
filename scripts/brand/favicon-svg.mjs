import { mark, palette } from './mark.mjs'

const fills = (scheme) =>
	mark.outlines.map(({ name }) => `.${name}{fill:${palette[scheme][name]}}`).join('')

// `fill=""` is inert — the embedded stylesheet paints the outlines — and is
// emitted so a regenerated favicon.svg is byte-identical to the shipped one.
const outline = ({ name, d }) => `<path class="${name}" fill="" d="${d}"/>`

/**
 * favicon.svg — the one theme-reactive brand asset. Its contrast partner is the
 * browser tab strip, which follows the OS scheme rather than the site's theme
 * toggle, so the light/dark swap ships as an embedded media query (PRD #135).
 */
export function faviconSvg() {
	const { size, label, transform, outlines } = mark

	return [
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${label}">`,
		`<title>${label}</title>`,
		`<style>${fills('light')}@media(prefers-color-scheme:dark){${fills('dark')}}</style>`,
		`<g transform="${transform}">${outlines.map(outline).join('')}</g>`,
		'</svg>',
	].join('\n')
}
