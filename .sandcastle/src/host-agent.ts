// Streaming `claude -p` runner for the host-run agents (judgment,
// resolver). Narrates stream-json events as tagged progress lines in a
// per-run .log, tees the raw stream to a sibling .jsonl, and returns
// the final result text. The console carries only start, tail pointer,
// and outcome (ADR 0032). Prompts and allowlists pass through.

import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";
import { LOGS_DIR } from "./exec.ts";
import { say, type Role } from "./render.ts";

const HOST_AGENT_TIMEOUT_MS = 30 * 60 * 1000;

export interface HostAgentOptions {
  /** Tags every progress line and names the log file, e.g. "plan". */
  readonly role: string;
  readonly model: string;
  readonly prompt: string;
  readonly allowedTools: readonly string[];
  readonly disallowedTools: readonly string[];
  /**
   * JSON Schema for the final result. When set, the CLI forces the agent
   * to deliver its answer through a StructuredOutput tool call validated
   * against this schema, and the returned string is that payload as JSON —
   * any prose the agent narrates along the way stays out of the result.
   */
  readonly jsonSchema?: Readonly<Record<string, unknown>>;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
}

// The slice of a stream-json event the formatter reads.
// `parent_tool_use_id` attributes an event to a spawned subagent.
interface StreamBlock {
  readonly type: string;
  readonly id?: string;
  readonly name?: string;
  readonly input?: Readonly<Record<string, unknown>>;
  readonly text?: string;
  readonly tool_use_id?: string;
  readonly content?: unknown;
}

interface StreamEvent {
  readonly type: string;
  readonly subtype?: string;
  readonly model?: string;
  readonly parent_tool_use_id?: string | null;
  readonly message?: { readonly content?: readonly StreamBlock[] };
  readonly is_error?: boolean;
  readonly result?: string;
}

// A Task/Agent tool call spawns a subagent; the spawn line and the
// tool_use-id bookkeeping key off the same test.
function isSubagentSpawn(block: StreamBlock): boolean {
  return (
    block.type === "tool_use" &&
    (block.name === "Task" || block.name === "Agent")
  );
}

// Compress a tool call to its most telling argument.
function toolSummary(input: Readonly<Record<string, unknown>>): string {
  for (const key of ["command", "file_path", "pattern", "description", "prompt", "query"]) {
    const value = input[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return JSON.stringify(input);
}

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= 120 ? flat : `${flat.slice(0, 119)}…`;
}

// A tool_result's content is a string or a list of text blocks.
function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as readonly StreamBlock[])
    .map((block) => (typeof block.text === "string" ? block.text : ""))
    .join(" ");
}

// One line per meaningful event; everything else stays in the raw log.
// Pure: subagent-spawn ids are passed in, not tracked here.
function progressLines(
  event: StreamEvent,
  subagentIds: ReadonlySet<string>,
): string[] {
  if (event.type === "system" && event.subtype === "init") {
    return [`session started (${event.model})`];
  }
  const blocks = event.message?.content ?? [];
  if (event.type === "assistant") {
    // Forwarded subagent text (--forward-subagent-text): the liveness
    // signal while the work is inside a subagent.
    if (event.parent_tool_use_id != null) {
      return blocks.flatMap((block) =>
        block.type === "text" &&
        typeof block.text === "string" &&
        block.text.trim() !== ""
          ? [`  ⤶ subagent: ${oneLine(block.text)}`]
          : [],
      );
    }
    return blocks.flatMap((block) => {
      if (block.type !== "tool_use" || block.name === undefined) return [];
      const summary = oneLine(toolSummary(block.input ?? {}));
      return isSubagentSpawn(block)
        ? [`⤷ subagent spawned: ${summary}`]
        : [`→ ${block.name}: ${summary}`];
    });
  }
  if (event.type === "user" && event.parent_tool_use_id == null) {
    return blocks.flatMap((block) => {
      if (
        block.type !== "tool_result" ||
        block.tool_use_id === undefined ||
        !subagentIds.has(block.tool_use_id)
      ) {
        return [];
      }
      const text = oneLine(toolResultText(block.content));
      // An async subagent acks its launch immediately and reports later
      // as forwarded text; the ack says nothing the spawn line didn't.
      if (text.startsWith("Async agent launched successfully")) return [];
      return [`⤶ subagent reported: ${text}`];
    });
  }
  return [];
}

export async function runHostAgent(opts: HostAgentOptions): Promise<string> {
  mkdirSync(LOGS_DIR, { recursive: true });
  const logBase = join(
    LOGS_DIR,
    `${opts.role}-${new Date().toISOString().replaceAll(":", "-")}`,
  );
  const logFile = `${logBase}.jsonl`;
  const progressFile = `${logBase}.log`;
  const rawLog = createWriteStream(logFile);
  const progressLog = createWriteStream(progressFile);
  const startedAt = Date.now();
  const elapsed = (): string => {
    const total = Math.round((Date.now() - startedAt) / 1000);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  };
  // Play-by-play goes to the tailable log; `announce` is for the few
  // console lines (start, outcome).
  const record = (line: string): void => {
    progressLog.write(`[${elapsed()}] ${line}\n`);
  };
  const announce = (line: string, role: Role): void => {
    record(line);
    say(`  [${opts.role} ${elapsed()}] ${line}`, { role });
  };
  record(`raw event stream → ${logFile}`);
  say(`[${opts.role}] Started (${opts.model})`);
  say(`  tail -f ${progressFile}`, { role: "dim" });

  const child = spawn(
    "claude",
    [
      "-p",
      "--model",
      opts.model,
      "--output-format",
      "stream-json",
      // stream-json in -p mode hard-requires verbose.
      "--verbose",
      "--forward-subagent-text",
      "--allowedTools",
      ...opts.allowedTools,
      "--disallowedTools",
      ...opts.disallowedTools,
      ...(opts.jsonSchema === undefined
        ? []
        : ["--json-schema", JSON.stringify(opts.jsonSchema)]),
    ],
    { cwd: opts.cwd, env: opts.env, stdio: ["pipe", "pipe", "pipe"] },
  );
  child.stdin.write(opts.prompt);
  child.stdin.end();

  const subagentIds = new Set<string>();
  let sessionAnnounced = false;
  let finalEvent: StreamEvent | undefined;
  let buffered = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffered += chunk;
    const lines = buffered.split("\n");
    buffered = lines.pop()!;
    for (const line of lines) {
      if (line.trim() === "") continue;
      rawLog.write(line + "\n");
      let event: StreamEvent;
      try {
        event = JSON.parse(line) as StreamEvent;
      } catch {
        continue; // unparseable lines are still in the raw log
      }
      if (event.type === "result") finalEvent = event;
      // The CLI re-emits the init event mid-run; announce the session
      // once.
      if (event.type === "system" && event.subtype === "init") {
        if (sessionAnnounced) continue;
        sessionAnnounced = true;
      }
      for (const out of progressLines(event, subagentIds)) record(out);
      if (event.parent_tool_use_id == null) {
        for (const block of event.message?.content ?? []) {
          if (isSubagentSpawn(block) && block.id !== undefined) {
            subagentIds.add(block.id);
          }
        }
      }
    }
  });

  // CLI stderr goes to the tailable log, off the console, so a failure
  // reads next to the progress it interrupted.
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    for (const line of chunk.split("\n")) {
      if (line.trim() !== "") record(`[stderr] ${line}`);
    }
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, HOST_AGENT_TIMEOUT_MS);

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  }).finally(() => {
    clearTimeout(timer);
    rawLog.end();
  });
  // Ended after the outcome lines below are written.

  const result = finalEvent;
  if (
    timedOut ||
    exitCode !== 0 ||
    result === undefined ||
    result.is_error === true ||
    typeof result.result !== "string"
  ) {
    const why = timedOut
      ? `timed out after ${HOST_AGENT_TIMEOUT_MS / 60_000} minutes`
      : exitCode !== 0
        ? `exited with code ${exitCode}`
        : `returned an error result: ${oneLine(JSON.stringify(result))}`;
    announce(`✗ failed after ${elapsed()} — ${why}`, "fail");
    progressLog.end();
    throw new Error(`${opts.role} agent ${why} (raw stream: ${logFile})`);
  }
  announce(`✓ finished in ${elapsed()}`, "success");
  progressLog.end();
  return result.result;
}
