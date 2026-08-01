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
    return { kind: "check-failed", resolvedConflict };
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
