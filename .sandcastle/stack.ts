// The feature's single seam: ordering and chaining as a pure function.
// Issues in, ordered walk of (issue, branch, base) out — no I/O, no side
// effects. `main.ts --dry-run` prints this walk and exits, which is both the
// pre-flight check before a paid run and the verification path for changes
// to this logic (the repo intentionally has no test runner; see ADR 0018).

export interface StackIssue {
  readonly number: number;
  readonly title: string;
}

export interface StackStep {
  readonly issue: StackIssue;
  /** Numeric position parsed from the "Build NN:" title prefix. */
  readonly buildNumber: number;
  /** Branch this issue's work lands on: sandcastle/issue-<number>. */
  readonly branch: string;
  /** Branch this one is cut from and its PR is based on. */
  readonly base: string;
}

const BUILD_PREFIX = /^Build (\d+):/;

/**
 * Order issues by their "Build NN:" title prefix and chain them into a
 * stacked-PR walk: the first step is based on `trunk`, every later step on
 * the previous step's branch.
 *
 * Throws when an issue lacks the prefix or two issues share a build number —
 * both make the order ambiguous, and a deterministic order is the whole
 * point (no LLM judgment call decides what gets built when).
 */
export function planStack(
  issues: readonly StackIssue[],
  trunk = "main",
): StackStep[] {
  const ordered = issues
    .map((issue) => {
      const match = BUILD_PREFIX.exec(issue.title);
      if (!match) {
        throw new Error(
          `Issue #${issue.number} ("${issue.title}") has no "Build NN:" ` +
            `title prefix, so it cannot be ordered deterministically. ` +
            `Fix the title or remove the Sandcastle label.`,
        );
      }
      return { issue, buildNumber: Number(match[1]) };
    })
    .sort((a, b) => a.buildNumber - b.buildNumber);

  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i]!.buildNumber === ordered[i - 1]!.buildNumber) {
      throw new Error(
        `Issues #${ordered[i - 1]!.issue.number} and ` +
          `#${ordered[i]!.issue.number} share build number ` +
          `${ordered[i]!.buildNumber}, so their order is ambiguous.`,
      );
    }
  }

  let base = trunk;
  return ordered.map(({ issue, buildNumber }) => {
    const branch = `sandcastle/issue-${issue.number}`;
    const step: StackStep = { issue, buildNumber, branch, base };
    base = branch;
    return step;
  });
}
