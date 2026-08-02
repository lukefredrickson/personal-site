/** Framed media card with optional mono caption strip. */
export interface FramedFigureProps {
  /** Media height in px (240 for post heros, ~130 for photo pairs). */
  height?: number;
  /** Mono caption below the media; omit to hide the strip. */
  caption?: string;
  /** Placeholder tint while no src. */
  tint?: string;
  /** Real image URL; renders object-fit: cover. */
  src?: string;
  alt?: string;
  /** Placeholder label when no src. */
  placeholder?: string;
  style?: React.CSSProperties;
}
