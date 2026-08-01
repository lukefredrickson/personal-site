// Restacking: host-side git, the restack worktree, and the resolver agent
//
// Restacking owns raw git for the whole run — every other module talks to
// origin through the named operations exported here, so "restacking owns
// git" is a structural invariant, not a convention. Branch rewrites work
// entirely against origin refs in one detached worktree: local branch
// names are never created or moved, so nothing here can collide with the
// operator's checkouts or need undoing on failure. A conflicting rebase
// gets one resolver-agent attempt, judged mechanically by the git state
// it leaves behind — never by its own account of success.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { runHostAgent } from "./host-agent.ts";

// ---------------------------------------------------------------------------
// Host-side git: the restack worktree
// ---------------------------------------------------------------------------

// Restacking rewrites branches with plain git, and git needs a working
// tree that is not the operator's checkout. One detached worktree serves
// the whole run; it is created fresh, seeded with the host's node_modules
// so `npm run check` can run in it, and removed at the end.
const RESTACK_DIR = ".sandcastle/restack";

// Quiet by default so expected-failure probes (rev-parse on a missing
// branch, merge-base as a boolean) don't spray "fatal:" noise; `show`
// streams output for the operations the operator should watch.
function git(
  args: readonly string[],
  opts: { readonly cwd?: string; readonly show?: boolean } = {},
): string {
  const out = execFileSync("git", args as string[], {
    encoding: "utf8",
    cwd: opts.cwd,
    stdio: opts.show ? ["ignore", "inherit", "inherit"] : undefined,
  });
  return typeof out === "string" ? out.trim() : "";
}

export function createRestackWorktree(): string {
  // A dead run can leave the worktree behind; recreate it from scratch so
  // this run never inherits stale state.
  removeRestackWorktree();
  git(["worktree", "add", "--detach", RESTACK_DIR]);
  cpSync("node_modules", join(RESTACK_DIR, "node_modules"), {
    recursive: true,
  });
  return RESTACK_DIR;
}

export function removeRestackWorktree(): void {
  try {
    git(["worktree", "remove", "--force", RESTACK_DIR]);
  } catch {
    // Nothing to remove — the common case.
  }
}

// Make the worktree's origin refs current — the walk calls this once up
// front to resolve every stack's trunk, and again after each build phase
// pushes new branches.
export function fetchOrigin(worktree: string): void {
  git(["fetch", "origin"], { cwd: worktree });
}

// Resolve origin/<branch> to its sha; throws if the branch is unpushed.
export function resolveOriginTip(worktree: string, branch: string): string {
  return git(["rev-parse", "--verify", `origin/${branch}`], { cwd: worktree });
}

export type RestackOutcome =
  /** Branch already chains from the tip; nothing rewritten. */
  | { readonly kind: "noop"; readonly sha: string }
  /** Rebased, check passed, force-pushed. */
  | { readonly kind: "restacked"; readonly sha: string }
  /** Rebase conflicted; the resolver agent finished it, same gate, pushed. */
  | { readonly kind: "resolved"; readonly sha: string }
  | { readonly kind: "unpushed" }
  /** Unresolved; `reason` completes the clause "rebase onto <tip> …". */
  | { readonly kind: "conflict"; readonly reason: string }
  /** `resolvedConflict` marks a check failure after an agent resolution. */
  | { readonly kind: "check-failed"; readonly resolvedConflict: boolean };

// ---------------------------------------------------------------------------
// The resolver agent: one attempt on the in-progress rebase
// ---------------------------------------------------------------------------

const RESOLVE_PROMPT_FILE = ".sandcastle/resolve-prompt.md";

function rebaseInProgress(worktree: string): boolean {
  return ["rebase-merge", "rebase-apply"].some((dir) => {
    const path = git(["rev-parse", "--git-path", dir], { cwd: worktree });
    return existsSync(isAbsolute(path) ? path : join(worktree, path));
  });
}

// The resolver runs on the host, in the restack worktree, because the
// in-progress rebase state exists only there — a fresh sandbox would have
// to redo the rebase and self-certify the result. Containment is the same
// mechanism as the planning agent's: in -p mode every tool call outside
// --allowedTools is auto-denied, so it can edit files and drive the rebase
// forward but cannot push, abort, or skip commits. GIT_EDITOR=true keeps
// `git rebase --continue` from opening an editor. Success is never taken
// from the agent's output — the caller judges the git state afterward and
// runs the check gate itself.
async function runResolverAgent(
  worktree: string,
  branch: string,
  tipName: string,
): Promise<void> {
  const prompt = readFileSync(RESOLVE_PROMPT_FILE, "utf8")
    .replaceAll("{{BRANCH}}", branch)
    .replaceAll("{{TIP}}", tipName);
  // Role carries the full branch — the tag every other log line for this
  // step uses — keeping this run's progress lines and log file
  // attributable when stacks interleave.
  await runHostAgent({
    role: `resolve-${branch.replaceAll("/", "-")}`,
    model: "claude-opus-5",
    prompt,
    allowedTools: [
      "Read",
      "Glob",
      "Grep",
      "Edit",
      "Write",
      "Bash(git status:*)",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(git show:*)",
      "Bash(git add:*)",
      "Bash(git rebase --continue)",
      "Bash(git commit --amend:*)",
      "Bash(npm install:*)",
      "Bash(npm run check:*)",
    ],
    disallowedTools: [
      "Bash(git rebase --abort)",
      "Bash(git rebase --skip)",
      "Bash(git push:*)",
    ],
    cwd: worktree,
    env: { ...process.env, GIT_EDITOR: "true" },
  });
}

// One attempt, judged mechanically. Returns undefined when the worktree
// holds a plausible resolution — rebase finished, tree clean, HEAD
// descends from the tip — and a reason string otherwise. The check gate
// is not run here: the caller gates every rewritten tip the same way,
// resolved or not.
async function attemptResolution(
  worktree: string,
  branch: string,
  tipName: string,
  tipSha: string,
): Promise<string | undefined> {
  console.log(
    `\n↻ ${branch}: rebase onto ${tipName} conflicted — giving the ` +
      `resolver agent (claude-opus-5) one attempt before pruning…`,
  );
  try {
    await runResolverAgent(worktree, branch, tipName);
  } catch (error) {
    return `conflicted and the resolver agent failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (rebaseInProgress(worktree)) {
    return "conflicted and the resolver could not finish the rebase";
  }
  if (git(["status", "--porcelain"], { cwd: worktree }) !== "") {
    return "conflicted and the resolver left uncommitted changes";
  }
  try {
    git(["merge-base", "--is-ancestor", tipSha, "HEAD"], { cwd: worktree });
  } catch {
    return "conflicted and the resolver's result does not descend from the chain tip";
  }
  return undefined;
}

// Whatever a failed rebase or resolution left behind, put the worktree
// back to a clean detached HEAD so the branch's prune is the only trace.
// Nothing was pushed on any failure path, so origin still holds the
// pre-restack branch — there is no half-resolved state to undo remotely.
function abandonRebase(worktree: string, originSha: string): void {
  try {
    git(["rebase", "--abort"], { cwd: worktree });
  } catch {
    // No rebase in progress — it died before starting or was completed.
  }
  git(["switch", "--force", "--detach", originSha], { cwd: worktree });
  git(["clean", "-fd"], { cwd: worktree });
}

// Rebase one branch onto the chain tip, entirely against origin refs —
// local branch names are never created or moved, so nothing here can
// collide with the operator's checkouts or need undoing on failure. Only
// a rebase that rewrote the branch is gated with `npm run check`: a no-op
// means this exact tree was already gated, in its sandbox on first build
// or by a previous run's restack — that detection is also what makes
// re-running a partially restacked wave safe.
export async function restackBranch(
  worktree: string,
  branch: string,
  tipName: string,
  tipSha: string,
): Promise<RestackOutcome> {
  let originSha: string;
  try {
    originSha = resolveOriginTip(worktree, branch);
  } catch {
    return { kind: "unpushed" };
  }

  try {
    git(["merge-base", "--is-ancestor", tipSha, originSha], { cwd: worktree });
    return { kind: "noop", sha: originSha };
  } catch {
    // Not an ancestor — the branch really needs rebasing.
  }

  git(["switch", "--detach", originSha], { cwd: worktree });
  let resolvedConflict = false;
  try {
    git(["rebase", tipSha], { cwd: worktree, show: true });
  } catch {
    // A conflict stops the rebase mid-flight; anything else (a rebase
    // that died before starting) has no conflict state to resolve.
    const failure = rebaseInProgress(worktree)
      ? await attemptResolution(worktree, branch, tipName, tipSha)
      : "failed without leaving a conflict the resolver could work on";
    if (failure !== undefined) {
      abandonRebase(worktree, originSha);
      return { kind: "conflict", reason: failure };
    }
    resolvedConflict = true;
  }
  const sha = git(["rev-parse", "HEAD"], { cwd: worktree });

  // The semantic-drift tripwire: each wave's siblings built blind to each
  // other, so a rebase can apply cleanly yet break the combined tree. The
  // install trues up dependencies an issue may have added. An agent
  // resolution passes the same gate or prunes like any other bad tip.
  try {
    execFileSync("npm", ["install", "--no-audit", "--no-fund"], {
      cwd: worktree,
      stdio: ["ignore", "ignore", "inherit"],
    });
    execFileSync("npm", ["run", "check"], { cwd: worktree, stdio: "inherit" });
  } catch {
    return { kind: "check-failed", resolvedConflict };
  }

  git(
    [
      "push",
      `--force-with-lease=refs/heads/${branch}:${originSha}`,
      "origin",
      `HEAD:refs/heads/${branch}`,
    ],
    { cwd: worktree, show: true },
  );
  return { kind: resolvedConflict ? "resolved" : "restacked", sha };
}

// True if origin/<inner>'s tip is an ancestor of origin/<outer> — outer's
// history carries inner's commits. False when either branch is unpushed.
export function branchCarries(
  worktree: string,
  outer: string,
  inner: string,
): boolean {
  try {
    git(
      [
        "merge-base",
        "--is-ancestor",
        resolveOriginTip(worktree, inner),
        resolveOriginTip(worktree, outer),
      ],
      { cwd: worktree },
    );
    return true;
  } catch {
    return false;
  }
}
