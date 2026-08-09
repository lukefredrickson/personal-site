# The run-log grammar

The console is an append-only log. Every entry is one of three levels,
and blank lines appear at exactly three sites. The renderer's specs in
`src/render.test.ts` enforce this grammar; `src/render.ts` implements
it. Decision record: ADR 0040.

## The three levels

| Level | Shape | Reserved for |
| --- | --- | --- |
| 1 | Heavy banner (`━━━` bars around a bold title) | Run phases: `PLAN`, `EXECUTE`, `RUN SUMMARY` |
| 2 | Thin rule (`── title ──…`) | Stack lifecycle: stack start, stack finish |
| 3 | Plain tagged line (`[S1·#138] …`) | Everything else: step start, restack progress, skips, warnings |

Each shape has a single meaning. A rule always means a stack boundary;
a step start is a plain line, never a rule.

## The three blank-line sites

1. Before every level-1 banner.
2. Before every level-2 rule.
3. Between consecutive lines that belong to different stacks — the
   **stack-switch gap**, which marks each stack's lane through
   interleaved concurrent output.

No other blank lines. Messages carry no leading or trailing newlines;
the sink inserts every gap.

## Mechanics

`grammarGap` in `src/render.ts` is the pure decision: given the last
entry's stack lane and blankness, it decides the gap before the next
entry and advances the state. The console sink threads every print
through it, so the grammar holds whatever module printed last. Rules:

- A gap precedes every banner and rule, unless the previous line was
  already blank.
- A plain line gets a gap only when its stack differs from the lane of
  the previous entry. Untagged lines keep the current lane.
- A banner resets the lane, so the first line after it never gaps.

Output stays real-time: lines print in true order, timestamps stay
monotonic, and nothing is buffered or reordered.

## Step-outcome markers

| Marker | Meaning |
| --- | --- |
| `✓` | Built, or already complete |
| `○` | No-op skip: no changes to make, spliced out of the chain |
| `↺` | Stale branch deleted and rebuilt |
| `–` | Not built: its dependency was pruned |
| `✗` | Pruned — a real failure |
| `⚠` | Warning that needs operator action |

`✗` is reserved for real failures. A no-op (`○`) fails nothing: the
stack still summarizes as `✓`, and the plan is still deleted on a clean
run.
