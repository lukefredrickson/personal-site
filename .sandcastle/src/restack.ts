// Host-side git: the restack worktree, branch rewrites, and the
// resolver agent. Every other module reaches origin through the named
// operations here, so "restacking owns git" is structural (ADR 0018).
// Local sandcastle/* refs are factory-owned and move only under lease;
// nothing the operator authored is ever overwritten.

import { cpSync, existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, sep } from "node:path";
import { printChildFailure, runCaptured } from "./exec.ts";
import { runHostAgent } from "./host-agent.ts";
import { say } from "./render.ts";

// ---------------------------------------------------------------------------
// Host-side git: the restack worktree
// ---------------------------------------------------------------------------

// One detached worktree serves the run: created fresh, seeded with the
// host's node_modules so `npm run check` runs in it, removed at the end.
const RESTACK_DIR = ".sandcastle/restack";

// rerere replays recorded conflict resolutions (ADR 0018). Enabled
// per-invocation only, so the operator's git config stays untouched.
const RERERE_CONFIG: readonly (readonly [string, string])[] = [
  ["rerere.enabled", "true"],
  ["rerere.autoupdate", "true"],
];
const RERERE_FLAGS = RERERE_CONFIG.flatMap(([key, value]) => [
  "-c",
  `${key}=${value}`,
]);
function rerereEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...base,
    GIT_CONFIG_COUNT: String(RERERE_CONFIG.length),
  };
  RERERE_CONFIG.forEach(([key, value], i) => {
    env[`GIT_CONFIG_KEY_${i}`] = key;
    env[`GIT_CONFIG_VALUE_${i}`] = value;
  });
  return env;
}

// Captured, so expected-failure probes print no "fatal:" chatter. Raw
// output still reaches the per-run log via runCaptured's tee.
function git(
  args: readonly string[],
  opts: {
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
  } = {},
): string {
  return runCaptured("git", args, opts);
}

// ---------------------------------------------------------------------------
// Push auth: the token from .sandcastle/.env, never operator-machine state
// ---------------------------------------------------------------------------

// Host pushes authenticate from .sandcastle/.env only — the token the
// sandboxes use, never ambient git state. Reads stay anonymous: the
// repo is public.
const ENV_FILE = ".sandcastle/.env";

// Mirrors the sandcastle library's env-file parsing, so host and
// sandbox read the same value from the same line.
function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const vars: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    const doubleQuoted = value.startsWith('"') && value.endsWith('"');
    const singleQuoted = value.startsWith("'") && value.endsWith("'");
    if (value.length >= 2 && (doubleQuoted || singleQuoted)) {
      value = value.slice(1, -1);
      if (doubleQuoted) {
        value = value.replace(
          /\\([nrt\\])/g,
          (_, ch: string) =>
            ({ n: "\n", r: "\r", t: "\t", "\\": "\\" })[ch] ?? ch,
        );
      }
    }
    vars[key] = value;
  }
  return vars;
}

// Same resolution rule as the library's resolveEnv. Absent-from-file
// never falls back: a host-only token would let host pushes pass while
// sandboxes fail.
function resolveGhToken(): string | undefined {
  const fileVars = parseEnvFile(ENV_FILE);
  if (!("GH_TOKEN" in fileVars)) return undefined;
  const token = fileVars["GH_TOKEN"] || process.env["GH_TOKEN"];
  return token ? token : undefined;
}

// Called before any sandbox is created, so a run that cannot push
// fails in milliseconds, not after the build phase spent its tokens.
export function preflightGhToken(): void {
  if (resolveGhToken() === undefined) {
    throw new Error(
      `GH_TOKEN is missing or empty in ${ENV_FILE} — host restack pushes ` +
        `and sandbox GitHub access both authenticate with it. Set ` +
        `GH_TOKEN=<fine-grained PAT> in ${ENV_FILE}, or leave its value ` +
        `empty there and export GH_TOKEN in the environment.`,
    );
  }
}

// The helper's shell expands $GH_TOKEN at push time; argv carries the
// literal name, so the secret never reaches a ps listing or git config.
const PUSH_CREDENTIAL_HELPER =
  '!f() { echo "username=x-access-token"; echo "password=$GH_TOKEN"; }; f';

// GIT_TERMINAL_PROMPT=0 turns an auth gap into an immediate error, not
// a prompt an unattended run cannot answer.
function pushEnv(token: string): NodeJS.ProcessEnv {
  return { ...process.env, GH_TOKEN: token, GIT_TERMINAL_PROMPT: "0" };
}

// The empty credential.helper entry clears inherited helpers, so a
// stale machine credential cannot shadow the run's token.
function pushToOrigin(worktree: string, args: readonly string[]): void {
  const token = resolveGhToken();
  if (token === undefined) {
    // Preflight guaranteed a token at run start; this catches a .env
    // emptied mid-run.
    throw new Error(`cannot push: GH_TOKEN is missing or empty in ${ENV_FILE}`);
  }
  try {
    git(
      [
        "-c",
        "credential.helper=",
        "-c",
        `credential.helper=${PUSH_CREDENTIAL_HELPER}`,
        "push",
        ...args,
      ],
      { cwd: worktree, env: pushEnv(token) },
    );
  } catch (error) {
    // Callers turn this into a prune with a one-line reason, so the
    // full captured output must reach the console here or nowhere.
    printChildFailure(error);
    throw error;
  }
}

export function createRestackWorktree(): string {
  // A dead run can leave the worktree behind; recreate it so this run
  // inherits no stale state.
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

// Make the worktree's origin refs current: once up front for the
// trunks, again after each build phase pushes new branches.
export function fetchOrigin(worktree: string): void {
  git(["fetch", "origin"], { cwd: worktree });
}

// Resolve origin/<branch> to its sha; throws if the branch is unpushed.
export function resolveOriginTip(worktree: string, branch: string): string {
  return git(["rev-parse", "--verify", `origin/${branch}`], { cwd: worktree });
}

// True when origin/<branch> resolves in the worktree's fetched refs.
export function originBranchExists(worktree: string, branch: string): boolean {
  return resolveRef(worktree, `refs/remotes/origin/${branch}`) !== undefined;
}

// Where the sandbox library puts its worktrees, relative to cwd. A dead
// run can leak one still holding its branch (#170).
const SANDBOX_WORKTREES_DIR = ".sandcastle/worktrees";

// Remove a dead run's sandbox worktree that holds `branch`, so the
// branch delete does not refuse. Dead-run state is untrusted
// (ADR 0034). A worktree outside the sandbox directory is operator
// state; the guard does not touch it.
function reclaimDeadSandboxWorktree(worktree: string, branch: string): void {
  const checkout = checkedOutAt(worktree, branch);
  if (checkout === undefined) return;
  let root: string;
  try {
    // realpath matches git's printed paths under a symlinked cwd.
    root = realpathSync(SANDBOX_WORKTREES_DIR);
  } catch {
    return;
  }
  if (!checkout.startsWith(root + sep)) return;
  git(["worktree", "remove", "--force", checkout], { cwd: worktree });
}

// Delete a stale branch everywhere the factory owns it: local ref
// first — git refuses to delete a checked-out branch, and that refusal
// must abort before origin is touched (ADR 0034).
export function deleteStaleBranch(worktree: string, branch: string): void {
  if (resolveRef(worktree, `refs/heads/${branch}`) !== undefined) {
    reclaimDeadSandboxWorktree(worktree, branch);
    git(["branch", "-D", branch], { cwd: worktree });
  }
  if (originBranchExists(worktree, branch)) {
    pushToOrigin(worktree, ["origin", "--delete", branch]);
  }
}

/** How a conflicted rebase got finished without pruning. */
export type ConflictResolution = "rerere" | "agent";

/**
 * What happened to the operator's local branch after a force-push: no
 * local ref of that name, moved to follow the rewrite, or left alone
 * with the reason and the exact recovery command.
 */
export type LocalRefSync =
  | { readonly kind: "absent" }
  | { readonly kind: "moved"; readonly from: string; readonly to: string }
  | {
      readonly kind: "skipped";
      readonly reason: string;
      readonly recovery: string;
    };

export type RestackOutcome =
  /** Branch already chains from the tip; nothing rewritten. */
  | { readonly kind: "noop"; readonly sha: string }
  /** Rebased, check passed, force-pushed. */
  | {
      readonly kind: "restacked";
      readonly sha: string;
      readonly localRef: LocalRefSync;
    }
  /** Rebase conflicted; rerere or the resolver finished it, same gate, pushed. */
  | {
      readonly kind: "resolved";
      readonly sha: string;
      readonly via: ConflictResolution;
      readonly localRef: LocalRefSync;
    }
  | { readonly kind: "unpushed" }
  /** Unresolved; `reason` completes the clause "rebase onto <tip> …". */
  | { readonly kind: "conflict"; readonly reason: string }
  /** `resolution` records what finished the rebase before the check failed. */
  | {
      readonly kind: "check-failed";
      readonly resolution: "none" | ConflictResolution;
    };

// ---------------------------------------------------------------------------
// The resolver agent: one attempt on the in-progress rebase
// ---------------------------------------------------------------------------

const RESOLVE_PROMPT_FILE = ".sandcastle/prompts/resolve-prompt.md";

function rebaseInProgress(worktree: string): boolean {
  return ["rebase-merge", "rebase-apply"].some((dir) => {
    const path = git(["rev-parse", "--git-path", dir], { cwd: worktree });
    return existsSync(isAbsolute(path) ? path : join(worktree, path));
  });
}

// The resolver runs on the host, in the restack worktree — the
// in-progress rebase state exists only there (ADR 0018). The -p
// allowlist contains it: it can drive the rebase but cannot push,
// abort, or skip. GIT_EDITOR=true keeps --continue from opening an
// editor. The caller judges the git state; the agent's own account of
// success never counts.
async function runResolverAgent(
  worktree: string,
  branch: string,
  tipName: string,
): Promise<void> {
  const prompt = readFileSync(RESOLVE_PROMPT_FILE, "utf8")
    .replaceAll("{{BRANCH}}", branch)
    .replaceAll("{{TIP}}", tipName);
  // Role carries the full branch, so this step's progress lines and
  // log file stay attributable when stacks interleave.
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
      "Bash(git checkout --ours:*)",
      "Bash(git restore:*)",
      "Bash(git rebase --continue)",
      "Bash(git commit --amend:*)",
      "Bash(npm install:*)",
      "Bash(npm ci --dry-run)",
      "Bash(npm run check:*)",
    ],
    disallowedTools: [
      "Bash(git rebase --abort)",
      "Bash(git rebase --skip)",
      "Bash(git push:*)",
    ],
    cwd: worktree,
    env: rerereEnv({ ...process.env, GIT_EDITOR: "true" }),
  });
}

// rerere's autoupdate stages every hunk it recognizes, so a stop with
// nothing unmerged needs only `rebase --continue`. Each continue can
// stop on the next commit's conflict, so loop. Returns true when
// recorded resolutions alone finished the rebase.
function continueRerereResolvedRebase(worktree: string): boolean {
  while (rebaseInProgress(worktree)) {
    if (git(["ls-files", "--unmerged"], { cwd: worktree }) !== "") {
      return false;
    }
    try {
      git(["rebase", "--continue"], {
        cwd: worktree,
        env: rerereEnv({ ...process.env, GIT_EDITOR: "true" }),
      });
    } catch {
      return false;
    }
  }
  return true;
}

// One attempt, judged mechanically: undefined when the rebase
// finished, the tree is clean, and HEAD descends from the tip; a
// reason string otherwise. The caller runs the check gate — every
// rewritten tip gates the same way.
async function attemptResolution(
  worktree: string,
  branch: string,
  tipName: string,
  tipSha: string,
): Promise<string | undefined> {
  say(
    `\n↻ ${branch}: rebase onto ${tipName} conflicted — giving the ` +
      `resolver agent (claude-opus-5) one attempt before pruning…`,
    { role: "warn" },
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

// Reset the worktree to a clean detached HEAD so the prune is the only
// trace. Nothing was pushed on any failure path, so origin still holds
// the pre-restack branch.
function abandonRebase(worktree: string, originSha: string): void {
  try {
    git(["rebase", "--abort"], { cwd: worktree });
  } catch {
    // No rebase in progress — it died before starting or was completed.
  }
  git(["switch", "--force", "--detach", originSha], { cwd: worktree });
  git(["clean", "-fd"], { cwd: worktree });
}

// ---------------------------------------------------------------------------
// Local `sandcastle/*` refs: factory-owned, moved only under lease
// ---------------------------------------------------------------------------

// Where refs/heads/<branch> is checked out, if anywhere. Refs are
// shared, so asking from the restack worktree sees every worktree.
function checkedOutAt(worktree: string, branch: string): string | undefined {
  let path: string | undefined;
  for (const line of git(["worktree", "list", "--porcelain"], {
    cwd: worktree,
  }).split("\n")) {
    if (line.startsWith("worktree ")) {
      path = line.slice("worktree ".length);
    } else if (line === `branch refs/heads/${branch}`) {
      return path;
    }
  }
  return undefined;
}

function resolveRef(worktree: string, ref: string): string | undefined {
  try {
    return git(["rev-parse", "--verify", ref], { cwd: worktree });
  } catch {
    return undefined;
  }
}

// After a force-push, move the matching local ref under the same lease
// semantics as the push (ADR 0018): only from exactly the pre-rewrite
// sha, never while checked out. update-ref asserts the old value, so a
// concurrent move loses loudly.
function syncLocalRef(
  worktree: string,
  branch: string,
  preRewriteSha: string,
  newSha: string,
): LocalRefSync {
  const localSha = resolveRef(worktree, `refs/heads/${branch}`);
  if (localSha === undefined) return { kind: "absent" };
  const recovery = `git fetch origin && git branch -f ${branch} origin/${branch}`;
  if (localSha !== preRewriteSha) {
    return {
      kind: "skipped",
      reason:
        `local ${branch} is at ${localSha.slice(0, 12)}, not the ` +
        `pre-rewrite ${preRewriteSha.slice(0, 12)}`,
      recovery: `${recovery} (only if that divergence is not work you meant to keep)`,
    };
  }
  const checkout = checkedOutAt(worktree, branch);
  if (checkout !== undefined) {
    return {
      kind: "skipped",
      reason: `local ${branch} is checked out at ${checkout}`,
      recovery: `git -C ${checkout} fetch origin && git -C ${checkout} reset --hard origin/${branch}`,
    };
  }
  try {
    git(["update-ref", `refs/heads/${branch}`, newSha, localSha], {
      cwd: worktree,
    });
  } catch {
    return {
      kind: "skipped",
      reason: `the compare-and-swap on refs/heads/${branch} failed`,
      recovery,
    };
  }
  return { kind: "moved", from: localSha, to: newSha };
}

// ---------------------------------------------------------------------------
// The resume ancestry gate: stale leftover branches rebuild, never reuse
// ---------------------------------------------------------------------------

export type BranchGate =
  /** Absent, or every existing ref descends from the base — reuse is safe. */
  | { readonly kind: "clean" }
  /** Stale refs were reset so the sandbox rebuilds from the correct base. */
  | {
      readonly kind: "rebuilt";
      readonly details: readonly string[];
      /** The local-ref reset, if one happened — audited like any move. */
      readonly localMove?: { readonly from: string; readonly to: string };
    }
  /** Stale, but resetting would touch operator state — the step prunes. */
  | { readonly kind: "blocked"; readonly reason: string };

/**
 * Decide whether a leftover branch may be reused for a step based on
 * `baseSha` (ADR 0018). The sandbox library reuses an existing branch
 * as-is, so a ref that does not descend from the base resets to it —
 * origin under lease, the local ref via compare-and-swap. A checked-out
 * or diverged local ref is operator state: the gate refuses to touch
 * it and the step prunes with the recovery command in its reason.
 */
export function gateBranchAncestry(
  worktree: string,
  branch: string,
  baseSha: string,
): BranchGate {
  const descends = (sha: string): boolean => {
    try {
      git(["merge-base", "--is-ancestor", baseSha, sha], { cwd: worktree });
      return true;
    } catch {
      return false;
    }
  };
  const originSha = resolveRef(worktree, `refs/remotes/origin/${branch}`);
  const localSha = resolveRef(worktree, `refs/heads/${branch}`);
  const originOk = originSha === undefined || descends(originSha);
  const localOk = localSha === undefined || descends(localSha);
  if (originOk && localOk) return { kind: "clean" };

  const details: string[] = [];
  let localMove: { from: string; to: string } | undefined;

  // The local ref first — it is what the sandbox worktree would reuse.
  if (!localOk) {
    const checkout = checkedOutAt(worktree, branch);
    if (checkout !== undefined) {
      return {
        kind: "blocked",
        reason:
          `stale ${branch} (does not descend from its assigned base) is ` +
          `checked out at ${checkout} — detach it ` +
          `(git -C ${checkout} switch --detach) and re-run`,
      };
    }
    if (originSha !== undefined && localSha !== originSha) {
      return {
        kind: "blocked",
        reason:
          `local ${branch} at ${localSha!.slice(0, 12)} neither descends ` +
          `from its assigned base nor matches origin — delete it ` +
          `(git branch -D ${branch}) if it is not work you meant to keep, ` +
          `then re-run`,
      };
    }
    // Exactly origin's stale tip, or never pushed: factory-owned state
    // from a dead run. Reset to the base so the sandbox rebuilds fresh.
    git(["update-ref", `refs/heads/${branch}`, baseSha, localSha!], {
      cwd: worktree,
    });
    localMove = { from: localSha!, to: baseSha };
    details.push(
      `local ${branch} reset from stale ${localSha!.slice(0, 12)} to its base`,
    );
  }

  if (!originOk) {
    // A healthy local branch is accumulated work: keep it and bring
    // origin to it. Otherwise origin resets to the base.
    const target = localOk && localSha !== undefined ? localSha : baseSha;
    pushToOrigin(worktree, [
      `--force-with-lease=refs/heads/${branch}:${originSha}`,
      "origin",
      `${target}:refs/heads/${branch}`,
    ]);
    details.push(
      `origin/${branch} reset from stale ${originSha!.slice(0, 12)} to ` +
        (target === baseSha ? "its base" : "the local branch"),
    );
  }
  return { kind: "rebuilt", details, localMove };
}

// Rebase one branch onto the chain tip, entirely against origin refs.
// The rebase is a replay window — onto the tip, from `windowSha` — so
// only commits the branch itself added replay; `windowSha` is always
// an ancestor of `tipSha`, so the window never widens the replay
// (ADR 0018). Only a rewrite gates with `npm run check`: a no-op tree
// was already gated, which also makes re-running a partial wave safe.
export async function restackBranch(
  worktree: string,
  branch: string,
  tipName: string,
  tipSha: string,
  windowSha: string,
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
  let resolution: "none" | ConflictResolution = "none";
  try {
    git([...RERERE_FLAGS, "rebase", "--onto", tipSha, windowSha], {
      cwd: worktree,
    });
  } catch {
    // A conflict leaves the rebase in progress; anything else leaves no
    // state to resolve. rerere looks first; the resolver sees the rest.
    if (!rebaseInProgress(worktree)) {
      abandonRebase(worktree, originSha);
      return {
        kind: "conflict",
        reason: "failed without leaving a conflict the resolver could work on",
      };
    }
    if (continueRerereResolvedRebase(worktree)) {
      resolution = "rerere";
    } else {
      const failure = await attemptResolution(worktree, branch, tipName, tipSha);
      if (failure !== undefined) {
        abandonRebase(worktree, originSha);
        return { kind: "conflict", reason: failure };
      }
      resolution = "agent";
    }
  }
  const sha = git(["rev-parse", "HEAD"], { cwd: worktree });

  // The semantic-drift tripwire (ADR 0018): siblings build without
  // sight of each other, so a clean rebase can still break the tree.
  try {
    // `npm ci --dry-run` proves the lockfile satisfies package.json on
    // every platform — it catches npm/cli#4828 pruning before any push.
    for (const gate of [
      ["ci", "--dry-run"],
      ["install", "--no-audit", "--no-fund"],
      ["run", "check"],
    ] as const) {
      runCaptured("npm", gate, { cwd: worktree });
      say(`  · ${branch}: npm ${gate.join(" ")} passed`, { role: "dim" });
    }
  } catch (error) {
    printChildFailure(error);
    return { kind: "check-failed", resolution };
  } finally {
    // That `npm install` can rewrite the lockfile with the same #4828
    // pruning; left in place it would block the next `git switch`.
    git(["checkout", "--", "package-lock.json"], { cwd: worktree });
  }

  pushToOrigin(worktree, [
    `--force-with-lease=refs/heads/${branch}:${originSha}`,
    "origin",
    `HEAD:refs/heads/${branch}`,
  ]);
  const localRef = syncLocalRef(worktree, branch, originSha, sha);
  return resolution === "none"
    ? { kind: "restacked", sha, localRef }
    : { kind: "resolved", sha, via: resolution, localRef };
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
