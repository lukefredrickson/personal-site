/** Rounded action button/link. Rendered as <a> when href is given, else <button>. */
export interface ButtonProps {
  /** 'primary' = filled (ink in light, iris in dark), for the one main action (résumé). 'secondary' = surface + soft border, for everything else. */
  variant?: 'primary' | 'secondary';
  /** Render as a link */
  href?: string;
  onClick?: () => void;
  children: React.ReactNode;
  style?: React.CSSProperties;
}
