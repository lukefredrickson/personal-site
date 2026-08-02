// Restacking: host-side git, the restack worktree, and the resolver agent
//
// Restacking owns raw git for the whole run — every other module talks to
// origin through the named operations exported here, so "restacking owns
// git" is a structural invariant, not a convention. Branch rewrites work
// entirely against origin refs in one detached worktree, and local
// `sandcastle/*` branch refs are owned by the factory: after each
// force-push, a matching local ref follows the rewrite under the same
// lease semantics as the push itself — moved only from exactly the
// pre-rewrite sha, never while checked out — so the operator's checkout
// cannot silently drift from the factory's output, and nothing the
// operator authored is ever overwritten. A conflicting rebase first
// replays any resolution rerere has already recorded, then gets one
// resolver-agent attempt, judged mechanically by the git state it
// leaves behind — never by its own account of success.

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

// rerere remembers each conflict hunk's resolution and replays it when
// the same hunk conflicts again — run 1's failure mode was one resolved
// conflict re-fought by every downstream branch. Enabled per-invocation
// (flags on the host's rebase commands, environment for the resolver
// agent) rather than in any config file, so the operator's own git
// behavior is untouched. The recorded resolutions land in the repo's
// shared rr-cache, which linked worktrees share with the main checkout,
// so a re-run benefits from what this run resolved.
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

// Quiet by default so expected-failure probes (rev-parse on a missing
// branch, merge-base as a boolean) don't spray "fatal:" noise; `show`
// streams output for the operations the operator should watch.
function git(
  args: readonly string[],
  opts: {
    readonly cwd?: string;
    readonly show?: boolean;
    readonly env?: NodeJS.ProcessEnv;
  } = {},
): string {
  const out = execFileSync("git", args as string[], {
    encoding: "utf8",
    cwd: opts.cwd,
    env: opts.env,
    stdio: opts.show ? ["ignore", "inherit", "inherit"] : undefined,
  });
  return typeof out === "string" ? out.trim() : "";
}

// ---------------------------------------------------------------------------
// Push auth: the token from .sandcastle/.env, never operator-machine state
// ---------------------------------------------------------------------------

// Host pushes authenticate explicitly rather than through ambient git
// state (keychain helpers, gh auth, ~/.gitconfig): sandboxes get their
// GH_TOKEN from .sandcastle/.env, and a host that authenticated any
// other way could disagree with them about which token a run uses — or
// work on one machine and die at the first push on another. Only the
// push is authenticated; fetch and the read-only probes stay anonymous
// because the repo is public. If it ever goes private, fetch breaks
// loudly and the authenticated surface widens consciously then.
const ENV_FILE = ".sandcastle/.env";

// Mirror of the sandcastle library's env-file parsing (first `=` splits,
// quotes stripped, double-quote escapes expanded) so host and sandbox
// read the same value from the same line.
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

// Same resolution rule as the library's resolveEnv: the key must appear
// in the file, and an empty file value falls back to the process
// environment. Absent-from-file does not fall back — a token only the
// host could see would let host pushes succeed while sandboxes fail.
function resolveGhToken(): string | undefined {
  const fileVars = parseEnvFile(ENV_FILE);
  if (!("GH_TOKEN" in fileVars)) return undefined;
  const token = fileVars["GH_TOKEN"] || process.env["GH_TOKEN"];
  return token ? token : undefined;
}

// Called by the run command before any sandbox is created, so a run
// that cannot push fails in milliseconds instead of after the build
// phase has already spent its time and tokens.
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

// The helper's shell expands $GH_TOKEN from the child environment at
// push time, so argv carries the literal variable name — the secret
// never appears in a `ps` listing, git config, or on disk outside .env.
const PUSH_CREDENTIAL_HELPER =
  '!f() { echo "username=x-access-token"; echo "password=$GH_TOKEN"; }; f';

// GIT_TERMINAL_PROMPT=0 turns any residual auth gap (expired or
// under-scoped token) into an immediate error instead of an interactive
// prompt no unattended run will answer.
function pushEnv(token: string): NodeJS.ProcessEnv {
  return { ...process.env, GH_TOKEN: token, GIT_TERMINAL_PROMPT: "0" };
}

// The empty credential.helper entry first clears inherited helpers
// (e.g. osxkeychain) so a stale machine credential can't shadow the
// run's token.
function pushToOrigin(worktree: string, args: readonly string[]): void {
  const token = resolveGhToken();
  if (token === undefined) {
    // Preflight guaranteed a token at run start; this catches a .env
    // emptied mid-run.
    throw new Error(`cannot push: GH_TOKEN is missing or empty in ${ENV_FILE}`);
  }
  git(
    [
      "-c",
      "credential.helper=",
      "-c",
      `credential.helper=${PUSH_CREDENTIAL_HELPER}`,
      "push",
      ...args,
    ],
    { cwd: worktree, show: true, env: pushEnv(token) },
  );
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

// rerere's autoupdate stages every hunk it recognizes from an earlier
// resolution, so a conflict stop where nothing is left unmerged needs
// only `rebase --continue`. Each continue can stop again on the next
// commit's conflict, so loop until the rebase finishes or a genuinely
// new hunk remains for the resolver. Terminates: every successful
// continue advances the rebase by at least one commit. Returns true
// when recorded resolutions alone finished the rebase.
function continueRerereResolvedRebase(worktree: string): boolean {
  while (rebaseInProgress(worktree)) {
    if (git(["ls-files", "--unmerged"], { cwd: worktree }) !== "") {
      return false;
    }
    try {
      git(["rebase", "--continue"], {
        cwd: worktree,
        show: true,
        env: rerereEnv({ ...process.env, GIT_EDITOR: "true" }),
      });
    } catch {
      return false;
    }
  }
  return true;
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

// ---------------------------------------------------------------------------
// Local `sandcastle/*` refs: factory-owned, moved only under lease
// ---------------------------------------------------------------------------

// Where refs/heads/<branch> is checked out, if anywhere. `git worktree
// list` covers the operator's main checkout and every linked worktree;
// refs are shared, so asking from the restack worktree sees them all.
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

// After a force-push rewrites origin/<branch>, move the operator's local
// branch of the same name to match — under the same lease semantics as
// the push itself. The local ref must point at exactly the pre-rewrite
// sha (anything else is divergence the operator authored, never
// overwritten) and must not be checked out anywhere (moving it would
// desync that worktree's index from its HEAD). The move is git's own
// compare-and-swap — update-ref asserts the old value — so a concurrent
// move loses loudly, not silently.
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
 * Decide whether a leftover branch may be reused for a step assigned
 * `baseSha` as its base. The sandbox library reuses an existing local
 * branch as-is (fast-forwarding from origin when it can), so a branch
 * inherited from a dead run smuggles pre-restack ancestry into every
 * wave unless it is caught here: a ref that does not descend from the
 * step's assigned base is treated as absent and reset to the base —
 * origin through the normal lease force-push, the local ref through the
 * same compare-and-swap `syncLocalRef` uses. A stale local ref that is
 * checked out, or that matches neither origin nor the base, is operator
 * state; the gate refuses to touch it and the step prunes with the
 * recovery command in its reason.
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
    // Exactly origin's stale tip, or never pushed at all: factory-owned
    // state from a dead run. Reset it to the base so the sandbox
    // rebuilds fresh instead of reusing stale ancestry.
    git(["update-ref", `refs/heads/${branch}`, baseSha, localSha!], {
      cwd: worktree,
    });
    localMove = { from: localSha!, to: baseSha };
    details.push(
      `local ${branch} reset from stale ${localSha!.slice(0, 12)} to its base`,
    );
  }

  if (!originOk) {
    // A healthy local branch is accumulated work — keep it and bring
    // origin to it; otherwise origin resets to the base and the old
    // history is overwritten by this same lease force-push path when
    // the rebuilt branch pushes.
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

// Rebase one branch onto the chain tip, entirely against origin refs;
// the only local ref this can touch is the branch's own, moved after the
// push under `syncLocalRef`'s lease. The rebase is a replay window —
// onto the tip, from `windowSha`, the base sha the branch was actually
// built on — so only commits the branch itself added ever replay. A
// plain rebase replays everything back to the merge-base, and once a
// resolver rewrote a predecessor's commit that broke patch-identity,
// every downstream branch re-fought its conflict. The window can never
// widen the replay: `windowSha` is always an ancestor of `tipSha` (the
// chain grew from it), so the windowed range is a subset of what the
// merge-base rebase would replay — a resumed branch built on an older
// base (its predecessor rewritten since) degrades toward the old
// behavior, never past it. Only a rebase that
// rewrote the branch is gated with `npm run check`: a no-op means this
// exact tree was already gated, in its sandbox on first build or by a
// previous run's restack — that detection is also what makes re-running
// a partially restacked wave safe.
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
      show: true,
    });
  } catch {
    // A conflict stops the rebase mid-flight; anything else (a rebase
    // that died before starting) has no conflict state to resolve.
    // rerere gets the first look — a hunk it recorded earlier in the run
    // resolves for free — and the resolver agent only sees what is left.
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

  // The semantic-drift tripwire: each wave's siblings built blind to each
  // other, so a rebase can apply cleanly yet break the combined tree. The
  // install trues up dependencies an issue may have added. An agent
  // resolution passes the same gate or prunes like any other bad tip.
  try {
    // Lockfile-sync tripwire first: `npm ci --dry-run` proves the
    // committed lockfile can satisfy package.json on every platform — the
    // same test Workers Builds' `npm clean-install` applies per PR. A
    // lockfile regenerated against an installed node_modules tree
    // (npm/cli#4828) silently drops other platforms' optional binaries
    // and fails only in CI; this catches it before anything is pushed.
    execFileSync("npm", ["ci", "--dry-run"], {
      cwd: worktree,
      stdio: ["ignore", "ignore", "inherit"],
    });
    execFileSync("npm", ["install", "--no-audit", "--no-fund"], {
      cwd: worktree,
      stdio: ["ignore", "ignore", "inherit"],
    });
    execFileSync("npm", ["run", "check"], { cwd: worktree, stdio: "inherit" });
  } catch {
    return { kind: "check-failed", resolution };
  } finally {
    // That `npm install` can rewrite the worktree's lockfile with the
    // same #4828 pruning. HEAD is already committed, so the rewrite can
    // never be pushed — but left in place it would dirty the worktree
    // and block the next branch's `git switch`.
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
