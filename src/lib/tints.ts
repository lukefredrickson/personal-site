/**
 * Every tint on the site. The four hue members are the palette's ramp names;
 * `neutral` is the untinted role (ADR 0030).
 */
export type Tint = 'blue' | 'foam' | 'gold' | 'rose' | 'neutral';

// The one map from tag to tint, owned by the screens, not the chip (ADR 0013).
const tints: Record<string, Tint> = {
	code: 'blue',
	bikes: 'foam',
};

/** An unmapped tag is fully functional, just neutral (ADR 0013). */
export const tintOf = (tag: string): Tint => tints[tag] ?? 'neutral';
