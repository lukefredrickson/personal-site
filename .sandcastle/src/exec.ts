// Captured child execution and the per-run raw log. Every host child
// (git, npm, gh) runs through here with output captured; console policy
// belongs to the call sites. Raw output tees verbatim to one per-run
// log, so summarization never loses anything (ADR 0032).

import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { sayError } from "./render.ts";

// Shared with the sandcastle library's own sandbox logs; gitignored.
export const LOGS_DIR = ".sandcastle/logs";

let runLog: string | undefined;

// Module state, not a threaded parameter: children run many call
// layers deep and the log is global to the process. Unopened, as in
// specs, teeing is a no-op.
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
    // The one-line summary a prune reason can carry; the full output
    // lives on the instance and in the per-run log.
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
 * Run a child with output captured, tee the raw output to the per-run
 * log, and return trimmed stdout. Throws `ChildFailure` on a non-zero
 * exit; callers decide probe (swallow) or real failure (report).
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
 * Reproduce a failed child's full captured output on the console —
 * capture must never make a failure harder to debug. Non-ChildFailure
 * errors print their message; there is no captured output to show.
 */
export function printChildFailure(error: unknown): void {
  if (!(error instanceof ChildFailure)) {
    sayError(error instanceof Error ? error.message : String(error), {
      role: "fail",
    });
    return;
  }
  sayError(`✗ ${error.message}`, { role: "fail" });
  if (error.stdout.trim() !== "") sayError(error.stdout.trimEnd());
  if (error.stderr.trim() !== "") sayError(error.stderr.trimEnd());
  if (runLog !== undefined) {
    sayError(`(raw child output: ${runLog})`, { role: "dim" });
  }
}
