/** Dark code card (dark in BOTH themes). */
export interface CodeBlockProps {
  /** Filename shown in the top bar with a "copy" affordance. */
  filename?: string;
  /** Plain code string, or pass pre-highlighted spans as children. */
  code?: string;
  /** Syntax-colored spans: --code-selector (iris), --code-property (blue), --code-value (foam green), --code-function (blue, one step lighter), --code-custom (gold). */
  children?: React.ReactNode;
}
