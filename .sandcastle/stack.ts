// The feature's single seam: ordering and chaining as a pure function.
// Issues and their blocked-by edges in, ordered walk of (issue, branch,
// base) out — no I/O, no side effects. `main.ts` fetches the edges from
// GitHub's REST dependencies endpoint and passes them in as data.
// `main.ts --dry-run` prints this walk and exits, which is both the
// pre-flight check before a paid run and the verification path for changes
// to this logic (the repo intentionally has no test runner; see ADR 0018).

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
 * Order issues by GitHub's native blocked-by DAG and chain them into a
 * stacked-PR walk: the first step is based on `trunk`, every later step on
 * the previous step's branch.
 *
 * The order is a topological sort (Kahn's algorithm). Whenever more than
 * one issue is ready, the lowest issue number goes first — that tie-break
 * is what makes the order deterministic, so no LLM judgment call decides
 * what gets built when.
 *
 * A blocker outside the walk counts as satisfied if it is closed; an open
 * one is an error, since the stack would build on a missing layer. A cycle
 * among walk members is also an error. All errors are aggregated into a
 * single throw so the operator can fix everything in one pass and re-run
 * --dry-run.
 */
export function planStack(
  issues: readonly StackIssue[],
  blockedBy: ReadonlyMap<number, readonly Blocker[]>,
  trunk = "main",
): StackStep[] {
  const byNumber = new Map(issues.map((issue) => [issue.number, issue]));

  const errors: string[] = [];

  // In-degree of each walk member, counting only edges from other walk
  // members. Blockers outside the walk are satisfied (closed) or fatal
  // (open) — either way they never gate the sort.
  const inDegree = new Map<number, number>();
  const dependents = new Map<number, number[]>();
  for (const issue of issues) {
    inDegree.set(issue.number, 0);
  }
  for (const issue of issues) {
    for (const blocker of blockedBy.get(issue.number) ?? []) {
      if (byNumber.has(blocker.number)) {
        inDegree.set(issue.number, inDegree.get(issue.number)! + 1);
        const list = dependents.get(blocker.number) ?? [];
        list.push(issue.number);
        dependents.set(blocker.number, list);
      } else if (blocker.state !== "closed") {
        errors.push(
          `#${issue.number} is blocked by #${blocker.number}, which is ` +
            `${blocker.state} but not in the walk. Label it Sandcastle, ` +
            `close it, or remove the edge.`,
        );
      }
    }
  }

  // Kahn's algorithm. `ready` stays sorted ascending so the lowest issue
  // number is always placed first — the deterministic tie-break.
  const ready = issues
    .map((issue) => issue.number)
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

  if (orderedNumbers.length < issues.length) {
    const unplaced = issues
      .map((issue) => issue.number)
      .filter((n) => !orderedNumbers.includes(n))
      .sort((a, b) => a - b);
    errors.push(
      `Issues ${unplaced.map((n) => `#${n}`).join(", ")} form a blocked-by ` +
        `cycle, so no build order exists. Break the cycle by removing an ` +
        `edge on GitHub.`,
    );
  }

  if (errors.length > 0) {
    throw new Error(
      `Cannot derive a walk from the blocked-by graph:\n` +
        errors.map((e) => `  - ${e}`).join("\n"),
    );
  }

  let base = trunk;
  return orderedNumbers.map((n) => {
    const issue = byNumber.get(n)!;
    const branch = `sandcastle/issue-${issue.number}`;
    const step: StackStep = { issue, branch, base };
    base = branch;
    return step;
  });
}
