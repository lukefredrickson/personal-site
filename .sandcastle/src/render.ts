// Structured sequential rendering for the factory's console
//
// The run's console is an append-only log, deliberately not a live TUI:
// concurrent stacks interleave on one stream, and a repainting dashboard
// dies in scrollback and needs a second renderer for non-TTY output. So
// every line is made self-sufficient instead — a wall-clock HH:MM:SS
// stamp (wall-clock, not run-relative, because runs are read against
// log files and GitHub timestamps), and a `[S2·#139]` stack/issue tag
// on any line attributable to a walk, colored with a per-stack hue so
// interleaved output reads at a glance. Phase boundaries get box-drawn
// rules; the two biggest moments — run start and run summary — get
// hand-rolled block-letter banners, and nothing else does.
//
// Everything that decides what a line looks like is a pure function of
// (clock, message, tag, role, style), specced with exact strings and an
// injected clock. The console sink at the bottom is the only impure
// part: it supplies `new Date()` and a styler bound to the real stream.
// Color goes through Node's built-in `util.styleText` with the target
// stream passed in, so the TTY/NO_COLOR/FORCE_COLOR matrix is the
// platform's problem — piped output carries identical text with the
// escapes simply absent, which is also why specs default to `plainStyle`
// and stay byte-stable.

import { styleText } from "node:util";

/** What `util.styleText` accepts as a format: one name or a list. */
export type TextFormat = Parameters<typeof styleText>[0];

/**
 * A styler: apply a format to a span of text. The pure renderers take
 * one as a parameter so specs can pass `plainStyle` (or a marker fake)
 * and assert exact strings; the sink binds `styleText` to a real stream.
 */
export type Style = (format: TextFormat, text: string) => string;

export const plainStyle: Style = (_format, text) => text;

/**
 * Attribution for a walk line: which stack (1-based, as shown to the
 * operator), and — when the line is about one step — which issue.
 */
export interface StackTag {
  readonly stack: number;
  readonly issue?: number;
}

/**
 * The fixed role palette. Roles color whole message texts; they are
 * semantic ("this is a failure"), not decorative, so the mapping to
 * ANSI colors lives here once and call sites never name a color.
 */
export type Role = "plain" | "success" | "fail" | "warn" | "dim" | "bold";

const ROLE_FORMAT: Partial<Record<Role, TextFormat>> = {
  success: "green",
  fail: "red",
  warn: "yellow",
  dim: "dim",
  bold: "bold",
};

// The rotating per-stack hues. Deliberately disjoint from the role
// palette above (no green/red/yellow), so a tag's color never reads as
// a verdict. Keyed by stack number mod length: a run with more stacks
// than hues repeats colors, which is still better than none.
export const STACK_PALETTE = [
  "cyan",
  "magenta",
  "blue",
  "cyanBright",
  "magentaBright",
] as const;

export function stackHue(stack: number): TextFormat {
  const n = STACK_PALETTE.length;
  return STACK_PALETTE[(((stack - 1) % n) + n) % n]!;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Wall-clock `HH:MM:SS`, local time. */
export function formatClock(now: Date): string {
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
}

/** `[S2·#139]` for a step line, `[S2]` for a stack-level line. */
export function formatTag(tag: StackTag): string {
  return tag.issue === undefined
    ? `[S${tag.stack}]`
    : `[S${tag.stack}·#${tag.issue}]`;
}

export interface LineOpts {
  readonly tag?: StackTag;
  readonly role?: Role;
  readonly style?: Style;
}

/**
 * Render one message as console-ready text: every non-blank line gets
 * the timestamp (dimmed) and, when tagged, the hue-colored tag; the
 * role colors the message text itself. Blank lines pass through blank —
 * they are spacing, and a bare timestamp on an empty line is noise, so
 * "every line carries a timestamp" means every line that says anything.
 */
export function renderLine(
  now: Date,
  message: string,
  opts: LineOpts = {},
): string {
  const style = opts.style ?? plainStyle;
  const stamp = style("dim", formatClock(now));
  const tagText =
    opts.tag === undefined
      ? ""
      : `${style(stackHue(opts.tag.stack), formatTag(opts.tag))} `;
  const roleFormat = ROLE_FORMAT[opts.role ?? "plain"];
  return message
    .split("\n")
    .map((line) =>
      line === ""
        ? ""
        : `${stamp} ${tagText}${roleFormat === undefined ? line : style(roleFormat, line)}`,
    )
    .join("\n");
}

// One width for every rule, so phase boundaries scan as a column of
// same-length bars whatever their titles are. Long titles win over the
// width — the fill just disappears rather than the title truncating.
const RULE_WIDTH = 72;

/**
 * A box-drawn phase rule: `── [tag] title ────────…` padded with `─` to
 * RULE_WIDTH (timestamp excluded), dashes dimmed, tag hue-colored.
 */
export function renderRule(
  now: Date,
  title: string,
  opts: { readonly tag?: StackTag; readonly style?: Style } = {},
): string {
  const style = opts.style ?? plainStyle;
  const stamp = style("dim", formatClock(now));
  const plainTag = opts.tag === undefined ? "" : `${formatTag(opts.tag)} `;
  const fill = "─".repeat(
    Math.max(0, RULE_WIDTH - "── ".length - plainTag.length - title.length - 1),
  );
  const tagText =
    opts.tag === undefined
      ? ""
      : `${style(stackHue(opts.tag.stack), formatTag(opts.tag))} `;
  return `${stamp} ${style("dim", "──")} ${tagText}${title} ${style("dim", fill)}`;
}

// ---------------------------------------------------------------------------
// Banners: hand-rolled block lettering for exactly two moments
// ---------------------------------------------------------------------------

// A 5-row block font covering only the letters the two banners need.
// Hand-rolled on purpose: a figlet-style dependency buys nothing for two
// fixed strings, and constants are speccable byte-for-byte.
const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  A: [" ███ ", "█   █", "█████", "█   █", "█   █"],
  C: [" ████", "█    ", "█    ", "█    ", " ████"],
  D: ["████ ", "█   █", "█   █", "█   █", "████ "],
  E: ["█████", "█    ", "████ ", "█    ", "█████"],
  L: ["█    ", "█    ", "█    ", "█    ", "█████"],
  M: ["█   █", "██ ██", "█ █ █", "█   █", "█   █"],
  N: ["█   █", "██  █", "█ █ █", "█  ██", "█   █"],
  R: ["████ ", "█   █", "████ ", "█  █ ", "█   █"],
  S: [" ████", "█    ", " ███ ", "    █", "████ "],
  T: ["█████", "  █  ", "  █  ", "  █  ", "  █  "],
  U: ["█   █", "█   █", "█   █", "█   █", " ███ "],
  Y: ["█   █", " █ █ ", "  █  ", "  █  ", "  █  "],
  " ": ["   ", "   ", "   ", "   ", "   "],
};

/** The 5 rows spelling `text` in the block font; rows carry no trailing space. */
export function renderBanner(text: string): readonly string[] {
  const glyphs = [...text].map((ch) => {
    const glyph = GLYPHS[ch];
    if (glyph === undefined) {
      throw new Error(`no banner glyph for ${JSON.stringify(ch)}`);
    }
    return glyph;
  });
  return Array.from({ length: 5 }, (_, row) =>
    glyphs.map((glyph) => glyph[row]!).join("  ").trimEnd(),
  );
}

export const RUN_START_BANNER = renderBanner("SANDCASTLE");
export const RUN_SUMMARY_BANNER = renderBanner("SUMMARY");

// ---------------------------------------------------------------------------
// The console sink: the only impure part
// ---------------------------------------------------------------------------

// Binding the target stream into the styler is what makes color a
// per-stream decision: stdout piped to a file goes plain while stderr
// on the terminal stays red, and NO_COLOR/FORCE_COLOR are honored —
// all inside styleText's own stream validation.
const styleFor =
  (stream: NodeJS.WriteStream): Style =>
  (format, text) =>
    styleText(format, text, { stream });

export interface SayOpts {
  readonly tag?: StackTag;
  readonly role?: Role;
}

/** Print one (possibly multi-line) message to stdout, stamped and tagged. */
export function say(message: string, opts: SayOpts = {}): void {
  console.log(
    renderLine(new Date(), message, { ...opts, style: styleFor(process.stdout) }),
  );
}

/** The stderr twin of `say` — styled against stderr's own color support. */
export function sayError(message: string, opts: SayOpts = {}): void {
  console.error(
    renderLine(new Date(), message, { ...opts, style: styleFor(process.stderr) }),
  );
}

/** Print a phase-boundary rule to stdout. */
export function phaseRule(
  title: string,
  opts: { readonly tag?: StackTag } = {},
): void {
  console.log(
    renderRule(new Date(), title, { ...opts, style: styleFor(process.stdout) }),
  );
}

/** Print a banner's rows to stdout, stamped and bold, blank-line framed. */
export function sayBanner(rows: readonly string[]): void {
  const style = styleFor(process.stdout);
  const now = new Date();
  console.log(
    ["", ...rows, ""]
      .map((row) => renderLine(now, row, { role: "bold", style }))
      .join("\n"),
  );
}

/**
 * Render a line for something that writes to stdout itself (the readline
 * approval prompt) — same stamp and styling, no print.
 */
export function stampPrompt(message: string): string {
  return renderLine(new Date(), message, { style: styleFor(process.stdout) });
}
