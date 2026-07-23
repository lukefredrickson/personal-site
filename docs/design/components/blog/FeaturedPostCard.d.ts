/** The latest post, promoted on the home page with a large image (position + size carry the "latest" signal — no badge). */
export interface FeaturedPostCardProps {
  title: string;
  excerpt?: string;
  /** "jun 21, 2026" */
  date: string;
  /** "4 min" */
  readTime?: string;
  /** Topic tags, shown after the read time: [{label:'bikes', topic:'bikes'}, {label:'vlog'}] */
  tags?: { label: string; topic?: 'code' | 'bikes' | 'life' | 'video' | 'neutral' }[];
  imageSrc?: string;
  imageTint?: string;
  imagePlaceholder?: string;
  onClick?: () => void;
}
