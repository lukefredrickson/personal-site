/** One row in a post list (home "Writing" or /blog index). */
export interface PostListItemProps {
  title: string;
  /** "jun 14" on the index, "jun 2026" on home. */
  date: string;
  /** Include for current-year index posts; omit on home rows and older archive rows. */
  excerpt?: string;
  /** Topic pills, e.g. [{label:'bikes', topic:'bikes'}, {label:'vlog', topic:'neutral'}]. */
  tags?: { label: string; topic?: 'code' | 'bikes' | 'life' | 'neutral' }[];
  /** "6 min" — plain mono, no pill. */
  readTime?: string;
  /** false on the last row of a group. */
  divider?: boolean;
  onClick?: () => void;
}
