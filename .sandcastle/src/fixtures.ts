// Throwaway git fixtures for the factory's git-surgery specs.
//
// Each fixture is one temp directory holding everything the exported
// git-surgery functions expect of the operator's machine: a bare origin
// repo, an operator clone with `main` checked out, a detached restack
// worktree, and a `.sandcastle/.env` carrying a dummy GH_TOKEN. The
// functions resolve that env file relative to process.cwd(), so the
// fixture chdirs into its root for its lifetime and `dispose()` restores
// the previous cwd. Fixtures also point GIT_CONFIG_GLOBAL/SYSTEM at
// /dev/null for their lifetime, so an operator's global git config
// (gpg signing, rerere, hooks) can never leak into a spec.
//
// The initial commit carries a package.json with a no-op `check` script
// and a matching lockfile, so `restackBranch`'s real gate — npm ci
// --dry-run, npm install, npm run check — runs unmodified against the
// fixture. Pushes go over the file protocol, which never consults a
// credential helper, so the dummy token satisfies the token-presence
// check without any network.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Matches the no-op gate: `npm ci --dry-run` accepts this lockfile, the
// install is instant (no deps), and `check` exits 0.
const PACKAGE_JSON = `${JSON.stringify(
  {
    name: "fixture",
    version: "0.0.0",
    private: true,
    scripts: { check: 'node -e "process.exit(0)"' },
  },
  null,
  2,
)}\n`;
const PACKAGE_LOCK = `${JSON.stringify(
  {
    name: "fixture",
    version: "0.0.0",
    lockfileVersion: 3,
    requires: true,
    packages: { "": { name: "fixture", version: "0.0.0" } },
  },
  null,
  2,
)}\n`;

export interface Fixture {
  /** Fixture root — process.cwd() for the fixture's lifetime. */
  readonly root: string;
  /** Operator clone, `main` checked out. */
  readonly clone: string;
  /** Detached restack worktree linked to the clone. */
  readonly worktree: string;
  /** Sha of origin/main's initial commit. */
  readonly mainSha: string;
  /** Run git in the clone (or `cwd`) and return trimmed stdout. */
  git(args: readonly string[], cwd?: string): string;
  /** Sha of a ref as the clone sees it, or undefined when absent. */
  sha(ref: string): string | undefined;
  /** Commit subjects in `range` (e.g. `base..tip`), oldest first. */
  subjects(range: string): readonly string[];
  /** True when `ancestor` is an ancestor of `descendant`. */
  descends(ancestor: string, descendant: string): boolean;
  /**
   * Create `branch` at `from`, commit `files` on it, push it, and return
   * the new tip sha. The clone ends back on `main`. The local branch ref
   * stays behind (the operator-checkout shape the lease sync works
   * against) unless `keepLocal: false` deletes it after the push.
   */
  addBranch(
    branch: string,
    from: string,
    opts: {
      readonly message: string;
      readonly files: Readonly<Record<string, string>>;
      readonly keepLocal?: boolean;
    },
  ): string;
  /** Commit `files` on an existing branch and return the new tip sha. */
  commitOn(
    branch: string,
    message: string,
    files: Readonly<Record<string, string>>,
    opts?: { readonly push?: boolean },
  ): string;
  /** Restore cwd and env, delete the temp directory. */
  dispose(): void;
}

function write(dir: string, files: Readonly<Record<string, string>>): void {
  for (const [path, content] of Object.entries(files)) {
    const target = join(dir, path);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content);
  }
}

export function createFixture(): Fixture {
  // realpath because macOS tmpdir is a symlink and git prints real paths.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "sandcastle-spec-")));
  const origin = join(root, "origin.git");
  const clone = join(root, "clone");
  const worktree = join(root, "restack");

  const savedCwd = process.cwd();
  const savedEnv = new Map(
    ["GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM"].map(
      (key) => [key, process.env[key]] as const,
    ),
  );
  process.env["GIT_CONFIG_GLOBAL"] = "/dev/null";
  process.env["GIT_CONFIG_SYSTEM"] = "/dev/null";

  const git = (args: readonly string[], cwd: string = clone): string =>
    execFileSync("git", args as string[], { encoding: "utf8", cwd }).trim();

  git(["init", "--bare", "-b", "main", origin], root);
  git(["clone", origin, clone], root);
  // Identity and editor live in the clone's local config, which linked
  // worktrees share — commits made mid-rebase in the restack worktree
  // pick them up too.
  git(["config", "user.name", "Fixture"]);
  git(["config", "user.email", "fixture@example.invalid"]);
  git(["config", "commit.gpgsign", "false"]);
  git(["config", "core.editor", "true"]);

  write(clone, {
    "package.json": PACKAGE_JSON,
    "package-lock.json": PACKAGE_LOCK,
    "seed.txt": "seed\n",
  });
  git(["add", "--all"]);
  git(["commit", "-m", "initial"]);
  git(["push", "origin", "main"]);
  const mainSha = git(["rev-parse", "HEAD"]);

  git(["worktree", "add", "--detach", worktree, mainSha]);

  // The functions under test resolve `.sandcastle/.env` from cwd; the
  // dummy token passes the presence check, and file-protocol pushes
  // never ask for credentials.
  write(root, { ".sandcastle/.env": "GH_TOKEN=fixture-token\n" });
  process.chdir(root);

  const sha = (ref: string): string | undefined => {
    try {
      return git(["rev-parse", "--verify", `${ref}^{commit}`]);
    } catch {
      return undefined;
    }
  };

  return {
    root,
    clone,
    worktree,
    mainSha,
    git,
    sha,
    subjects: (range) => {
      const out = git(["log", "--reverse", "--format=%s", range]);
      return out === "" ? [] : out.split("\n");
    },
    descends: (ancestor, descendant) => {
      try {
        git(["merge-base", "--is-ancestor", ancestor, descendant]);
        return true;
      } catch {
        return false;
      }
    },
    addBranch: (branch, from, { message, files, keepLocal = true }) => {
      git(["switch", "-c", branch, from]);
      write(clone, files);
      git(["add", "--all"]);
      git(["commit", "-m", message]);
      const tip = git(["rev-parse", "HEAD"]);
      git(["push", "origin", branch]);
      git(["switch", "main"]);
      if (!keepLocal) git(["branch", "-D", branch]);
      return tip;
    },
    commitOn: (branch, message, files, { push = true } = {}) => {
      git(["switch", branch]);
      write(clone, files);
      git(["add", "--all"]);
      git(["commit", "-m", message]);
      const tip = git(["rev-parse", "HEAD"]);
      if (push) git(["push", "origin", branch]);
      git(["switch", "main"]);
      return tip;
    },
    dispose: () => {
      process.chdir(savedCwd);
      for (const [key, value] of savedEnv) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(root, { recursive: true, force: true });
    },
  };
}
