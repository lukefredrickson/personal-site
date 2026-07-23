/** Prev/next navigation at the bottom of a post. */
export interface PrevNextProps {
  /** Previous post title; omit for the first post. */
  prev?: string;
  /** Next post title; omit for the latest post (renders "that's the latest one!"). */
  next?: string;
  onPrev?: () => void;
  onNext?: () => void;
}
