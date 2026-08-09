/* The mark, outlined from the mark source (ADR 0036). Every brand asset
   draws its letterforms here; nothing is lifted from a shipped asset. */

import { fileURLToPath } from 'node:url';
import { openSync } from 'fontkit';

const MARK_SOURCE = fileURLToPath(
  new URL('./FiraCode-VariableFont_wght.ttf', import.meta.url),
);

const SOURCE = openSync(MARK_SOURCE);
const EM = SOURCE.unitsPerEm;
const instances = new Map();

/* The mark instantiates the maximum of the variable `wght` axis. */
const MARK_WEIGHT = 700;

/* The offsets are hand-tuned, not the font's 1200-unit advance. */
const MARK_GLYPHS = [
  { char: 'l', fillClass: 'ltr', offsetX: 0 },
  { char: 'f', fillClass: 'ltr', offsetX: 1020 },
  { char: '.', fillClass: 'dot', offsetX: 1600 },
];

/**
 * Outlines the mark in font units, with the y axis pointing up.
 * Returns one path per fill class and the ink box around all of them.
 */
export function outlineMark() {
  const font = instance(MARK_WEIGHT);
  const paths = new Map();
  let ink = null;

  for (const { char, fillClass, offsetX } of MARK_GLYPHS) {
    const glyph = font.layout(char).glyphs[0];
    const path = glyph.path.translate(offsetX, 0);
    paths.set(fillClass, (paths.get(fillClass) ?? '') + path.toSVG());
    ink = ink ? union(ink, path.bbox) : box(path.bbox);
  }

  return {
    outlines: [...paths].map(([fillClass, d]) => ({ fillClass, d })),
    ink,
  };
}

/**
 * Fits the ink box into a square canvas, centered, with the inset clear on
 * the tight axis. Returns the SVG matrix that also flips the y axis.
 */
export function fitMark(ink, { size, inset }) {
  const scale = round(
    (size - 2 * inset) / Math.max(ink.maxX - ink.minX, ink.maxY - ink.minY),
    6,
  );
  const x = round((size - (ink.minX + ink.maxX) * scale) / 2, 3);
  const y = round((size + (ink.minY + ink.maxY) * scale) / 2, 3);
  return `matrix(${scale},0,0,${-scale},${x},${y})`;
}

/**
 * Outlines a run in font units, with the y axis pointing up. The pen steps
 * by `advanceEm`, not by the font's own advance. `start` counts the pen
 * steps that precede the run.
 */
export function outlineRun(text, { weight, advanceEm, start = 0 }) {
  const font = instance(weight);
  const advance = advanceEm * EM;

  return [...text]
    .map((char, index) =>
      font
        .layout(char)
        .glyphs[0].path.translate((start + index) * advance, 0)
        .toSVG(),
    )
    .join('');
}

/**
 * Sets a run at the given size, with its pen origin on the baseline.
 * Returns the SVG matrix that also flips the y axis.
 */
export function fitRun({ x, baseline, size }) {
  const scale = round(size / EM, 6);
  return `matrix(${scale},0,0,${-scale},${x},${baseline})`;
}

function instance(weight) {
  if (!instances.has(weight)) {
    instances.set(weight, SOURCE.getVariation({ wght: weight }));
  }
  return instances.get(weight);
}

function box({ minX, minY, maxX, maxY }) {
  return { minX, minY, maxX, maxY };
}

function union(a, b) {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

function round(value, places) {
  return Number(value.toFixed(places));
}
