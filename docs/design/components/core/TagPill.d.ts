/** Small mono tag chip used on posts and cards. */
export interface TagPillProps {
  /** Topic tint: code (blue/pine), bikes (foam green), life (= code — merged), video (rose), neutral (sand). */
  topic?: 'code' | 'bikes' | 'life' | 'video' | 'neutral';
  /** Gold-tint outlined variant, used only for the "latest" badge. */
  outlined?: boolean;
  children: React.ReactNode;
}
