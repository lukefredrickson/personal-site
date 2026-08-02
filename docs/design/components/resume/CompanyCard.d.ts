/** Company career card; children are RoleEntry elements (newest first). */
export interface CompanyCardProps {
  /** 1–2 letter monogram, used until a real logo is supplied. */
  logoText?: string;
  logoTint?: string;
  logoColor?: string;
  /** Real logo image; replaces the monogram. */
  logoSrc?: string;
  name: string;
  /** e.g. "2022–now · 4 yrs" or "summer 2021" — ranges use – (en-dash). */
  dates: string;
  children: React.ReactNode;
}
