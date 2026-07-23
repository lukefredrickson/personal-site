/** Top-of-page header with logo, work/blog nav, and theme toggle. */
export interface SiteHeaderProps {
  /** Which nav item gets the accent underline. */
  active?: 'work' | 'blog';
  /** Current theme; decides whether the toggle shows the moon or sun icon. */
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
  /** Called with 'work' | 'blog'; logo navigates to 'work'. */
  onNavigate?: (page: 'work' | 'blog') => void;
}
