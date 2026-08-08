// Captured child execution and the per-run raw log
//
// Every host-side child process (git, npm, gh) runs through here, with
// output captured instead of inherited — the factory's console carries
// only lines the factory chose to print. What the console policy is
// belongs to each call site: expected-failure probes print nothing,
// successful gates collapse to a one-line summary, and a failing gate
// dumps its full captured output via `printChildFailure`. Whatever the
// console shows, the raw output of every child is teed verbatim to one
// per-run log file, so summarization never loses anything.

import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// Shared with the sandcastle library's own sandbox logs; gitignored.
export const LOGS_DIR = ".sandcastle/logs";

let runLog: string | undefined;

// One log per invocation, opened by main.ts before anything spawns.
// Module state rather than a threaded parameter: children run many call
// layers deep (walk → restack → git), and the log is genuinely global to
// the process. Unopened (as in specs), teeing is a no-op.
export function openRunLog(): string {
  mkdirSync(LOGS_DIR, { recursive: true });
  runLog = join(
    LOGS_DIR,
    `run-${new Date().toISOString().replaceAll(":", "-")}.log`,
  );
  appendFileSync(runLog, "");
  return runLog;
}

export function runLogPath(): string | undefined {
  return runLog;
}

function tee(entry: string): void {
  if (runLog === undefined) return;
  appendFileSync(runLog, entry);
}

function logEntry(
  command: string,
  cwd: string | undefined,
  stdout: string,
  stderr: string,
  exit: string | undefined,
): string {
  return (
    `\n$ ${command}${cwd === undefined ? "" : `  (in ${cwd})`}\n` +
    stdout +
    (stdout !== "" && !stdout.endsWith("\n") ? "\n" : "") +
    (stderr === "" ? "" : `--- stderr ---\n`) +
    stderr +
    (stderr !== "" && !stderr.endsWith("\n") ? "\n" : "") +
    (exit === undefined ? "" : `[${exit}]\n`)
  );
}

/** A captured child that exited non-zero, with everything it printed. */
export class ChildFailure extends Error {
  readonly command: string;
  readonly stdout: string;
  readonly stderr: string;

  constructor(command: string, exit: string, stdout: string, stderr: string) {
    // The one-line summary a prune reason or error path can carry; the
    // full output lives on the instance and in the per-run log.
    const headline = stderr
      .split("\n")
      .find((line) => line.trim() !== "");
    super(
      `\`${command}\` ${exit}` +
        (headline === undefined ? "" : `: ${oneLine(headline)}`),
    );
    this.name = "ChildFailure";
    this.command = command;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= 160 ? flat : `${flat.slice(0, 159)}…`;
}

/**
 * Run a child with stdout and stderr captured, tee the raw output to the
 * per-run log, and return trimmed stdout. Throws `ChildFailure` on a
 * non-zero exit; callers decide whether that is an expected probe result
 * (swallow silently) or a real failure (report, with
 * `printChildFailure` when the full output should reach the console).
 */
export function runCaptured(
  file: string,
  args: readonly string[],
  opts: {
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
  } = {},
): string {
  const command = `${file} ${args.join(" ")}`;
  try {
    const stdout = execFileSync(file, args as string[], {
      encoding: "utf8",
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
    tee(logEntry(command, opts.cwd, stdout, "", undefined));
    return stdout.trim();
  } catch (error) {
    const failed = error as {
      stdout?: string;
      stderr?: string;
      status?: number | null;
      signal?: string | null;
      code?: string;
    };
    const stdout = failed.stdout ?? "";
    const stderr = failed.stderr ?? "";
    const exit =
      typeof failed.status === "number"
        ? `exited ${failed.status}`
        : failed.signal != null
          ? `killed by ${failed.signal}`
          : `failed to spawn (${failed.code ?? String(error)})`;
    tee(logEntry(command, opts.cwd, stdout, stderr, exit));
    throw new ChildFailure(command, exit, stdout, stderr);
  }
}

/**
 * Reproduce a failed child's full captured output on the console, plus
 * the per-run log pointer — capture must never make a failure harder to
 * debug, so nothing is summarized on this path. Non-ChildFailure errors
 * print their message; there is no captured output to show.
 */
export function printChildFailure(error: unknown): void {
  if (!(error instanceof ChildFailure)) {
    console.error(error instanceof Error ? error.message : String(error));
    return;
  }
  console.error(`✗ ${error.message}`);
  if (error.stdout.trim() !== "") console.error(error.stdout.trimEnd());
  if (error.stderr.trim() !== "") console.error(error.stderr.trimEnd());
  if (runLog !== undefined) console.error(`(raw child output: ${runLog})`);
}
