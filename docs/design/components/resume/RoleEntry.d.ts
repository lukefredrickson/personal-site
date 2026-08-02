/** A role row inside CompanyCard. */
export interface RoleEntryProps {
  title: string;
  /** "2025–now" — ranges use – (en-dash); omit for single-role cards where the header already carries dates. */
  dates?: string;
  /** Verb-first, quantified. 3–4 for the current role, ~3 one-liners for past roles. */
  bullets?: string[];
  /** Accent timeline dot (gold in light, iris in dark) + colored ▸ markers. Exactly one per page. */
  current?: boolean;
  /** Last role in the card: hides the rail below the dot, drops bottom padding. */
  last?: boolean;
}
