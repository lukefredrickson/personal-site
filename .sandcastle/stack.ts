// The feature's single seam: grouping, ordering, and chaining as a pure
// function. Issues and their blocked-by edges in, one ordered stack of
// (issue, branch, base) per connected component out — no I/O, no side
// effects. `main.ts` fetches the edges from GitHub's REST dependencies
// endpoint and passes them in as data. `main.ts --dry-run` prints the
// stacks and exits, which is both the pre-flight check before a paid run
// and the verification path for changes to this logic (the repo
// intentionally has no test runner; see ADR 0018).

export interface StackIssue {
  readonly number: number;
  readonly title: string;
}

export interface StackStep {
  readonly issue: StackIssue;
  /** Branch this issue's work lands on: sandcastle/issue-<number>. */
  readonly branch: string;
  /** Branch this one is cut from and its PR is based on. */
  readonly base: string;
}

/** A blocking issue from GitHub's native blocked-by graph. */
export interface Blocker {
  readonly number: number;
  readonly state: string;
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
 * Within a component the order is a topological sort (Kahn's algorithm).
 * Whenever more than one issue is ready, the lowest issue number goes
 * first — that tie-break is what makes the order deterministic, so no LLM
 * judgment call decides what gets built when. Stacks themselves are
 * ordered by their lowest member's issue number, for the same reason.
 *
 * A blocker outside the walk counts as satisfied if it is closed; an open
 * one is an error, since the stack would build on a missing layer. A cycle
 * among walk members is also an error. All errors are aggregated into a
 * single throw so the operator can fix everything in one pass and re-run
 * --dry-run.
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
  // Undirected adjacency, used to find the components.
  const neighbors = new Map<number, number[]>();
  for (const issue of issues) {
    inDegree.set(issue.number, 0);
    neighbors.set(issue.number, []);
  }
  for (const issue of issues) {
    for (const blocker of blockedBy.get(issue.number) ?? []) {
      if (byNumber.has(blocker.number)) {
        inDegree.set(issue.number, inDegree.get(issue.number)! + 1);
        const list = dependents.get(blocker.number) ?? [];
        list.push(issue.number);
        dependents.set(blocker.number, list);
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

  // Kahn's algorithm within each component. `ready` stays sorted ascending
  // so the lowest issue number is always placed first — the deterministic
  // tie-break. (Edges never cross components, so sorting each component
  // alone changes nothing about the order it would get in a global sort.)
  const stacks: StackStep[][] = [];
  for (const members of components) {
    const ready = members
      .filter((n) => inDegree.get(n) === 0)
      .sort((a, b) => a - b);

    const orderedNumbers: number[] = [];
    while (ready.length > 0) {
      const n = ready.shift()!;
      orderedNumbers.push(n);
      for (const dependent of dependents.get(n) ?? []) {
        const remaining = inDegree.get(dependent)! - 1;
        inDegree.set(dependent, remaining);
        if (remaining === 0) {
          // Insert keeping `ready` sorted; backlogs are small.
          ready.push(dependent);
          ready.sort((a, b) => a - b);
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

    let base = trunk;
    stacks.push(
      orderedNumbers.map((n) => {
        const issue = byNumber.get(n)!;
        const branch = `sandcastle/issue-${issue.number}`;
        const step: StackStep = { issue, branch, base };
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
