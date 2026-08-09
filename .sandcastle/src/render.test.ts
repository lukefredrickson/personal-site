import { describe, expect, it } from "vitest";
import {
  formatClock,
  formatTag,
  grammarGap,
  grammarStart,
  renderHeading,
  renderLine,
  renderOmittedUmbrellas,
  renderRule,
  RUN_START_BANNER,
  STACK_PALETTE,
  stackHue,
  type EntryKind,
  type GrammarState,
  type StackTag,
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

describe("renderOmittedUmbrellas", () => {
  it("renders nothing for no omitted umbrellas", () => {
    expect(renderOmittedUmbrellas([])).toEqual([]);
  });

  it("renders a labeled umbrella with its follow-up and no caveat", () => {
    expect(
      renderOmittedUmbrellas([
        {
          issue: { number: 137, title: "Design system umbrella" },
          provenance: "labeled",
        },
      ]),
    ).toEqual([
      "Omitted 1 umbrella issue(s) — scope lands in their children:",
      "  #137 Design system umbrella — not built; close after the children merge.",
    ]);
  });

  it("adds the veto instruction to an inferred umbrella", () => {
    expect(
      renderOmittedUmbrellas([
        {
          issue: { number: 137, title: "Design system umbrella" },
          provenance: "inferred",
        },
      ]),
    ).toEqual([
      "Omitted 1 umbrella issue(s) — scope lands in their children:",
      "  #137 Design system umbrella — not built; close after the children merge.",
      "      inferred by the judgment agent; label it `parent` to confirm, " +
        "or re-plan to override.",
    ]);
  });

  it("lists mixed provenances under one header", () => {
    const lines = renderOmittedUmbrellas([
      { issue: { number: 10, title: "A" }, provenance: "labeled" },
      { issue: { number: 20, title: "B" }, provenance: "inferred" },
    ]);
    expect(lines).toEqual([
      "Omitted 2 umbrella issue(s) — scope lands in their children:",
      "  #10 A — not built; close after the children merge.",
      "  #20 B — not built; close after the children merge.",
      "      inferred by the judgment agent; label it `parent` to confirm, " +
        "or re-plan to override.",
    ]);
  });
});

describe("the blank-line grammar", () => {
  // Feed a transcript through grammarGap the way the sink does, and
  // pin the exact rendered text (docs/log-grammar.md).
  interface Entry {
    readonly kind: EntryKind;
    readonly text: string;
    readonly tag?: StackTag;
    readonly endsBlank?: boolean;
  }
  const feed = (entries: readonly Entry[]): string => {
    let state: GrammarState = grammarStart;
    const now = at(14, 3, 9);
    return entries
      .map((e) => {
        const { gap, next } = grammarGap(state, e.kind, e.tag, e.endsBlank);
        state = next;
        const rendered =
          e.kind === "heading"
            ? renderHeading(now, e.text)
            : e.kind === "rule"
              ? renderRule(now, e.text, { tag: e.tag })
              : renderLine(now, e.text, { tag: e.tag });
        return gap ? `\n${rendered}` : rendered;
      })
      .join("\n");
  };

  it("puts blanks before headings, before rules, and at stack switches only", () => {
    const S1: StackTag = { stack: 1 };
    const S2: StackTag = { stack: 2 };
    const bar = `14:03:09 ${"━".repeat(72)}`;
    expect(
      feed([
        { kind: "heading", text: "EXECUTE" },
        { kind: "line", text: "Running 2 stack(s)." },
        { kind: "rule", text: "Starting stack 1/2", tag: S1 },
        { kind: "line", text: "#7: build it", tag: { ...S1, issue: 7 } },
        { kind: "rule", text: "Starting stack 2/2", tag: S2 },
        { kind: "line", text: "✓ #7 built", tag: { ...S1, issue: 7 } },
        { kind: "line", text: "Restacking wave 1/1", tag: S1 },
        { kind: "heading", text: "RUN SUMMARY" },
        { kind: "line", text: "✓ Stack 1/2", tag: S1 },
      ]),
    ).toBe(
      [
        `${bar}\n14:03:09 EXECUTE\n${bar}`,
        `14:03:09 Running 2 stack(s).`,
        ``,
        `14:03:09 ── [S1] Starting stack 1/2 ${"─".repeat(45)}`,
        `14:03:09 [S1·#7] #7: build it`,
        ``,
        `14:03:09 ── [S2] Starting stack 2/2 ${"─".repeat(45)}`,
        ``,
        `14:03:09 [S1·#7] ✓ #7 built`,
        `14:03:09 [S1] Restacking wave 1/1`,
        ``,
        `${bar}\n14:03:09 RUN SUMMARY\n${bar}`,
        `14:03:09 [S1] ✓ Stack 1/2`,
      ].join("\n"),
    );
  });

  it("keeps the lane across untagged lines instead of gapping around them", () => {
    const start = grammarGap(grammarStart, "line", { stack: 1 });
    const untagged = grammarGap(start.next, "line");
    expect(untagged.gap).toBe(false);
    const sameStack = grammarGap(untagged.next, "line", { stack: 1 });
    expect(sameStack.gap).toBe(false);
    const otherStack = grammarGap(untagged.next, "line", { stack: 2 });
    expect(otherStack.gap).toBe(true);
  });

  it("resets the lane at a heading, so the first summary line has no gap", () => {
    const line = grammarGap(grammarStart, "line", { stack: 3 });
    const heading = grammarGap(line.next, "heading");
    expect(grammarGap(heading.next, "line", { stack: 1 }).gap).toBe(false);
  });

  it("suppresses the gap after a message that ends blank", () => {
    const framed = grammarGap(grammarStart, "line", undefined, true);
    expect(grammarGap(framed.next, "heading").gap).toBe(false);
  });
});

describe("the run-start banner", () => {
  // The one banner is literal lettering; this pins its shape — 5 rows,
  // ASCII line art only, no trailing whitespace (renderLine would
  // stamp a trailing-space row as if it said something).
  it("is 5 tidy rows of ASCII line art", () => {
    expect(RUN_START_BANNER).toHaveLength(5);
    for (const row of RUN_START_BANNER) {
      expect(row).toBe(row.trimEnd());
      expect(row).not.toBe("");
      expect(row).toMatch(/^[_/\\|() ]+$/);
    }
  });
});
