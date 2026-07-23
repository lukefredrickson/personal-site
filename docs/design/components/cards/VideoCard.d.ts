/** YouTube vlog embed card — the only place --video appears. */
export interface VideoCardProps {
  title: string;
  /** "14:32" */
  duration?: string;
  /** YouTube URL. */
  href?: string;
  /** Video thumbnail image. */
  thumbSrc?: string;
}
