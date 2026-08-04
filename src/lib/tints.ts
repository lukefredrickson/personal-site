/**
 * Every tint anything on the site can wear. The four hue members are the
 * palette's own ramp names; `neutral` is the untinted role — the one tint
 * built from two ramps (paper in light, ink in dark), so no hue names it.
 */
export type Tint = 'blue' | 'foam' | 'gold' | 'rose' | 'neutral';

// Presentation-side map, the one place a tag meets a color — the screens' job,
// not the chip's, but one map for all of them (ADR 0013).
const tints: Record<string, Tint> = {
	code: 'blue',
	bikes: 'foam',
};

/** An unmapped tag is fully functional, just neutral (ADR 0013). */
export const tintOf = (tag: string): Tint => tints[tag] ?? 'neutral';
