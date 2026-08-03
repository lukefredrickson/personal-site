import { describe, expect, it } from "vitest";
import {
  planStacks,
  pruneClosure,
  screenMutations,
  waveLevels,
  type Blocker,
  type EdgeMutation,
  type StackIssue,
  type StackStep,
} from "./stack.ts";

// Tier-2 specs: the planning layer's pure graph functions, data in, data
// out — no git fixtures. Assertions target the returned structures and
// stated rejection reasons, never internal traversal order.

function issue(number: number): StackIssue {
  return { number, title: `Issue ${number}` };
}

function graph(edges: Record<number, number[]>): Map<number, Blocker[]> {
  return new Map(
    Object.entries(edges).map(([blocked, blockers]) => [
      Number(blocked),
      blockers.map((number) => ({ number, state: "open" })),
    ]),
  );
}

function mutation(
  op: "add" | "remove",
  blocked: number,
  blocker: number,
): EdgeMutation {
  return { op, blocked, blocker, reasoning: `${op} ${blocked}<-${blocker}` };
}

/** Amended graph as plain blocked → sorted blocker numbers, for equality. */
function edgesOf(
  amended: ReadonlyMap<number, readonly Blocker[]>,
): Record<number, number[]> {
  return Object.fromEntries(
    [...amended].map(([n, blockers]) => [
      n,
      blockers.map((b) => b.number).sort((a, b) => a - b),
    ]),
  );
}

function numbersOf(stack: readonly StackStep[]): number[] {
  return stack.map((step) => step.issue.number);
}

describe("planStacks: topological sort", () => {
  it("orders a chain dependency-first and chains branch onto branch", () => {
    const stacks = planStacks(
      [issue(1), issue(2), issue(3)],
      graph({ 2: [1], 3: [2] }),
    );
    expect(stacks).toEqual([
      [
        {
          issue: issue(1),
          branch: "sandcastle/issue-1",
          base: "main",
          dependsOn: [],
        },
        {
          issue: issue(2),
          branch: "sandcastle/issue-2",
          base: "sandcastle/issue-1",
          dependsOn: [1],
        },
        {
          issue: issue(3),
          branch: "sandcastle/issue-3",
          base: "sandcastle/issue-2",
          dependsOn: [2],
        },
      ],
    ]);
  });

  it("orders a diamond level-major, ascending issue number within a level", () => {
    const stacks = planStacks(
      [issue(1), issue(2), issue(3), issue(4)],
      graph({ 2: [1], 3: [1], 4: [2, 3] }),
    );
    expect(stacks.map(numbersOf)).toEqual([[1, 2, 3, 4]]);
  });

  it("is stable under input permutation: same graph, same stacks", () => {
    // Permute both nondeterminism vectors: the issue array and the
    // blocked-by map's insertion order.
    const edges = graph({ 2: [1], 3: [1], 4: [2, 3], 6: [5] });
    const edgesReversed = graph({ 6: [5], 4: [3, 2], 3: [1], 2: [1] });
    const ordered = [issue(1), issue(2), issue(3), issue(4), issue(5), issue(6)];
    const shuffled = [issue(4), issue(6), issue(1), issue(3), issue(5), issue(2)];
    expect(planStacks(shuffled, edgesReversed)).toEqual(
      planStacks(ordered, edges),
    );
  });

  it("bases every stack on the given trunk", () => {
    const stacks = planStacks([issue(1)], graph({}), "develop");
    expect(stacks[0]![0]!.base).toBe("develop");
  });

  it("returns no stacks for no issues", () => {
    expect(planStacks([], graph({}))).toEqual([]);
  });

  it("treats a closed blocker outside the walk as satisfied", () => {
    const blockedBy = new Map<number, Blocker[]>([
      [1, [{ number: 99, state: "closed" }]],
    ]);
    expect(planStacks([issue(1)], blockedBy).map(numbersOf)).toEqual([[1]]);
  });

  it("rejects an open blocker outside the walk, naming both issues", () => {
    const blockedBy = new Map<number, Blocker[]>([
      [1, [{ number: 99, state: "open" }]],
    ]);
    expect(() => planStacks([issue(1)], blockedBy)).toThrow(
      /#1 is blocked by #99.*open but not in the walk/s,
    );
  });

  it("rejects a blocked-by cycle, naming every unplaceable issue", () => {
    expect(() =>
      planStacks([issue(1), issue(2), issue(3)], graph({ 1: [2], 2: [1] })),
    ).toThrow(/#1, #2 form a blocked-by cycle/);
  });

  it("aggregates all graph errors into one throw", () => {
    const blockedBy = new Map<number, Blocker[]>([
      [1, [{ number: 2, state: "open" }]],
      [2, [{ number: 1, state: "open" }]],
      [3, [{ number: 99, state: "open" }]],
    ]);
    let message = "";
    try {
      planStacks([issue(1), issue(2), issue(3)], blockedBy);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/#3 is blocked by #99/);
    expect(message).toMatch(/#1, #2 form a blocked-by cycle/);
  });
});

describe("planStacks: component partitioning", () => {
  it("puts unrelated issues in separate stacks, ordered by lowest member", () => {
    const stacks = planStacks(
      [issue(1), issue(2), issue(3), issue(4)],
      graph({ 3: [1], 4: [2] }),
    );
    expect(stacks.map(numbersOf)).toEqual([
      [1, 3],
      [2, 4],
    ]);
  });

  it("connects components through undirected edges, in either direction", () => {
    // 5 blocks 1 and 2; 3 blocks nothing but is blocked by 1: all one
    // component even though no single issue reaches every other.
    const stacks = planStacks(
      [issue(1), issue(2), issue(3), issue(5)],
      graph({ 1: [5], 2: [5], 3: [1] }),
    );
    expect(stacks.map(numbersOf)).toEqual([[5, 1, 2, 3]]);
  });

  it("makes a single-issue component a standalone PR based on trunk", () => {
    const stacks = planStacks(
      [issue(1), issue(2), issue(3)],
      graph({ 3: [2] }),
    );
    expect(stacks).toEqual([
      [
        {
          issue: issue(1),
          branch: "sandcastle/issue-1",
          base: "main",
          dependsOn: [],
        },
      ],
      [
        {
          issue: issue(2),
          branch: "sandcastle/issue-2",
          base: "main",
          dependsOn: [],
        },
        {
          issue: issue(3),
          branch: "sandcastle/issue-3",
          base: "sandcastle/issue-2",
          dependsOn: [2],
        },
      ],
    ]);
  });

  it("excludes nothing: every issue lands in exactly one stack", () => {
    const issues = [issue(1), issue(2), issue(3), issue(4), issue(5)];
    const stacks = planStacks(issues, graph({ 2: [1], 5: [4] }));
    expect(stacks.flatMap(numbersOf).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });
});

describe("screenMutations", () => {
  const issues = [issue(1), issue(2), issue(3)];

  it("accepts valid mutations and applies them to the amended graph", () => {
    const proposed = [mutation("add", 3, 1), mutation("remove", 2, 1)];
    const { accepted, rejected, amended } = screenMutations(
      issues,
      graph({ 2: [1] }),
      proposed,
    );
    expect(accepted).toEqual(proposed);
    expect(rejected).toEqual([]);
    expect(edgesOf(amended)).toEqual({ 1: [], 2: [], 3: [1] });
  });

  it("returns the graph unchanged for an empty proposal", () => {
    const { accepted, rejected, amended } = screenMutations(
      issues,
      graph({ 2: [1] }),
      [],
    );
    expect(accepted).toEqual([]);
    expect(rejected).toEqual([]);
    expect(edgesOf(amended)).toEqual({ 1: [], 2: [1], 3: [] });
  });

  it("accepts re-adding a present edge and removing an absent one (idempotent no-ops)", () => {
    const proposed = [mutation("add", 2, 1), mutation("remove", 3, 1)];
    const { accepted, rejected, amended } = screenMutations(
      issues,
      graph({ 2: [1] }),
      proposed,
    );
    expect(accepted).toEqual(proposed);
    expect(rejected).toEqual([]);
    expect(edgesOf(amended)).toEqual({ 1: [], 2: [1], 3: [] });
  });

  it("drops a mutation referencing an issue outside the walk, naming it", () => {
    const proposed = [mutation("add", 2, 99)];
    const { accepted, rejected, amended } = screenMutations(
      issues,
      graph({}),
      proposed,
    );
    expect(accepted).toEqual([]);
    expect(rejected).toEqual([
      {
        mutation: proposed[0],
        reason: "references #99, not an open Sandcastle issue in this walk",
      },
    ]);
    expect(edgesOf(amended)).toEqual({ 1: [], 2: [], 3: [] });
  });

  it("names both endpoints when neither is in the walk", () => {
    const { rejected } = screenMutations(issues, graph({}), [
      mutation("remove", 98, 99),
    ]);
    expect(rejected[0]!.reason).toBe(
      "references #98 and #99, not an open Sandcastle issue in this walk",
    );
  });

  it("drops a cycle-creating addition with the dependency spelled out", () => {
    const proposed = [mutation("add", 1, 3)];
    const { accepted, rejected, amended } = screenMutations(
      issues,
      graph({ 2: [1], 3: [2] }),
      proposed,
    );
    expect(accepted).toEqual([]);
    expect(rejected).toEqual([
      {
        mutation: proposed[0],
        reason:
          "would create a blocked-by cycle — #3 already depends on #1",
      },
    ]);
    expect(edgesOf(amended)).toEqual({ 1: [], 2: [1], 3: [2] });
  });

  it("drops a self-edge as a cycle", () => {
    const { accepted, rejected } = screenMutations(issues, graph({}), [
      mutation("add", 1, 1),
    ]);
    expect(accepted).toEqual([]);
    expect(rejected[0]!.reason).toMatch(/blocked-by cycle/);
  });

  it("screens each addition against the graph as amended so far", () => {
    // The first add lands; the reverse edge would now close a cycle.
    const first = mutation("add", 2, 1);
    const second = mutation("add", 1, 2);
    const { accepted, rejected } = screenMutations(issues, graph({}), [
      first,
      second,
    ]);
    expect(accepted).toEqual([first]);
    expect(rejected).toEqual([
      {
        mutation: second,
        reason:
          "would create a blocked-by cycle — #2 already depends on #1",
      },
    ]);
  });

  it("lets a removal make room for a later reversed addition", () => {
    const proposed = [mutation("remove", 2, 1), mutation("add", 1, 2)];
    const { accepted, rejected, amended } = screenMutations(
      issues,
      graph({ 2: [1] }),
      proposed,
    );
    expect(accepted).toEqual(proposed);
    expect(rejected).toEqual([]);
    expect(edgesOf(amended)).toEqual({ 1: [2], 2: [], 3: [] });
  });

  it("screens every proposed mutation: accepted plus rejected is the proposal", () => {
    const proposed = [
      mutation("add", 3, 1),
      mutation("add", 2, 99),
      mutation("add", 1, 3),
      mutation("remove", 2, 1),
    ];
    const { accepted, rejected } = screenMutations(
      issues,
      graph({ 2: [1] }),
      proposed,
    );
    expect(accepted.length + rejected.length).toBe(proposed.length);
    const screened = [...accepted, ...rejected.map((r) => r.mutation)];
    expect(screened.map((m) => m.reasoning).sort()).toEqual(
      proposed.map((m) => m.reasoning).sort(),
    );
  });

  it("passes blockers outside the walk through to the amended graph untouched", () => {
    const blockedBy = new Map<number, Blocker[]>([
      [2, [{ number: 99, state: "closed" }, { number: 1, state: "open" }]],
    ]);
    const { amended } = screenMutations(issues, blockedBy, [
      mutation("remove", 2, 1),
    ]);
    expect(amended.get(2)).toEqual([{ number: 99, state: "closed" }]);
  });
});

describe("waveLevels", () => {
  it("groups a topologically ordered stack by dependency depth", () => {
    const stacks = planStacks(
      [issue(1), issue(2), issue(3), issue(4)],
      graph({ 2: [1], 3: [1], 4: [2, 3] }),
    );
    const levels = waveLevels(stacks[0]!);
    expect(
      levels.map((level) => level.map((s) => s.issue.number)),
    ).toEqual([[1], [2, 3], [4]]);
  });

  it("puts every step of an edgeless stack in one level", () => {
    // Built directly: planStacks can never emit a multi-step edgeless
    // stack, but waveLevels' contract is over any topological order.
    const steps = [1, 2, 3].map((n) => ({ issue: issue(n), dependsOn: [] }));
    expect(waveLevels(steps)).toEqual([steps]);
  });
});

describe("pruneClosure", () => {
  it("takes the seed's transitive dependents and nothing else", () => {
    const [stack] = planStacks(
      [issue(1), issue(2), issue(3), issue(4)],
      graph({ 2: [1], 3: [2], 4: [1] }),
    );
    expect(pruneClosure(stack!, [2])).toEqual(new Set([2, 3]));
  });

  it("returns an empty set for no seeds", () => {
    const [stack] = planStacks([issue(1), issue(2)], graph({ 2: [1] }));
    expect(pruneClosure(stack!, [])).toEqual(new Set());
  });
});
