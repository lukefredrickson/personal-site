import { describe, expect, it } from "vitest";
import {
  formatClock,
  formatTag,
  renderHeading,
  renderLine,
  renderRule,
  RUN_START_BANNER,
  STACK_PALETTE,
  stackHue,
  type Style,
} from "./render.ts";

// Tier-2 specs for the renderer's pure formatting functions: injected
// clock, exact-string assertions (ADR 0028/0029 stance). The default
// `plainStyle` styler applies no escapes, so every expectation here is
// byte-stable regardless of the environment's TTY/NO_COLOR state; the
// console sink (real clock, real streams) stays unspecced like the
// other production adapters.

const at = (h: number, m: number, s: number): Date =>
  new Date(2026, 7, 7, h, m, s);

// A marker styler: wraps each styled span so specs can pin exactly which
// format landed on which span without parsing ANSI escapes.
const marked: Style = (format, text) => `«${String(format)}»${text}«/»`;

describe("formatClock", () => {
  it("renders wall-clock HH:MM:SS with zero padding", () => {
    expect(formatClock(at(9, 5, 3))).toBe("09:05:03");
    expect(formatClock(at(23, 59, 59))).toBe("23:59:59");
    expect(formatClock(at(0, 0, 0))).toBe("00:00:00");
  });
});

describe("formatTag", () => {
  it("renders a stack/issue tag", () => {
    expect(formatTag({ stack: 2, issue: 139 })).toBe("[S2·#139]");
  });

  it("renders a stack-only tag when the line is not about one step", () => {
    expect(formatTag({ stack: 2 })).toBe("[S2]");
  });
});

describe("stackHue", () => {
  it("rotates through the palette by stack index", () => {
    expect(stackHue(1)).toBe(STACK_PALETTE[0]);
    expect(stackHue(2)).toBe(STACK_PALETTE[1]);
    expect(stackHue(STACK_PALETTE.length)).toBe(
      STACK_PALETTE[STACK_PALETTE.length - 1],
    );
  });

  it("wraps past the palette so every stack index has a hue", () => {
    expect(stackHue(1 + STACK_PALETTE.length)).toBe(stackHue(1));
    expect(stackHue(2 + 2 * STACK_PALETTE.length)).toBe(stackHue(2));
  });
});

describe("renderLine", () => {
  it("stamps an untagged run-level line", () => {
    expect(renderLine(at(14, 3, 9), "Nothing needed changing.")).toBe(
      "14:03:09 Nothing needed changing.",
    );
  });

  it("puts the tag between the stamp and the message", () => {
    expect(
      renderLine(at(14, 3, 9), "✓ #139 built", {
        tag: { stack: 2, issue: 139 },
      }),
    ).toBe("14:03:09 [S2·#139] ✓ #139 built");
  });

  it("stamps every non-blank line of a multi-line message", () => {
    expect(
      renderLine(at(14, 3, 9), "\nfirst\nsecond", { tag: { stack: 1 } }),
    ).toBe("\n14:03:09 [S1] first\n14:03:09 [S1] second");
  });

  it("leaves blank spacer lines blank rather than stamping emptiness", () => {
    expect(renderLine(at(14, 3, 9), "")).toBe("");
  });

  it("colors the message by role, the stamp dim, and the tag by stack hue", () => {
    expect(
      renderLine(at(14, 3, 9), "✓ done", {
        tag: { stack: 2, issue: 139 },
        role: "success",
        style: marked,
      }),
    ).toBe(
      `«dim»14:03:09«/» «${String(stackHue(2))}»[S2·#139]«/» «green»✓ done«/»`,
    );
  });

  it("applies no format to a plain-role message", () => {
    expect(renderLine(at(14, 3, 9), "hello", { style: marked })).toBe(
      "«dim»14:03:09«/» hello",
    );
  });
});

describe("renderRule", () => {
  it("draws a fixed-width box rule around the title", () => {
    // 3 ("── ") + 4 ("plan") + 1 = 8; fill pads the rule to 72 columns.
    expect(renderRule(at(14, 3, 9), "plan")).toBe(
      `14:03:09 ── plan ${"─".repeat(64)}`,
    );
  });

  it("includes the tag inside the rule and shortens the fill for it", () => {
    expect(renderRule(at(14, 3, 9), "restack", { tag: { stack: 3 } })).toBe(
      `14:03:09 ── [S3] restack ${"─".repeat(56)}`,
    );
  });

  it("drops the fill instead of truncating an over-long title", () => {
    const title = "x".repeat(80);
    expect(renderRule(at(14, 3, 9), title)).toBe(`14:03:09 ── ${title} `);
  });
});

describe("renderHeading", () => {
  it("frames a bold title in full-width heavy bars, every line stamped", () => {
    const bar = `14:03:09 ${"━".repeat(72)}`;
    expect(renderHeading(at(14, 3, 9), "RUN SUMMARY")).toBe(
      `${bar}\n14:03:09 RUN SUMMARY\n${bar}`,
    );
  });

  it("dims the bars and bolds the title", () => {
    const bar = `«dim»14:03:09«/» «dim»${"━".repeat(72)}«/»`;
    expect(renderHeading(at(14, 3, 9), "PLAN", { style: marked })).toBe(
      `${bar}\n«dim»14:03:09«/» «bold»PLAN«/»\n${bar}`,
    );
  });
});

describe("the run-start banner", () => {
  // The one banner is literal lettering; this pins its shape — 8 rows,
  // shading characters only, no trailing whitespace (renderLine would
  // stamp a trailing-space row as if it said something).
  it("is 8 tidy rows of block shading", () => {
    expect(RUN_START_BANNER).toHaveLength(8);
    for (const row of RUN_START_BANNER) {
      expect(row).toBe(row.trimEnd());
      expect(row).not.toBe("");
      expect(row).toMatch(/^[█░ ]+$/);
    }
  });
});
