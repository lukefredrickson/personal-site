// The feature's single seam: grouping, ordering, and chaining as a pure
// function. Issues and their blocked-by edges in, one ordered stack of
// (issue, branch, base) per connected component out — no I/O, no side
// effects. `main.ts` fetches the edges from GitHub's REST dependencies
// endpoint and passes them in as data. `main.ts plan` prints the stacks
// and persists them without touching GitHub, which is both the pre-flight
// check before a paid run and the verification path for changes to this
// logic (the repo intentionally has no test runner).

export interface StackIssue {
  readonly number: number;
  readonly title: string;
}

export interface StackStep {
  readonly issue: StackIssue;
  /** Branch this issue's work lands on: sandcastle/issue-<number>. */
  readonly branch: string;
  /** Branch this one is ultimately based on in the final chain. */
  readonly base: string;
  /**
   * Direct blockers among walk members. Drives the wave shape: the step's
   * level is one past its deepest dependency, and a pruned step takes its
   * transitive dependents with it.
   */
  readonly dependsOn: readonly number[];
}

/** A blocking issue from GitHub's native blocked-by graph. */
export interface Blocker {
  readonly number: number;
  readonly state: string;
}

/** One blocked-by edge change proposed by the planning agent. */
export interface EdgeMutation {
  readonly op: "add" | "remove";
  /** The blocked end of the edge: the issue that waits. */
  readonly blocked: number;
  /** The issue that blocks it. */
  readonly blocker: number;
  readonly reasoning: string;
}

export interface RejectedMutation {
  readonly mutation: EdgeMutation;
  readonly reason: string;
}

export interface ScreenedMutations {
  readonly accepted: readonly EdgeMutation[];
  readonly rejected: readonly RejectedMutation[];
  /** The blocked-by graph with every accepted mutation applied. */
  readonly amended: ReadonlyMap<number, readonly Blocker[]>;
}

/**
 * Mechanically screen the planning agent's proposed edge mutations. The
 * agent has no write authority — this is the host-side gate between its
 * proposal and anything that persists or executes. Two rules, no judgment:
 * both endpoints must be issues in the walk, and an addition must not
 * create a cycle in the graph as amended so far. Mutations are screened in
 * proposal order, so a removal can legitimately make room for a later
 * addition. Re-adding a present edge or removing an absent one is accepted
 * unchanged — application is idempotent, so both are harmless no-ops.
 *
 * Blockers outside the walk pass through to the amended graph untouched:
 * the agent may only rewire edges among walk members, and `planStacks`
 * keeps its existing authority over external blockers.
 */
export function screenMutations(
  issues: readonly StackIssue[],
  blockedBy: ReadonlyMap<number, readonly Blocker[]>,
  mutations: readonly EdgeMutation[],
): ScreenedMutations {
  const walk = new Set(issues.map((issue) => issue.number));

  // Walk-internal edges as blocked → its blockers; external blockers are
  // carried separately and never mutated.
  const internal = new Map<number, Set<number>>();
  const external = new Map<number, readonly Blocker[]>();
  for (const issue of issues) {
    const blockers = blockedBy.get(issue.number) ?? [];
    internal.set(
      issue.number,
      new Set(blockers.filter((b) => walk.has(b.number)).map((b) => b.number)),
    );
    external.set(
      issue.number,
      blockers.filter((b) => !walk.has(b.number)),
    );
  }

  // True if `from` transitively depends on (is blocked by) `to`.
  const dependsOn = (from: number, to: number): boolean => {
    const stack = [from];
    const seen = new Set<number>();
    while (stack.length > 0) {
      const n = stack.pop()!;
      if (n === to) return true;
      if (seen.has(n)) continue;
      seen.add(n);
      stack.push(...(internal.get(n) ?? []));
    }
    return false;
  };

  const accepted: EdgeMutation[] = [];
  const rejected: RejectedMutation[] = [];
  for (const mutation of mutations) {
    const missing = [mutation.blocked, mutation.blocker].filter(
      (n) => !walk.has(n),
    );
    if (missing.length > 0) {
      rejected.push({
        mutation,
        reason:
          `references ${missing.map((n) => `#${n}`).join(" and ")}, ` +
          `not an open Sandcastle issue in this walk`,
      });
      continue;
    }
    if (
      mutation.op === "add" &&
      (mutation.blocked === mutation.blocker ||
        dependsOn(mutation.blocker, mutation.blocked))
    ) {
      rejected.push({
        mutation,
        reason:
          `would create a blocked-by cycle — #${mutation.blocker} already ` +
          `depends on #${mutation.blocked}`,
      });
      continue;
    }

    if (mutation.op === "add") {
      internal.get(mutation.blocked)!.add(mutation.blocker);
    } else {
      internal.get(mutation.blocked)!.delete(mutation.blocker);
    }
    accepted.push(mutation);
  }

  // Walk members are open by construction (the issue fetch filters on
  // state:open), so amended internal edges carry state "open".
  const amended = new Map<number, readonly Blocker[]>(
    issues.map((issue) => [
      issue.number,
      [
        ...external.get(issue.number)!,
        ...[...internal.get(issue.number)!].map((number) => ({
          number,
          state: "open",
        })),
      ],
    ]),
  );

  return { accepted, rejected, amended };
}

/**
 * Partition issues into the connected components of the blocked-by graph
 * (treated as undirected — two issues are related if either blocks the
 * other, directly or transitively) and chain each component into its own
 * stacked-PR walk: the component's first step is based on `trunk`, every
 * later step on the previous step's branch. A component of one issue is a
 * one-step stack — a plain standalone PR based on `trunk`. Nothing tagged
 * is ever excluded; grouping replaces gatekeeping.
 *
 * Within a component the order is level-major: issues are grouped into
 * topological levels of the blocked-by graph (a level-0 issue has no
 * blockers in the walk; a deeper issue sits one past its deepest
 * dependency), levels come out shallowest first, and within a level the
 * lowest issue number goes first. That is a valid topological order —
 * every dependency lives on a strictly shallower level — it is
 * deterministic, so no LLM judgment call decides what gets built when,
 * and it is exactly the order the wave restack chains branches in, so
 * the sequential walk and the wave path produce the same chain by
 * construction (see `waveLevels`). Stacks themselves are ordered by
 * their lowest member's issue number, for the same reason.
 *
 * A blocker outside the walk counts as satisfied if it is closed; an open
 * one is an error, since the stack would build on a missing layer. A cycle
 * among walk members is also an error. All errors are aggregated into a
 * single throw so the operator can fix everything in one pass and re-run
 * `plan`.
 */
export function planStacks(
  issues: readonly StackIssue[],
  blockedBy: ReadonlyMap<number, readonly Blocker[]>,
  trunk = "main",
): StackStep[][] {
  const byNumber = new Map(issues.map((issue) => [issue.number, issue]));

  const errors: string[] = [];

  // Directed edges among walk members (blocker → dependent), used for the
  // per-component sort. Blockers outside the walk are satisfied (closed)
  // or fatal (open) — either way they never gate the sort or grouping.
  const inDegree = new Map<number, number>();
  const dependents = new Map<number, number[]>();
  const blockersOf = new Map<number, number[]>();
  // Undirected adjacency, for finding the components.
  const neighbors = new Map<number, number[]>();
  for (const issue of issues) {
    inDegree.set(issue.number, 0);
    blockersOf.set(issue.number, []);
    neighbors.set(issue.number, []);
  }
  for (const issue of issues) {
    for (const blocker of blockedBy.get(issue.number) ?? []) {
      if (byNumber.has(blocker.number)) {
        inDegree.set(issue.number, inDegree.get(issue.number)! + 1);
        const list = dependents.get(blocker.number) ?? [];
        list.push(issue.number);
        dependents.set(blocker.number, list);
        blockersOf.get(issue.number)!.push(blocker.number);
        neighbors.get(issue.number)!.push(blocker.number);
        neighbors.get(blocker.number)!.push(issue.number);
      } else if (blocker.state !== "closed") {
        errors.push(
          `#${issue.number} is blocked by #${blocker.number}, which is ` +
            `${blocker.state} but not in the walk. Label it Sandcastle, ` +
            `close it, or remove the edge.`,
        );
      }
    }
  }

  // Connected components via BFS over the undirected adjacency. Iterating
  // issue numbers in ascending order discovers each component at its
  // lowest member first, so the components come out already ordered by
  // lowest issue number.
  const seen = new Set<number>();
  const components: number[][] = [];
  for (const start of [...byNumber.keys()].sort((a, b) => a - b)) {
    if (seen.has(start)) continue;
    const members: number[] = [];
    const queue = [start];
    seen.add(start);
    while (queue.length > 0) {
      const n = queue.shift()!;
      members.push(n);
      for (const neighbor of neighbors.get(n)!) {
        if (!seen.has(neighbor)) {
          seen.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    components.push(members);
  }

  // Kahn's algorithm within each component, for cycle detection only —
  // the chain order comes from the levels computed just after. (Edges
  // never cross components, so handling each component alone changes
  // nothing about a global sort.)
  const stacks: StackStep[][] = [];
  for (const members of components) {
    const ready = members.filter((n) => inDegree.get(n) === 0);

    // Kahn order visits every dependency before its dependents, so it
    // doubles as the evaluation order for the level computation below.
    const orderedNumbers: number[] = [];
    while (ready.length > 0) {
      const n = ready.shift()!;
      orderedNumbers.push(n);
      for (const dependent of dependents.get(n) ?? []) {
        const remaining = inDegree.get(dependent)! - 1;
        inDegree.set(dependent, remaining);
        if (remaining === 0) {
          ready.push(dependent);
        }
      }
    }

    if (orderedNumbers.length < members.length) {
      const unplaced = members
        .filter((n) => !orderedNumbers.includes(n))
        .sort((a, b) => a - b);
      errors.push(
        `Issues ${unplaced.map((n) => `#${n}`).join(", ")} form a ` +
          `blocked-by cycle, so no build order exists. Break the cycle by ` +
          `removing an edge on GitHub.`,
      );
      continue;
    }

    // The chain order is the wave levels flattened, ascending issue
    // number within each level. Deriving it through `waveLevels` itself —
    // over the Kahn order, which is topological as `waveLevels` requires —
    // is what makes "the sequential chain and the wave-built chain
    // coincide" structural rather than two computations kept in sync.
    const provisional = orderedNumbers.map((n) => ({
      issue: byNumber.get(n)!,
      dependsOn: [...blockersOf.get(n)!].sort((a, b) => a - b),
    }));
    const chainOrder = waveLevels(provisional).flatMap((level) =>
      [...level].sort((a, b) => a.issue.number - b.issue.number),
    );

    let base = trunk;
    stacks.push(
      chainOrder.map(({ issue, dependsOn }) => {
        const branch = `sandcastle/issue-${issue.number}`;
        const step: StackStep = { issue, branch, base, dependsOn };
        base = branch;
        return step;
      }),
    );
  }

  if (errors.length > 0) {
    throw new Error(
      `Cannot derive a walk from the blocked-by graph:\n` +
        errors.map((e) => `  - ${e}`).join("\n"),
    );
  }

  return stacks;
}

/**
 * Group one stack's steps into its topological levels — the wave shape.
 * Every step in a level has all its dependencies in strictly earlier
 * levels, so a level's issues are mutually independent: they can all
 * build from the same base (the chain tip left by the previous level)
 * and then restack serially in ascending issue-number order.
 *
 * The input must be a topological order (each step's dependencies before
 * it); within a level the input order is preserved. `planStacks` derives
 * its chain order through this function, so on a planned stack the
 * levels are consecutive runs of the chain and flattening them back
 * yields the chain order unchanged. Levels are recomputed from
 * `dependsOn` rather than persisted, so a plan file round-trip cannot
 * disagree with the graph it recorded.
 */
export function waveLevels<
  T extends {
    readonly issue: StackIssue;
    readonly dependsOn: readonly number[];
  },
>(stack: readonly T[]): T[][] {
  const level = new Map<number, number>();
  const levels: T[][] = [];
  for (const step of stack) {
    const depth =
      step.dependsOn.length === 0
        ? 0
        : Math.max(...step.dependsOn.map((d) => level.get(d)!)) + 1;
    level.set(step.issue.number, depth);
    (levels[depth] ??= []).push(step);
  }
  return levels;
}

/**
 * The issues a prune takes with it: the seeds plus every transitive
 * dependent among the stack's members. A step whose branch cannot join
 * the chain — rebase conflict, failed check, failed build — leaves its
 * dependents without their foundation, so they are pruned too; steps
 * that never depended on it are untouched and keep building.
 */
export function pruneClosure(
  stack: readonly StackStep[],
  seeds: Iterable<number>,
): Set<number> {
  const pruned = new Set(seeds);
  // Chain order visits dependencies before dependents, so one pass
  // propagates the closure all the way down.
  for (const step of stack) {
    if (step.dependsOn.some((d) => pruned.has(d))) {
      pruned.add(step.issue.number);
    }
  }
  return pruned;
}
