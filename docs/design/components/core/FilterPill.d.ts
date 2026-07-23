/** Topic filter pill (blog index). */
export interface FilterPillProps {
  /** Filled when active (ink in light, iris in dark) and mono weight 500. */
  active?: boolean;
  /** Inactive pills stay quiet (soft border) with a small dot in the topic color. */
  topic?: 'code' | 'bikes' | 'life' | 'neutral';
  label: string;
  /** Post count shown after a middot. */
  count?: number;
  onClick?: () => void;
}
