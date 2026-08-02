/** Every tint a chip can wear. `video` is for in-prose video cards, not tags. */
export type Topic = 'code' | 'bikes' | 'video' | 'neutral';

/** The tints a tag can map to — what both a chip and a filter pill can wear. */
export type TagTopic = Extract<Topic, 'code' | 'bikes' | 'neutral'>;

// Presentation-side map, the one place a tag meets a color — the screens' job,
// not the chip's, but one map for all of them (ADR 0013).
const topics: Record<string, TagTopic> = {
	code: 'code',
	bikes: 'bikes',
};

/** An unmapped tag is fully functional, just neutral (ADR 0013). */
export const topicOf = (tag: string): TagTopic => topics[tag] ?? 'neutral';
