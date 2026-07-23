import * as React from 'react';

/**
 * Lucide icon sized and stroked to match the brand's 1.5px line weight.
 * Requires the Lucide UMD script (https://unpkg.com/lucide@latest) on the page.
 */
export interface IconProps {
  /** Lucide icon name, kebab-case — e.g. "bike", "arrow-right", "moon". See https://lucide.dev/icons/ */
  name: string;
  /** Square size in px. @default 16 */
  size?: number;
  /** SVG stroke width. Keep at 1.5 to match card borders. @default 1.5 */
  strokeWidth?: number;
  /** Icon color. @default 'currentColor' */
  color?: string;
  style?: React.CSSProperties;
}

export declare function Icon(props: IconProps): JSX.Element;
