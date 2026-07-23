/** Chunky outlined card with hard offset shadow. */
export interface CardProps {
  /** Shadow flavor: default ink-tinted 3px; photo 2px; featured/video are legacy aliases of the standard shadow (colored shadows retired); or none. */
  shadow?: 'default' | 'featured' | 'video' | 'photo' | 'none';
  /** Quiet cards drop to the soft border and no shadow (prev/next, secondary content). */
  quiet?: boolean;
  /** Optional header row content, rendered on the raised strip behind a full-width rule. */
  header?: React.ReactNode;
  /** Corner radius; defaults to --radius-card (16px). */
  radius?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

/** 44px monogram/logo tile used inside card headers. */
export interface LogoTileProps {
  children: React.ReactNode;
  /** Background tint token. */
  tint?: string;
  /** Monogram color. */
  color?: string;
  size?: number;
}
