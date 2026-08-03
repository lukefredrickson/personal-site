// Tier-1 git-surgery specs: the behavioral assertions PR #100 recorded
// as prose in its "How to verify" section, transcribed against the same
// seam that verification used — the exported functions driven through
// throwaway git fixture repos (issue #104). Four behavior families:
//
//   - the replay-window restack: a resolver-modified predecessor commit
//     never re-replays downstream, and the old full-lineage rebase
//     provably conflicts on the same fixture;
//   - the resume ancestry gate: stale branches rebuild instead of being
//     reused, while checked-out or diverged refs are blocked untouched
//     with the recovery command in the reason;
//   - the local-ref lease sync: a local ref at exactly the pre-rewrite
//     sha moves, anything else is skipped with reason and recovery;
//   - rerere replay: a textually recurring conflict hunk auto-resolves
//     without a resolver-agent attempt.
//
// Every assertion is on observable git state — ref positions, commit
// lists, returned outcome values, reason/recovery strings — never on
// internal function structure. Restacks that push run the real check
// gate (npm ci --dry-run, npm install, npm run check) against the
// fixture's no-op package, so those specs carry generous timeouts.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFixture, type Fixture } from "./fixtures.ts";
import { gateBranchAncestry, restackBranch } from "./restack.ts";

// npm spawns dominate; a cold CI cache can take a while.
const GATED = { timeout: 120_000 };

// Each spec opens with `const f = fixture()`; the hook disposes it even
// when the spec fails, and tolerates a spec that died before creating
// one.
let active: Fixture | undefined;
afterEach(() => {
  active?.dispose();
  active = undefined;
});
function fixture(): Fixture {
  active = createFixture();
  return active;
}

// ---------------------------------------------------------------------------
// Replay-window restack
// ---------------------------------------------------------------------------

// The run-1 shape: b1's commit was rewritten during its own restack (a
// resolver changed its content, breaking patch-identity), and b2 — built
// on the old b1 tip — must restack onto the rewritten tip. Returns the
// shas the specs assert against.
function rewrittenPredecessorFixture(f: Fixture): {
  readonly oldB1: string;
  readonly newB1: string;
  readonly b2Tip: string;
} {
  const oldB1 = f.addBranch("b1", "main", {
    message: "b1: add feature",
    files: { "feature.txt": "v1\n" },
  });
  const b2Tip = f.addBranch("b2", "b1", {
    message: "b2: add consumer",
    files: { "consumer.txt": "uses feature\n" },
    keepLocal: false,
  });
  const m1 = f.commitOn("main", "main: advance", { "advance.txt": "x\n" });
  // The "resolver-modified" rewrite: b1's commit rebuilt on the new main
  // with different file content, force-pushed — patch-identity with the
  // old commit is gone.
  f.git(["branch", "-f", "b1", m1]);
  const newB1 = f.commitOn(
    "b1",
    "b1: add feature",
    { "feature.txt": "v1 resolved\n" },
    { push: false },
  );
  f.git(["push", "--force", "origin", "b1"]);
  return { oldB1, newB1, b2Tip };
}

describe("restackBranch: replay window", () => {
  it("the old full-lineage rebase re-replays the rewritten predecessor and conflicts", () => {
    const f = fixture();
    const { newB1, b2Tip } = rewrittenPredecessorFixture(f);
    // What the pre-#100 restack did: a plain rebase onto the tip, which
    // replays everything back to the merge-base — including b1's old
    // commit, which no longer patch-matches its rewritten form.
    f.git(["switch", "--detach", b2Tip], f.worktree);
    expect(() => f.git(["rebase", newB1], f.worktree)).toThrow();
    expect(f.git(["ls-files", "--unmerged"], f.worktree)).toContain(
      "feature.txt",
    );
    f.git(["rebase", "--abort"], f.worktree);
  });

  it(
    "the windowed restack replays only the branch's own commits",
    GATED,
    async () => {
      const f = fixture();
      const { oldB1, newB1, b2Tip } = rewrittenPredecessorFixture(f);
      const outcome = await restackBranch(
        f.worktree,
        "b2",
        "b1",
        newB1,
        oldB1,
      );
      // No conflict, no resolution — the rewritten predecessor was never
      // replayed, on the exact fixture where the full rebase conflicts.
      expect(outcome.kind).toBe("restacked");
      expect(f.subjects(`${newB1}..origin/b2`)).toEqual(["b2: add consumer"]);
      expect(f.descends(newB1, "origin/b2")).toBe(true);
      expect(outcome).toMatchObject({ sha: f.sha("origin/b2") });
      // b2Tip stayed behind on origin only until the push replaced it.
      expect(f.sha("origin/b2")).not.toBe(b2Tip);
    },
  );

  it("a branch already chaining from the tip is a no-op", async () => {
    const f = fixture();
    const tip = f.addBranch("b", "main", {
      message: "b: work",
      files: { "b.txt": "b\n" },
    });
    const outcome = await restackBranch(
      f.worktree,
      "b",
      "main",
      f.mainSha,
      f.mainSha,
    );
    expect(outcome).toEqual({ kind: "noop", sha: tip });
  });

  it("a branch never pushed to origin reports unpushed", async () => {
    const f = fixture();
    const outcome = await restackBranch(
      f.worktree,
      "ghost",
      "main",
      f.mainSha,
      f.mainSha,
    );
    expect(outcome).toEqual({ kind: "unpushed" });
  });
});

// ---------------------------------------------------------------------------
// Resume ancestry gate
// ---------------------------------------------------------------------------

// `base` is the step's assigned base — one commit past the fixture's
// initial main, so a branch cut from the initial commit is stale (it
// does not descend from the base).
function assignedBase(f: Fixture): string {
  return f.commitOn("main", "main: base", { "base.txt": "x\n" });
}

describe("gateBranchAncestry", () => {
  it("is clean when the branch does not exist", () => {
    const f = fixture();
    const base = assignedBase(f);
    expect(gateBranchAncestry(f.worktree, "ghost", base)).toEqual({
      kind: "clean",
    });
  });

  it("is clean when origin and local both descend from the base", () => {
    const f = fixture();
    const base = assignedBase(f);
    f.addBranch("good", base, {
      message: "good: work",
      files: { "good.txt": "x\n" },
    });
    expect(gateBranchAncestry(f.worktree, "good", base)).toEqual({
      kind: "clean",
    });
  });

  it("resets a stale origin-only branch to the base so the sandbox rebuilds", () => {
    const f = fixture();
    const base = assignedBase(f);
    f.addBranch("stale", f.mainSha, {
      message: "stale: dead-run work",
      files: { "stale.txt": "x\n" },
      keepLocal: false,
    });
    const gate = gateBranchAncestry(f.worktree, "stale", base);
    expect(gate.kind).toBe("rebuilt");
    expect(f.sha("origin/stale")).toBe(base);
    if (gate.kind === "rebuilt") {
      expect(gate.localMove).toBeUndefined();
      expect(gate.details.join("\n")).toContain("origin/stale reset");
    }
  });

  it("resets a stale local ref matching origin's stale tip, recording the move", () => {
    const f = fixture();
    const base = assignedBase(f);
    const stale = f.addBranch("stale", f.mainSha, {
      message: "stale: dead-run work",
      files: { "stale.txt": "x\n" },
    });
    const gate = gateBranchAncestry(f.worktree, "stale", base);
    expect(gate.kind).toBe("rebuilt");
    expect(f.sha("refs/heads/stale")).toBe(base);
    expect(f.sha("origin/stale")).toBe(base);
    if (gate.kind === "rebuilt") {
      expect(gate.localMove).toEqual({ from: stale, to: base });
      expect(gate.details).toHaveLength(2);
    }
  });

  it("keeps a healthy local branch and brings stale origin to it", () => {
    const f = fixture();
    const base = assignedBase(f);
    f.addBranch("stale", f.mainSha, {
      message: "stale: dead-run work",
      files: { "stale.txt": "x\n" },
    });
    // The operator (or a previous gate) already rebuilt the local branch
    // on the right base and accumulated work there; only origin still
    // carries the dead run.
    f.git(["branch", "-f", "stale", base]);
    const rebuilt = f.commitOn(
      "stale",
      "stale: rebuilt work",
      { "rebuilt.txt": "x\n" },
      { push: false },
    );
    const gate = gateBranchAncestry(f.worktree, "stale", base);
    expect(gate.kind).toBe("rebuilt");
    expect(f.sha("origin/stale")).toBe(rebuilt);
    if (gate.kind === "rebuilt") {
      expect(gate.details.join("\n")).toContain("to the local branch");
    }
  });

  it("blocks a stale branch that is checked out, leaving refs untouched", () => {
    const f = fixture();
    const base = assignedBase(f);
    const stale = f.addBranch("stale", f.mainSha, {
      message: "stale: dead-run work",
      files: { "stale.txt": "x\n" },
    });
    f.git(["switch", "stale"]);
    const gate = gateBranchAncestry(f.worktree, "stale", base);
    expect(gate.kind).toBe("blocked");
    if (gate.kind === "blocked") {
      expect(gate.reason).toContain("checked out at");
      expect(gate.reason).toContain("switch --detach");
    }
    expect(f.sha("refs/heads/stale")).toBe(stale);
    expect(f.sha("origin/stale")).toBe(stale);
  });

  it("blocks a local ref diverged from both origin and base, leaving refs untouched", () => {
    const f = fixture();
    const base = assignedBase(f);
    const stale = f.addBranch("stale", f.mainSha, {
      message: "stale: dead-run work",
      files: { "stale.txt": "x\n" },
    });
    // Operator-authored: a local-only commit on top of the stale tip, so
    // the ref matches neither origin nor the assigned base's lineage.
    const diverged = f.commitOn(
      "stale",
      "stale: local-only work",
      { "extra.txt": "x\n" },
      { push: false },
    );
    const gate = gateBranchAncestry(f.worktree, "stale", base);
    expect(gate.kind).toBe("blocked");
    if (gate.kind === "blocked") {
      expect(gate.reason).toContain("git branch -D stale");
    }
    expect(f.sha("refs/heads/stale")).toBe(diverged);
    expect(f.sha("origin/stale")).toBe(stale);
  });
});

// ---------------------------------------------------------------------------
// Local-ref lease sync (observed through restackBranch's force-push)
// ---------------------------------------------------------------------------

// A branch built on the initial main, with main since advanced — the
// restack rewrites it, and what happens to the operator's local ref is
// the returned `localRef`.
function leaseFixture(f: Fixture): {
  readonly oldTip: string;
  readonly m1: string;
} {
  const oldTip = f.addBranch("b", "main", {
    message: "b: work",
    files: { "b.txt": "b\n" },
  });
  const m1 = f.commitOn("main", "main: advance", { "advance.txt": "x\n" });
  return { oldTip, m1 };
}

describe("restackBranch: local-ref lease sync", () => {
  it(
    "moves a local ref at exactly the pre-rewrite sha",
    GATED,
    async () => {
      const f = fixture();
      const { oldTip, m1 } = leaseFixture(f);
      const outcome = await restackBranch(f.worktree, "b", "main", m1, f.mainSha);
      expect(outcome.kind).toBe("restacked");
      if (outcome.kind === "restacked") {
        expect(outcome.localRef).toEqual({
          kind: "moved",
          from: oldTip,
          to: outcome.sha,
        });
        expect(f.sha("refs/heads/b")).toBe(outcome.sha);
      }
    },
  );

  it(
    "skips a local ref ahead of the pre-rewrite sha, with the recovery command",
    GATED,
    async () => {
      const f = fixture();
      const { m1 } = leaseFixture(f);
      const ahead = f.commitOn(
        "b",
        "b: operator work",
        { "local.txt": "x\n" },
        { push: false },
      );
      const outcome = await restackBranch(f.worktree, "b", "main", m1, f.mainSha);
      expect(outcome.kind).toBe("restacked");
      if (outcome.kind === "restacked") {
        expect(outcome.localRef).toMatchObject({ kind: "skipped" });
        if (outcome.localRef.kind === "skipped") {
          expect(outcome.localRef.reason).toContain("not the pre-rewrite");
          expect(outcome.localRef.recovery).toContain(
            "git branch -f b origin/b",
          );
        }
      }
      expect(f.sha("refs/heads/b")).toBe(ahead);
    },
  );

  it(
    "skips a checked-out local ref, with the recovery command",
    GATED,
    async () => {
      const f = fixture();
      const { oldTip, m1 } = leaseFixture(f);
      f.git(["switch", "b"]);
      const outcome = await restackBranch(f.worktree, "b", "main", m1, f.mainSha);
      expect(outcome.kind).toBe("restacked");
      if (outcome.kind === "restacked") {
        expect(outcome.localRef).toMatchObject({ kind: "skipped" });
        if (outcome.localRef.kind === "skipped") {
          expect(outcome.localRef.reason).toContain("checked out at");
          expect(outcome.localRef.recovery).toContain("reset --hard origin/b");
        }
      }
      expect(f.sha("refs/heads/b")).toBe(oldTip);
    },
  );

  it(
    "reports absent when the operator has no local ref of that name",
    GATED,
    async () => {
      const f = fixture();
      const { m1 } = leaseFixture(f);
      f.git(["branch", "-D", "b"]);
      const outcome = await restackBranch(f.worktree, "b", "main", m1, f.mainSha);
      expect(outcome.kind).toBe("restacked");
      if (outcome.kind === "restacked") {
        expect(outcome.localRef).toEqual({ kind: "absent" });
      }
    },
  );
});

// ---------------------------------------------------------------------------
// rerere replay
// ---------------------------------------------------------------------------

describe("restackBranch: rerere replay", () => {
  it(
    "auto-resolves a recurring conflict hunk from a recorded resolution, without a resolver attempt",
    GATED,
    async () => {
      const f = fixture();
      const mBase = f.commitOn("main", "main: seed conflict file", {
        "conflict.txt": "base\n",
      });
      const r1Tip = f.addBranch("r1", mBase, {
        message: "r1: take",
        files: { "conflict.txt": "r1 version\n" },
      });
      const r2Tip = f.addBranch("r2", mBase, {
        message: "r2: take",
        files: { "conflict.txt": "r2 version\n" },
        keepLocal: false,
      });

      // Record the resolution the way the run does: an earlier conflicted
      // rebase in the restack worktree, resolved once with rerere
      // enabled, then discarded — only the rr-cache entry survives (it
      // lives in the clone's shared .git, which the worktree shares).
      // These -c flags mirror the unexported RERERE_FLAGS in restack.ts;
      // if that constant changes, this recording must change with it.
      const rr = [
        "-c",
        "rerere.enabled=true",
        "-c",
        "rerere.autoupdate=true",
      ];
      f.git(["switch", "--detach", r2Tip], f.worktree);
      expect(() =>
        f.git([...rr, "rebase", "--onto", r1Tip, mBase], f.worktree),
      ).toThrow();
      writeFileSync(join(f.worktree, "conflict.txt"), "merged resolution\n");
      f.git(["add", "conflict.txt"], f.worktree);
      f.git([...rr, "rebase", "--continue"], f.worktree);
      f.git(["switch", "--detach", f.mainSha], f.worktree);

      // The same hunk conflicts again; rerere replays the recorded
      // resolution and the restack completes as "resolved via rerere".
      // Had the resolver agent been attempted instead, the outcome could
      // not carry via: "rerere" — that value exists only on the path
      // where recorded resolutions alone finished the rebase.
      const outcome = await restackBranch(f.worktree, "r2", "r1", r1Tip, mBase);
      expect(outcome).toMatchObject({ kind: "resolved", via: "rerere" });
      expect(f.git(["show", "origin/r2:conflict.txt"])).toBe(
        "merged resolution",
      );
      expect(f.descends(r1Tip, "origin/r2")).toBe(true);
      expect(f.subjects(`${r1Tip}..origin/r2`)).toEqual(["r2: take"]);
    },
  );
});
