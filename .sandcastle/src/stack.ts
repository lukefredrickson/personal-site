// The pure seam: issues and their blocked-by edges in, one ordered
// stack of (issue, branch, base) per connected component out. No I/O —
// callers fetch the edges and pass them as data. The specs in
// `stack.test.ts` pin this logic (ADR 0028).

export interface StackIssue {
  readonly number: number;
  readonly title: string;
}

/** A walk issue with its GitHub label names, as planning fetches it. */
export interface LabeledIssue extends StackIssue {
  readonly labels: readonly string[];
}

/** The label that declares an issue an umbrella (ADR 0039). */
export const UMBRELLA_LABEL = "parent";

/** How an umbrella was detected: owner label, or judgment-agent guess. */
export type UmbrellaProvenance = "labeled" | "inferred";

export interface OmittedUmbrella {
  readonly issue: StackIssue;
  readonly provenance: UmbrellaProvenance;
}

export interface UmbrellaOmission {
  readonly issues: readonly StackIssue[];
  readonly blockedBy: ReadonlyMap<number, readonly Blocker[]>;
  readonly omitted: readonly OmittedUmbrella[];
}

/**
 * Remove umbrella issues from the walk before stacking (ADR 0039).
 * The `parent` label declares an umbrella; `inferred` numbers count
 * only for unlabeled walk members. A dependent of an omitted umbrella
 * inherits the umbrella's own blockers. Pure: issues, edges, and
 * classification in; a reduced walk plus the omitted list out.
 */
export function omitUmbrellas(
  issues: readonly LabeledIssue[],
  blockedBy: ReadonlyMap<number, readonly Blocker[]>,
  inferred: readonly number[] = [],
): UmbrellaOmission {
  const provenance = new Map<number, UmbrellaProvenance>();
  for (const issue of issues) {
    if (issue.labels.includes(UMBRELLA_LABEL)) {
      provenance.set(issue.number, "labeled");
    }
  }
  const walk = new Set(issues.map((issue) => issue.number));
  for (const number of inferred) {
    if (walk.has(number) && !provenance.has(number)) {
      provenance.set(number, "inferred");
    }
  }

  // Splice each blocker through any omitted umbrellas: a dependent ends
  // up blocked by the umbrella's own blockers, transitively.
  const expand = (blocker: Blocker, seen: Set<number>): Blocker[] => {
    if (!provenance.has(blocker.number)) return [blocker];
    if (seen.has(blocker.number)) return [];
    seen.add(blocker.number);
    return (blockedBy.get(blocker.number) ?? []).flatMap((b) =>
      expand(b, seen),
    );
  };

  const kept = issues.filter((issue) => !provenance.has(issue.number));
  const splicedBlockedBy = new Map<number, readonly Blocker[]>(
    kept.map((issue) => {
      const spliced = (blockedBy.get(issue.number) ?? []).flatMap((b) =>
        expand(b, new Set()),
      );
      const byNumber = new Map(
        spliced
          .filter((b) => b.number !== issue.number)
          .map((b) => [b.number, b]),
      );
      return [issue.number, [...byNumber.values()]];
    }),
  );

  return {
    issues: kept.map(({ number, title }) => ({ number, title })),
    blockedBy: splicedBlockedBy,
    omitted: [...provenance]
      .sort(([a], [b]) => a - b)
      .map(([number, prov]) => {
        const { title } = issues.find((issue) => issue.number === number)!;
        return { issue: { number, title }, provenance: prov };
      }),
  };
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
 * Screen the judgment agent's proposed mutations — the host gate
 * between proposal and execution (ADR 0018). Two rules: both endpoints
 * must be walk members, and an addition must not create a cycle in the
 * graph as amended so far. Idempotent no-ops pass unchanged. Blockers
 * outside the walk pass through to the amended graph untouched.
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
 * Partition issues into connected components of the blocked-by graph
 * and chain each component into one stack in level-major order
 * (ADR 0018). The order is deterministic and equals the wave restack's
 * chain order by construction. Open external blockers and cycles are
 * errors, aggregated into one throw so the operator fixes everything
 * in one pass.
 */
export function planStacks(
  issues: readonly StackIssue[],
  blockedBy: ReadonlyMap<number, readonly Blocker[]>,
  trunk = "main",
): StackStep[][] {
  const byNumber = new Map(issues.map((issue) => [issue.number, issue]));

  const errors: string[] = [];

  // Directed edges among walk members (blocker → dependent). External
  // blockers are satisfied (closed) or fatal (open); they never gate.
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

  // BFS over the undirected adjacency. Ascending iteration discovers
  // each component at its lowest member, so components come out ordered.
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

  // Kahn's algorithm per component, for cycle detection only — the
  // chain order comes from the levels computed just after.
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

    // The chain order is the wave levels flattened. Deriving it through
    // `waveLevels` makes the two chain orders coincide structurally.
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
 * Group one stack's steps into topological levels — the wave shape. A
 * level's steps are mutually independent: all build from the previous
 * level's chain tip, then restack serially. The input must be a
 * topological order; input order is preserved within a level. Levels
 * recompute from `dependsOn`, never persist, so a plan-file round-trip
 * cannot disagree with the graph it recorded.
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
 * The issues a prune removes: the seeds plus every transitive dependent
 * among the stack's members. Steps that never depended on a seed are
 * untouched and keep building.
 */
export function pruneClosure(
  stack: readonly StackStep[],
  seeds: Iterable<number>,
): Set<number> {
  const pruned = new Set(seeds);
  // Chain order visits dependencies before dependents, so one pass
  // propagates the closure.
  for (const step of stack) {
    if (step.dependsOn.some((d) => pruned.has(d))) {
      pruned.add(step.issue.number);
    }
  }
  return pruned;
}
