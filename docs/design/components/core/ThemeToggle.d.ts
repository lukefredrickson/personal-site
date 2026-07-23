/** Light/dark theme switch — pill track with sun/moon icons inside; the ink knob slides to the active side and carries the active icon. */
export interface ThemeToggleProps {
  /** Current theme; knob sits left on 'light', right on 'dark'. */
  theme?: 'light' | 'dark';
  /** Called on click — host flips the theme and re-renders. */
  onToggle?: () => void;
}
