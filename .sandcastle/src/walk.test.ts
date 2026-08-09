// Walk/resume state-machine specs (ADR 0029): the walk runs against a
// fake WalkEffects, so every spec asserts on decisions and outputs —
// never on internal call sequencing. The fake's records are the walk's
// observable behavior at its own boundary.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BranchGate, RestackOutcome } from "./restack.ts";
import type { StackStep } from "./stack.ts";
import {
  linkChainedPrs,
  runStack,
  runSucceeded,
  Semaphore,
  type LedgerPr,
  type SandboxBuild,
  type StackOutcome,
  type WalkContext,
  type WalkEffects,
} from "./walk.ts";

// The walk narrates heavily; keep spec output readable. Cleared per
// test so console assertions see only their own walk's lines.
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// Build a chained stack from (issue number, dependencies) pairs, the way
// planStacks would emit it: input order is the chain order (level-major),
// first step based on main, every later step on its predecessor's branch.
function chain(
  spec: readonly { n: number; deps?: readonly number[] }[],
): StackStep[] {
  let base = "main";
  return spec.map(({ n, deps }) => {
    const step: StackStep = {
      issue: { number: n, title: `Issue ${n}` },
      branch: branchOf(n),
      base,
      dependsOn: deps ?? [],
    };
    base = step.branch;
    return step;
  });
}

function branchOf(n: number): string {
  return `sandcastle/issue-${n}`;
}

function urlOf(branch: string): string {
  return `https://example.test/pr/${branch}`;
}

interface FakeOptions {
  /** Branches that already have an open PR when the walk starts. */
  readonly openPrs?: readonly string[];
  /** Closed/merged ledger entries per branch, joined with any open PR. */
  readonly ledgers?: Readonly<Record<string, readonly LedgerPr[]>>;
  /** Branches whose origin ref exists at walk start (PR-less, stale). */
  readonly originBranches?: readonly string[];
  /** Branches whose ledger query throws (a flaked gh call). */
  readonly prQueryFlakes?: readonly string[];
  /** Every closeIssueWithComment call throws. */
  readonly closeIssueFails?: boolean;
  /** Ancestry-gate verdict per branch; default clean. */
  readonly gates?: Readonly<Record<string, BranchGate>>;
  /** Implement result per branch; an Error throws. Default: one commit. */
  readonly builds?: Readonly<Record<string, SandboxBuild | Error>>;
  /** Branches whose review sandbox throws. */
  readonly reviewFails?: readonly string[];
  /** Branches whose draft-PR creation throws. */
  readonly createPrFails?: readonly string[];
  /** Initial PR base per branch, for PRs that predate the walk. */
  readonly prBases?: Readonly<Record<string, string>>;
  /** Branches whose retargetPrBase call throws. */
  readonly retargetFails?: readonly string[];
  /** Restack outcome per branch; an Error throws. Default: restacked. */
  readonly restacks?: Readonly<Record<string, RestackOutcome | Error>>;
  /** [outer, inner] pairs where outer's history carries inner. */
  readonly carries?: readonly (readonly [string, string])[];
  /** Every linkPrStack call throws. */
  readonly linkFails?: boolean;
}

interface FakeEffects extends WalkEffects {
  /** Branches that got an implement sandbox, with each one's base. */
  readonly builds: { branch: string; waveBase: string }[];
  /** Branches that got a review sandbox. */
  readonly reviews: string[];
  /** Branches the host pushed, in order. */
  readonly pushes: string[];
  /** Every draft PR the host opened. */
  readonly prsCreated: { branch: string; base: string; title: string; body: string }[];
  /** Branches the ancestry gate was consulted for. */
  readonly gated: string[];
  /** Restack turns taken, with the tip each branch was rebased onto. */
  readonly restacks: { branch: string; onto: string }[];
  readonly retargets: { branch: string; base: string }[];
  /** Every linkPrStack call's membership, bottom-to-top. */
  readonly links: string[][];
  /** Branches deleteStaleBranch was told to delete, in order. */
  readonly deleted: string[];
  /** Issues closed with their comment text. */
  readonly closedIssues: { issue: number; comment: string }[];
  /** Interleaved delete/implement/push/review/pr order record. */
  readonly events: string[];
}

function fakeEffects(options: FakeOptions = {}): FakeEffects {
  const prs = new Map((options.openPrs ?? []).map((b) => [b, urlOf(b)]));
  // PR bases track createDraftPr and retargetPrBase, the way GitHub would.
  const bases = new Map(Object.entries(options.prBases ?? {}));
  const carries = new Set(
    (options.carries ?? []).map(([outer, inner]) => `${outer} ${inner}`),
  );
  const effects: FakeEffects = {
    builds: [],
    reviews: [],
    pushes: [],
    prsCreated: [],
    gated: [],
    restacks: [],
    retargets: [],
    links: [],
    deleted: [],
    closedIssues: [],
    events: [],
    // The `prs` map holds the open PRs (given up front or opened by
    // createDraftPr); the `ledgers` option supplies the rest.
    prLedger(branch) {
      if (options.prQueryFlakes?.includes(branch)) {
        throw new Error(`gh flaked listing PRs for ${branch}`);
      }
      const open = prs.get(branch);
      return [
        ...(options.ledgers?.[branch] ?? []),
        ...(open === undefined
          ? []
          : [{ state: "OPEN" as const, url: open, createdAt: "" }]),
      ];
    },
    originBranchExists: (branch) =>
      options.originBranches?.includes(branch) === true &&
      !effects.deleted.includes(branch),
    deleteStaleBranch(branch) {
      effects.deleted.push(branch);
      effects.events.push(`delete:${branch}`);
    },
    closeIssueWithComment(issue, comment) {
      if (options.closeIssueFails) throw new Error("gh issue close exploded");
      effects.closedIssues.push({ issue, comment });
    },
    linkPrStack(urls) {
      if (options.linkFails) throw new Error("gh stack link exploded");
      effects.links.push([...urls]);
    },
    prBase: (branch) => bases.get(branch),
    retargetPrBase(branch, base) {
      if (options.retargetFails?.includes(branch)) {
        throw new Error(`gh pr edit exploded for ${branch}`);
      }
      effects.retargets.push({ branch, base });
      bases.set(branch, base);
    },
    async implementInSandbox(step, waveBase) {
      effects.builds.push({ branch: step.branch, waveBase });
      effects.events.push(`implement:${step.branch}`);
      const build = options.builds?.[step.branch] ?? {
        commitCount: 1,
        stdout: "",
      };
      if (build instanceof Error) throw build;
      return build;
    },
    async reviewInSandbox(step) {
      effects.reviews.push(step.branch);
      effects.events.push(`review:${step.branch}`);
      if (options.reviewFails?.includes(step.branch)) {
        throw new Error(`review sandbox died on ${step.branch}`);
      }
    },
    pushBranch(branch) {
      effects.pushes.push(branch);
      effects.events.push(`push:${branch}`);
    },
    createDraftPr(branch, base, title, body) {
      if (options.createPrFails?.includes(branch)) {
        throw new Error(`gh pr create exploded for ${branch}`);
      }
      effects.prsCreated.push({ branch, base, title, body });
      effects.events.push(`pr:${branch}`);
      prs.set(branch, urlOf(branch));
      bases.set(branch, base);
      return urlOf(branch);
    },
    fetchOrigin() {},
    resolveOriginTip: (branch) => `origin-sha:${branch}`,
    gateBranchAncestry(branch) {
      effects.gated.push(branch);
      return options.gates?.[branch] ?? { kind: "clean" };
    },
    async restackBranch(branch, tipName) {
      effects.restacks.push({ branch, onto: tipName });
      const outcome = options.restacks?.[branch] ?? {
        kind: "restacked",
        sha: `restacked-sha:${branch}`,
        localRef: { kind: "absent" },
      };
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
    branchCarries: (outer, inner) => carries.has(`${outer} ${inner}`),
  };
  return effects;
}

function ctxWith(effects: WalkEffects): WalkContext {
  return {
    stackCount: 1,
    sandboxPool: new Semaphore(3),
    restackLock: new Semaphore(1),
    effects,
  };
}

function walk(stack: readonly StackStep[], effects: FakeEffects) {
  return runStack(stack, 0, ctxWith(effects));
}

const numbers = (steps: readonly { issue: { number: number } }[]) =>
  steps.map((s) => s.issue.number);

describe("step re-run selection on resume", () => {
  it("skips the sandbox for a step with an open PR but still restacks it", async () => {
    const stack = chain([{ n: 1 }, { n: 2, deps: [1] }]);
    const effects = fakeEffects({ openPrs: [branchOf(1)] });

    const outcome = await walk(stack, effects);

    expect(effects.builds.map((b) => b.branch)).toEqual([branchOf(2)]);
    expect(numbers(outcome.skipped)).toEqual([1]);
    expect(numbers(outcome.chained)).toEqual([1, 2]);
    // The completed layer still takes its restack turn (the no-op case
    // in production) so the chain grows through it.
    expect(effects.restacks).toEqual([
      { branch: branchOf(1), onto: "main" },
      { branch: branchOf(2), onto: branchOf(1) },
    ]);
  });

  it("treats an open PR as complete before the ancestry gate can object", async () => {
    // A leftover branch can be stale and still hold its open PR; the PR
    // is the completion marker, so the step never reaches the gate.
    const stack = chain([{ n: 1 }]);
    const effects = fakeEffects({
      openPrs: [branchOf(1)],
      gates: { [branchOf(1)]: { kind: "blocked", reason: "stale" } },
    });

    const outcome = await walk(stack, effects);

    expect(numbers(outcome.chained)).toEqual([1]);
    expect(effects.gated).toEqual([]);
  });

  it("prunes the step, not the run, when the completion check flakes", async () => {
    const stack = chain([{ n: 1 }, { n: 2, deps: [1] }]);
    const effects = fakeEffects({ prQueryFlakes: [branchOf(1)] });

    const outcome = await walk(stack, effects);

    expect(numbers(outcome.chained)).toEqual([]);
    expect(outcome.pruned).toEqual([
      {
        step: stack[0],
        reason: expect.stringContaining("gh flaked listing PRs"),
      },
      { step: stack[1], reason: "depends on pruned #1" },
    ]);
  });

  it("warns but keeps a built branch whose PR creation failed", async () => {
    // A missing PR doesn't invalidate the chain — the branch still
    // restacks, and a re-run treats the step as incomplete.
    const stack = chain([{ n: 1 }, { n: 2, deps: [1] }]);
    const effects = fakeEffects({ createPrFails: [branchOf(1)] });

    const outcome = await walk(stack, effects);

    expect(outcome.missingPrs).toEqual([branchOf(1)]);
    expect(numbers(outcome.chained)).toEqual([1, 2]);
    expect(numbers(outcome.pruned.map((p) => p.step))).toEqual([]);
  });

  it("cuts each wave's sandboxes from the tip the previous wave left", async () => {
    const stack = chain([{ n: 1 }, { n: 2, deps: [1] }, { n: 3, deps: [2] }]);
    const effects = fakeEffects();

    await walk(stack, effects);

    expect(effects.builds).toEqual([
      { branch: branchOf(1), waveBase: "main" },
      { branch: branchOf(2), waveBase: branchOf(1) },
      { branch: branchOf(3), waveBase: branchOf(2) },
    ]);
  });
});

describe("implement, review, then the host opens the PR", () => {
  it("sequences a fresh build: implement, push, review, push, PR", async () => {
    const stack = chain([{ n: 1 }]);
    const effects = fakeEffects();

    const outcome = await walk(stack, effects);

    expect(effects.events).toEqual([
      `implement:${branchOf(1)}`,
      `push:${branchOf(1)}`,
      `review:${branchOf(1)}`,
      `push:${branchOf(1)}`,
      `pr:${branchOf(1)}`,
    ]);
    expect(numbers(outcome.chained)).toEqual([1]);
  });

  it("reviews and opens the PR for a crash-resumed step with no new commits", async () => {
    // The branch already carries the implementation from a dead run;
    // the implement pass adds nothing. The reviewer decision reads the
    // branch, not this run's commit count, so review and PR still run.
    const stack = chain([{ n: 1 }]);
    const effects = fakeEffects({
      builds: { [branchOf(1)]: { commitCount: 0, stdout: "" } },
    });

    const outcome = await walk(stack, effects);

    expect(effects.reviews).toEqual([branchOf(1)]);
    expect(effects.prsCreated.map((p) => p.branch)).toEqual([branchOf(1)]);
    expect(outcome.pruned).toEqual([]);
    expect(numbers(outcome.chained)).toEqual([1]);
  });

  it("fails the step before any PR exists when the review effect throws", async () => {
    const stack = chain([{ n: 1 }, { n: 2, deps: [1] }]);
    const effects = fakeEffects({ reviewFails: [branchOf(1)] });

    const outcome = await walk(stack, effects);

    expect(effects.prsCreated).toEqual([]);
    expect(outcome.pruned).toEqual([
      {
        step: stack[0],
        reason: expect.stringContaining("review sandbox died"),
      },
      { step: stack[1], reason: "depends on pruned #1" },
    ]);
  });

  it("opens the PR against the wave base with the implementer's emitted body", async () => {
    const stack = chain([{ n: 1 }]);
    const effects = fakeEffects({
      builds: {
        [branchOf(1)]: {
          commitCount: 2,
          stdout:
            "…<pr-body>Closes #1\n\nAdds the thing per the spec.</pr-body>…",
        },
      },
    });

    await walk(stack, effects);

    expect(effects.prsCreated).toEqual([
      {
        branch: branchOf(1),
        base: "main",
        title: "Issue 1",
        body: "Closes #1\n\nAdds the thing per the spec.",
      },
    ]);
  });

  it("guarantees the closing keyword when the emitted body lacks it", async () => {
    const stack = chain([{ n: 1 }]);
    const effects = fakeEffects({
      builds: {
        [branchOf(1)]: {
          commitCount: 1,
          stdout: "<pr-body>Adds the thing.</pr-body>",
        },
      },
    });

    await walk(stack, effects);

    expect(effects.prsCreated[0]?.body).toBe("Closes #1\n\nAdds the thing.");
  });

  it("falls back to a bare closing keyword when no body was emitted", async () => {
    const stack = chain([{ n: 1 }]);
    const effects = fakeEffects();

    await walk(stack, effects);

    expect(effects.prsCreated[0]?.body).toBe("Closes #1");
  });
});

describe("the PR ledger verdict at step start", () => {
  // Ledger entries for the non-open states; open PRs come via openPrs.
  const merged = (branch: string, createdAt = "2026-01-01"): LedgerPr => ({
    state: "MERGED",
    url: `${urlOf(branch)}-merged`,
    createdAt,
  });
  const closed = (branch: string, createdAt = "2026-01-02"): LedgerPr => ({
    state: "CLOSED",
    url: `${urlOf(branch)}-closed`,
    createdAt,
  });

  it("skips a merged step, closes its issue, and leaves it out of the chain", async () => {
    const stack = chain([{ n: 1 }, { n: 2, deps: [1] }]);
    const effects = fakeEffects({
      ledgers: { [branchOf(1)]: [merged(branchOf(1))] },
    });

    const outcome = await walk(stack, effects);

    expect(numbers(outcome.skippedMerged)).toEqual([1]);
    // Merged work already sits in the base, so the successor builds on
    // the unchanged tip and the merged step takes no restack turn.
    expect(numbers(outcome.chained)).toEqual([2]);
    expect(effects.builds).toEqual([
      { branch: branchOf(2), waveBase: "main" },
    ]);
    expect(effects.restacks).toEqual([{ branch: branchOf(2), onto: "main" }]);
    expect(effects.closedIssues).toEqual([
      {
        issue: 1,
        comment:
          `Addressed by merged PR ${urlOf(branchOf(1))}-merged ` +
          `(Sandcastle resume check)`,
      },
    ]);
    expect(effects.deleted).toEqual([]);
    // The skip is surfaced as a warning, not silently absorbed.
    expect(
      vi.mocked(console.log).mock.calls.flat().join("\n"),
    ).toContain("already merged");
  });

  it("keeps walking when the issue-close of a merged step flakes", async () => {
    const stack = chain([{ n: 1 }, { n: 2, deps: [1] }]);
    const effects = fakeEffects({
      ledgers: { [branchOf(1)]: [merged(branchOf(1))] },
      closeIssueFails: true,
    });

    const outcome = await walk(stack, effects);

    expect(numbers(outcome.skippedMerged)).toEqual([1]);
    expect(numbers(outcome.chained)).toEqual([2]);
    expect(effects.closedIssues).toEqual([]);
  });

  it("deletes a rejected branch and rebuilds it fresh under the same name", async () => {
    const stack = chain([{ n: 1 }]);
    const effects = fakeEffects({
      ledgers: { [branchOf(1)]: [closed(branchOf(1))] },
    });

    const outcome = await walk(stack, effects);

    expect(effects.builds).toEqual([
      { branch: branchOf(1), waveBase: "main" },
    ]);
    // Deletion strictly precedes the rebuild, so a fresh sandbox can
    // never resume rejected work.
    expect(effects.events.slice(0, 2)).toEqual([
      `delete:${branchOf(1)}`,
      `implement:${branchOf(1)}`,
    ]);
    // The gate still runs after deletion — it just finds nothing stale.
    expect(effects.gated).toEqual([branchOf(1)]);
    expect(numbers(outcome.staleRebuilt)).toEqual([1]);
    expect(numbers(outcome.chained)).toEqual([1]);
    expect(effects.closedIssues).toEqual([]);
  });

  it("treats a PR-less branch as stale: deleted, then rebuilt", async () => {
    const stack = chain([{ n: 1 }]);
    const effects = fakeEffects({ originBranches: [branchOf(1)] });

    const outcome = await walk(stack, effects);

    expect(effects.events.slice(0, 2)).toEqual([
      `delete:${branchOf(1)}`,
      `implement:${branchOf(1)}`,
    ]);
    expect(numbers(outcome.staleRebuilt)).toEqual([1]);
  });

  it("builds fresh with no deletion when neither branch nor PRs exist", async () => {
    const stack = chain([{ n: 1 }]);
    const effects = fakeEffects();

    const outcome = await walk(stack, effects);

    expect(effects.deleted).toEqual([]);
    expect(effects.builds.map((b) => b.branch)).toEqual([branchOf(1)]);
    expect(numbers(outcome.staleRebuilt)).toEqual([]);
  });

  it("lets an open PR win over a newer closed one", async () => {
    const stack = chain([{ n: 1 }]);
    const effects = fakeEffects({
      openPrs: [branchOf(1)],
      ledgers: { [branchOf(1)]: [closed(branchOf(1), "2026-03-01")] },
    });

    const outcome = await walk(stack, effects);

    expect(numbers(outcome.skipped)).toEqual([1]);
    expect(effects.builds).toEqual([]);
    expect(effects.deleted).toEqual([]);
  });

  it("lets the newest PR decide when nothing is open: closed beats an older merge", async () => {
    const stack = chain([{ n: 1 }]);
    const effects = fakeEffects({
      ledgers: {
        [branchOf(1)]: [
          merged(branchOf(1), "2026-01-01"),
          closed(branchOf(1), "2026-02-01"),
        ],
      },
    });

    const outcome = await walk(stack, effects);

    expect(effects.deleted).toEqual([branchOf(1)]);
    expect(numbers(outcome.staleRebuilt)).toEqual([1]);
    expect(effects.closedIssues).toEqual([]);
  });
});

describe("the ancestry gate on resume", () => {
  it("prunes a blocked step with the gate's recovery reason, sandbox unbuilt", async () => {
    const stack = chain([{ n: 1 }, { n: 2, deps: [1] }]);
    const effects = fakeEffects({
      gates: {
        [branchOf(1)]: {
          kind: "blocked",
          reason: "stale sandcastle/issue-1 is checked out at /w — detach it",
        },
      },
    });

    const outcome = await walk(stack, effects);

    expect(effects.builds).toEqual([]);
    expect(outcome.pruned).toEqual([
      { step: stack[0], reason: expect.stringContaining("checked out at /w") },
      { step: stack[1], reason: "depends on pruned #1" },
    ]);
  });

  it("audits a gate rebuild's local-ref reset and keeps building", async () => {
    const stack = chain([{ n: 1 }]);
    const effects = fakeEffects({
      gates: {
        [branchOf(1)]: {
          kind: "rebuilt",
          details: ["local sandcastle/issue-1 reset from stale abc to its base"],
          localMove: { from: "stale-sha", to: "base-sha" },
        },
      },
    });

    const outcome = await walk(stack, effects);

    expect(numbers(outcome.chained)).toEqual([1]);
    expect(effects.builds.map((b) => b.branch)).toEqual([branchOf(1)]);
    expect(outcome.localRefMoves).toEqual([
      { branch: branchOf(1), from: "stale-sha", to: "base-sha" },
    ]);
  });

  it("records no move when a gate rebuild only touched origin", async () => {
    const stack = chain([{ n: 1 }]);
    const effects = fakeEffects({
      gates: {
        [branchOf(1)]: {
          kind: "rebuilt",
          details: ["origin/sandcastle/issue-1 reset from stale def to its base"],
        },
      },
    });

    const outcome = await walk(stack, effects);

    expect(numbers(outcome.chained)).toEqual([1]);
    expect(outcome.localRefMoves).toEqual([]);
  });
});

describe("prune propagation", () => {
  // A diamond: 1 at the bottom, siblings 2 and 3 on top of it, 4 on 2.
  const diamond = () =>
    chain([
      { n: 1 },
      { n: 2, deps: [1] },
      { n: 3, deps: [1] },
      { n: 4, deps: [2] },
    ]);

  it("splices an empty build as a no-op; its dependent builds from the no-op's base", async () => {
    // The no-op branch equals its wave base, so #4 loses nothing by
    // building on without it (#183).
    const stack = diamond();
    const effects = fakeEffects({
      builds: { [branchOf(2)]: { commitCount: 0, stdout: "" } },
      carries: [[branchOf(1), branchOf(2)]],
    });

    const outcome = await walk(stack, effects);

    expect(numbers(outcome.noops)).toEqual([2]);
    expect(outcome.pruned).toEqual([]);
    expect(numbers(outcome.chained)).toEqual([1, 3, 4]);
    // The empty branch never got a review sandbox, a PR, or a restack turn.
    expect(effects.reviews).not.toContain(branchOf(2));
    expect(effects.prsCreated.map((p) => p.branch)).not.toContain(branchOf(2));
    expect(effects.restacks.map((r) => r.branch)).not.toContain(branchOf(2));
  });

  it("builds a step chained directly after a no-op from the no-op's base", async () => {
    const stack = chain([{ n: 1 }, { n: 2, deps: [1] }, { n: 3, deps: [2] }]);
    const effects = fakeEffects({
      builds: { [branchOf(2)]: { commitCount: 0, stdout: "" } },
      carries: [[branchOf(1), branchOf(2)]],
    });

    const outcome = await walk(stack, effects);

    expect(numbers(outcome.noops)).toEqual([2]);
    expect(numbers(outcome.chained)).toEqual([1, 3]);
    // #3's sandbox cuts from #2's base, the tip the no-op never moved.
    expect(effects.builds).toEqual([
      { branch: branchOf(1), waveBase: "main" },
      { branch: branchOf(2), waveBase: branchOf(1) },
      { branch: branchOf(3), waveBase: branchOf(1) },
    ]);
    expect(effects.restacks).toEqual([
      { branch: branchOf(1), onto: "main" },
      { branch: branchOf(3), onto: branchOf(1) },
    ]);
  });

  it("reports a no-op as a neutral skip with the manual-close reminder", async () => {
    const stack = chain([{ n: 1 }]);
    const effects = fakeEffects({
      builds: { [branchOf(1)]: { commitCount: 0, stdout: "" } },
      carries: [["main", branchOf(1)]],
    });

    await walk(stack, effects);

    expect(vi.mocked(console.log).mock.calls.flat().join("\n")).toContain(
      "○ #1 skipped — no changes to make: all its work already landed " +
        "in the PRs below it. Close the issue manually once the stack " +
        "merges.",
    );
  });

  it("surfaces a missing-dependency report as the prune reason", async () => {
    const stack = chain([{ n: 1 }]);
    const effects = fakeEffects({
      builds: {
        [branchOf(1)]: {
          commitCount: 0,
          stdout:
            "…<missing-dependency>needs the fixture\nhelper from #103</missing-dependency>…",
        },
      },
      carries: [["main", branchOf(1)]],
    });

    const outcome = await walk(stack, effects);

    expect(outcome.pruned).toEqual([
      {
        step: stack[0],
        reason:
          "stopped on a missing dependency: needs the fixture helper from #103",
      },
    ]);
  });

  it("contains a crashed sandbox as that step's prune", async () => {
    const stack = chain([{ n: 1 }, { n: 2, deps: [1] }]);
    const effects = fakeEffects({
      builds: { [branchOf(1)]: new Error("docker died") },
    });

    const outcome = await walk(stack, effects);

    expect(outcome.pruned).toEqual([
      { step: stack[0], reason: "docker died" },
      { step: stack[1], reason: "depends on pruned #1" },
    ]);
  });

  it.each([
    [
      { kind: "unpushed" } satisfies RestackOutcome,
      "sandcastle/issue-2 was never pushed to origin",
    ],
    [
      {
        kind: "conflict",
        reason: "conflicted and the resolver could not finish the rebase",
      } satisfies RestackOutcome,
      "rebase onto sandcastle/issue-1 conflicted and the resolver could not finish the rebase",
    ],
    [
      { kind: "check-failed", resolution: "none" } satisfies RestackOutcome,
      "npm run check failed at its tip restacked onto sandcastle/issue-1",
    ],
    [
      { kind: "check-failed", resolution: "agent" } satisfies RestackOutcome,
      "the resolver finished its rebase onto sandcastle/issue-1 but npm run check failed",
    ],
    [
      { kind: "check-failed", resolution: "rerere" } satisfies RestackOutcome,
      "rerere replayed recorded resolutions onto sandcastle/issue-1 but npm run check failed",
    ],
  ])(
    "prunes a branch the restack could not chain: %o",
    async (restackOutcome, reason) => {
      const stack = chain([{ n: 1 }, { n: 2, deps: [1] }, { n: 3, deps: [2] }]);
      const effects = fakeEffects({
        restacks: { [branchOf(2)]: restackOutcome },
      });

      const outcome = await walk(stack, effects);

      expect(numbers(outcome.chained)).toEqual([1]);
      expect(outcome.pruned).toEqual([
        { step: stack[1], reason },
        { step: stack[2], reason: "depends on pruned #2" },
      ]);
      // The dependent's wave never built it.
      expect(effects.builds.map((b) => b.branch)).not.toContain(branchOf(3));
    },
  );

  it("prunes a thrown restack with the error as reason", async () => {
    const stack = chain([{ n: 1 }]);
    const effects = fakeEffects({
      restacks: { [branchOf(1)]: new Error("worktree vanished") },
    });

    const outcome = await walk(stack, effects);

    expect(outcome.pruned).toEqual([
      { step: stack[0], reason: "restack failed: worktree vanished" },
    ]);
  });

  it("prunes a resumed branch whose history carries a pruned sibling", async () => {
    // Sibling 3, complete on a previous run with 2's commits in its
    // history, would carry pruned work back — it prunes by contamination.
    const stack = chain([
      { n: 1 },
      { n: 2, deps: [1] },
      { n: 3, deps: [1] },
      { n: 4, deps: [3] },
    ]);
    const effects = fakeEffects({
      openPrs: [branchOf(3)],
      builds: { [branchOf(2)]: new Error("docker died") },
      carries: [[branchOf(3), branchOf(2)]],
    });

    const outcome = await walk(stack, effects);

    expect(numbers(outcome.chained)).toEqual([1]);
    expect(outcome.pruned).toEqual([
      { step: stack[1], reason: "docker died" },
      {
        step: stack[2],
        reason: "its branch history contains pruned sandcastle/issue-2",
      },
      { step: stack[3], reason: "depends on pruned #3" },
    ]);
    expect(outcome.skipped).toEqual([]);
    // The contaminated branch never took a restack turn.
    expect(effects.restacks.map((r) => r.branch)).toEqual([branchOf(1)]);
  });

  it("restacks survivors onto the last good tip after a sibling prunes", async () => {
    const stack = chain([
      { n: 1 },
      { n: 2, deps: [1] },
      { n: 3, deps: [1] },
      { n: 4, deps: [3] },
    ]);
    const effects = fakeEffects({
      restacks: {
        [branchOf(2)]: { kind: "conflict", reason: "conflicted, unresolved" },
      },
    });

    const outcome = await walk(stack, effects);

    expect(numbers(outcome.chained)).toEqual([1, 3, 4]);
    // 3's turn came after 2 pruned mid-restack, so it chains onto 1, not
    // 2 — and the next wave's 4 chains onto 3. Every PR already targets
    // its tip, so the check-first retarget edits nothing (#183).
    expect(effects.restacks).toEqual([
      { branch: branchOf(1), onto: "main" },
      { branch: branchOf(2), onto: branchOf(1) },
      { branch: branchOf(3), onto: branchOf(1) },
      { branch: branchOf(4), onto: branchOf(3) },
    ]);
    expect(effects.retargets).toEqual([]);
  });
});

describe("conflict resolutions in the outcome", () => {
  it("reports how each conflicted rebase was finished, and audits ref moves", async () => {
    const stack = chain([{ n: 1 }, { n: 2, deps: [1] }, { n: 3, deps: [2] }]);
    const effects = fakeEffects({
      restacks: {
        [branchOf(2)]: {
          kind: "resolved",
          sha: "sha-2",
          via: "rerere",
          localRef: { kind: "absent" },
        },
        [branchOf(3)]: {
          kind: "resolved",
          sha: "sha-3",
          via: "agent",
          localRef: { kind: "moved", from: "old-3", to: "sha-3" },
        },
      },
    });

    const outcome = await walk(stack, effects);

    expect(
      outcome.resolved.map((r) => [r.step.issue.number, r.via]),
    ).toEqual([
      [2, "rerere"],
      [3, "agent"],
    ]);
    expect(outcome.localRefMoves).toEqual([
      { branch: branchOf(3), from: "old-3", to: "sha-3" },
    ]);
  });
});

describe("check-first PR retargeting", () => {
  // Siblings 2 and 3 share wave 2: 2 restacks first and moves the tip,
  // so only 3's PR base goes stale.
  const siblings = () =>
    chain([{ n: 1 }, { n: 2, deps: [1] }, { n: 3, deps: [1] }]);

  it("edits only the PR whose base mismatches its chain predecessor", async () => {
    const effects = fakeEffects();

    await walk(siblings(), effects);

    expect(effects.retargets).toEqual([
      { branch: branchOf(3), base: branchOf(2) },
    ]);
  });

  it("warns with the current base, expected base, and fix command when the edit fails", async () => {
    const effects = fakeEffects({ retargetFails: [branchOf(3)] });

    await walk(siblings(), effects);

    const warned = vi.mocked(console.error).mock.calls.flat().join("\n");
    expect(warned).toContain(
      `⚠ ${branchOf(3)}'s PR is based on ${branchOf(1)} instead of ` +
        `${branchOf(2)} and retargeting failed — fix with ` +
        `gh pr edit ${branchOf(3)} --base ${branchOf(2)}.`,
    );
  });

  it("never warns about a base that already matches", async () => {
    // Every retarget call would throw — but none fires, because every
    // PR opened against the base it ends up chained on.
    const effects = fakeEffects({
      retargetFails: [branchOf(1), branchOf(2), branchOf(3)],
    });

    await walk(chain([{ n: 1 }, { n: 2, deps: [1] }, { n: 3, deps: [2] }]), effects);

    expect(
      vi.mocked(console.error).mock.calls.flat().join("\n"),
    ).not.toContain("retarget");
  });
});

describe("runSucceeded", () => {
  const outcome = (over: Partial<StackOutcome> = {}): StackOutcome => ({
    stack: [],
    chained: [],
    skipped: [],
    skippedMerged: [],
    staleRebuilt: [],
    resolved: [],
    noops: [],
    pruned: [],
    missingPrs: [],
    localRefMoves: [],
    ...over,
  });
  const step = chain([{ n: 1 }])[0]!;

  it.each([
    ["all stacks clean", [outcome()], 0, true],
    ["no-op skips only", [outcome({ noops: [step] })], 0, true],
    [
      "a pruned step",
      [outcome({ pruned: [{ step, reason: "docker died" }] })],
      0,
      false,
    ],
    ["a missing PR", [outcome({ missingPrs: [branchOf(1)] })], 0, false],
    ["a failed stack link", [outcome()], 1, false],
    [
      "one clean stack beside one pruned stack",
      [outcome(), outcome({ pruned: [{ step, reason: "docker died" }] })],
      0,
      false,
    ],
  ] as const)(
    "classifies %s",
    (_what, outcomes, linkFailures, verdict) => {
      expect(runSucceeded(outcomes, linkFailures)).toBe(verdict);
    },
  );
});

describe("stack linking", () => {
  it("links the chain wave by wave, full membership every time", async () => {
    const stack = chain([{ n: 1 }, { n: 2, deps: [1] }]);
    const effects = fakeEffects();

    await walk(stack, effects);

    // Wave 1's chain is a single PR — nothing to link yet; wave 2 links
    // the whole chain bottom-to-top.
    expect(effects.links).toEqual([
      [urlOf(branchOf(1)), urlOf(branchOf(2))],
    ]);
  });

  it("never links a single-PR chain", () => {
    const effects = fakeEffects({ openPrs: [branchOf(1)] });
    expect(linkChainedPrs(effects, chain([{ n: 1 }]), "stack 1/1")).toBe(true);
    expect(effects.links).toEqual([]);
  });

  it("reports a failed link without stopping the walk", async () => {
    const stack = chain([{ n: 1 }, { n: 2, deps: [1] }]);
    const effects = fakeEffects({ linkFails: true });

    const outcome = await walk(stack, effects);

    expect(numbers(outcome.chained)).toEqual([1, 2]);
    expect(
      linkChainedPrs(effects, outcome.chained, "stack 1/1"),
    ).toBe(false);
  });

  it("fails a link when a chained member has no open PR", () => {
    const stack = chain([{ n: 1 }, { n: 2, deps: [1] }]);
    const effects = fakeEffects({ openPrs: [branchOf(1)] });
    expect(linkChainedPrs(effects, stack, "stack 1/1")).toBe(false);
    expect(effects.links).toEqual([]);
  });
});
