// The structured console renderer: timestamps, stack tags, role colors,
// phase rules, banners (ADR 0032). The console is an append-only log,
// not a live TUI; every line is self-sufficient. Line shape is a pure
// function of (clock, message, tag, role, style); the console sink at
// the bottom is the only impure part.

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

// The rotating per-stack hues, disjoint from the role palette so a
// tag's color never reads as a verdict (ADR 0032).
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
 * the dimmed timestamp and, when tagged, the hue-colored tag; the role
 * colors the message text. Blank lines pass through blank.
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

// One width for every rule, so phase boundaries scan as a column. A
// long title wins over the width: the fill disappears, never the title.
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

/**
 * A heavy three-line heading for the run's major sections (plan, run
 * summary): full-width `━` bars around a bold title. Louder than a
 * phase rule, quieter than the run-start banner — a scrollback landmark
 * that stays obviously text.
 */
export function renderHeading(
  now: Date,
  title: string,
  opts: { readonly style?: Style } = {},
): string {
  const style = opts.style ?? plainStyle;
  const stamp = style("dim", formatClock(now));
  const bar = `${stamp} ${style("dim", "━".repeat(RULE_WIDTH))}`;
  return `${bar}\n${stamp} ${style("bold", title)}\n${bar}`;
}

// ---------------------------------------------------------------------------
// The banner: hand-picked block lettering for run start only
// ---------------------------------------------------------------------------

// A literal constant: a lettering dependency buys nothing for one
// fixed string (ADR 0032). Rows carry no trailing whitespace.
export const RUN_START_BANNER: readonly string[] = [
  "  █████████    █████████   ██████   █████ ██████████     █████████    █████████    █████████  ███████████ █████       ██████████",
  " ███░░░░░███  ███░░░░░███ ░░██████ ░░███ ░░███░░░░███   ███░░░░░███  ███░░░░░███  ███░░░░░███░█░░░███░░░█░░███       ░░███░░░░░█",
  "░███    ░░░  ░███    ░███  ░███░███ ░███  ░███   ░░███ ███     ░░░  ░███    ░███ ░███    ░░░ ░   ░███  ░  ░███        ░███  █ ░",
  "░░█████████  ░███████████  ░███░░███░███  ░███    ░███░███          ░███████████ ░░█████████     ░███     ░███        ░██████",
  " ░░░░░░░░███ ░███░░░░░███  ░███ ░░██████  ░███    ░███░███          ░███░░░░░███  ░░░░░░░░███    ░███     ░███        ░███░░█",
  " ███    ░███ ░███    ░███  ░███  ░░█████  ░███    ███ ░░███     ███ ░███    ░███  ███    ░███    ░███     ░███      █ ░███ ░   █",
  "░░█████████  █████   █████ █████  ░░█████ ██████████   ░░█████████  █████   █████░░█████████     █████    ███████████ ██████████",
  " ░░░░░░░░░  ░░░░░   ░░░░░ ░░░░░    ░░░░░ ░░░░░░░░░░     ░░░░░░░░░  ░░░░░   ░░░░░  ░░░░░░░░░     ░░░░░    ░░░░░░░░░░░ ░░░░░░░░░░",
];


// ---------------------------------------------------------------------------
// The console sink: the only impure part
// ---------------------------------------------------------------------------

// Binding the target stream into the styler makes color a per-stream
// decision; styleText's own validation honors NO_COLOR/FORCE_COLOR.
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

/** Print a heavy section heading to stdout. */
export function sayHeading(title: string): void {
  console.log(
    renderHeading(new Date(), title, { style: styleFor(process.stdout) }),
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
