import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";

import type { RuntimeEvent } from "./contracts.ts";

export const THREAD_INSPECTOR_DEFAULT_LIMIT = 160;
export const THREAD_INSPECTOR_MAX_LIMIT = 400;
const MAX_TAIL_BYTES = 4 * 1024 * 1024;
const MAX_DETAIL_BYTES = 8 * 1024;
const MAX_STRING = 4_096;

export interface RuntimeInspectorEntry {
  kind: "runtime";
  at: string;
  type: RuntimeEvent["type"];
  provider: string;
  providerInstanceId?: string;
  summary: string;
  detail: Record<string, unknown>;
}

export interface NativeInspectorEntry {
  kind: "native";
  at: string;
  dir: "in" | "out";
  source: string;
  payload: unknown;
  payloadTruncated: boolean;
}

export interface ThreadInspectorSnapshot {
  runtime: RuntimeInspectorEntry[];
  native: NativeInspectorEntry[];
  hasEarlier: { runtime: boolean; native: boolean };
}

interface NativeRecord {
  at: string;
  dir: "in" | "out";
  source: string;
  msg: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertThreadId(threadId: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(threadId)) {
    throw Object.assign(new Error("invalid thread id"), { status: 400 });
  }
}

function inspectorLimit(value: number | undefined): number {
  if (value === undefined) return THREAD_INSPECTOR_DEFAULT_LIMIT;
  if (!Number.isFinite(value)) return THREAD_INSPECTOR_DEFAULT_LIMIT;
  return Math.max(1, Math.min(Math.trunc(value), THREAD_INSPECTOR_MAX_LIMIT));
}

function tailText(file: string): { text: string; truncatedAtStart: boolean } {
  let fd: number;
  try {
    fd = openSync(file, "r");
  } catch {
    return { text: "", truncatedAtStart: false };
  }
  try {
    const stat = fstatSync(fd);
    const start = Math.max(0, stat.size - MAX_TAIL_BYTES);
    const length = stat.size - start;
    if (length <= 0) return { text: "", truncatedAtStart: false };
    const buffer = Buffer.allocUnsafe(length);
    let offset = 0;
    while (offset < length) {
      const read = readSync(fd, buffer, offset, length - offset, start + offset);
      if (read <= 0) break;
      offset += read;
    }
    let text = buffer.subarray(0, offset).toString("utf8");
    if (start > 0) {
      const firstNewline = text.indexOf("\n");
      text = firstNewline >= 0 ? text.slice(firstNewline + 1) : "";
    }
    return { text, truncatedAtStart: start > 0 };
  } finally {
    closeSync(fd);
  }
}

function boundedPayload(value: unknown): { value: unknown; truncated: boolean } {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return { value: "[unserializable native payload]", truncated: true };
  }
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes <= MAX_DETAIL_BYTES) return { value, truncated: false };
  return {
    value: {
      omitted: true,
      bytes,
      preview: serialized.slice(0, MAX_STRING),
    },
    truncated: true,
  };
}

function runtimeEvent(value: unknown, threadId: string): RuntimeEvent | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.eventId !== "string" ||
    typeof value.provider !== "string" ||
    value.threadId !== threadId ||
    typeof value.createdAt !== "string" ||
    typeof value.type !== "string"
  ) return null;
  const allowed = new Set([
    "session.started",
    "session.exited",
    "turn.started",
    "turn.completed",
    "item.started",
    "item.updated",
    "item.completed",
    "content.delta",
    "request.opened",
    "request.resolved",
    "thread.token-usage.updated",
    "runtime.error",
  ]);
  return allowed.has(value.type) ? (value as unknown as RuntimeEvent) : null;
}

function runtimeSummary(event: RuntimeEvent): string {
  switch (event.type) {
    case "session.started":
      return `Session started${event.model ? ` · ${event.model}` : ""}`;
    case "session.exited":
      return event.reason ? `Session exited · ${event.reason.slice(0, 120)}` : "Session exited";
    case "turn.started":
      return "Turn started";
    case "turn.completed":
      return `Turn ${event.ok ? "completed" : "failed"}${event.stopReason ? ` · ${event.stopReason}` : ""}`;
    case "item.started":
      return `${event.itemType === "tool" ? "Tool" : "Reasoning"} started${event.title ? ` · ${event.title.slice(0, 120)}` : ""}`;
    case "item.updated":
      return `${event.itemType === "tool" ? "Tool" : "Reasoning"} updated${typeof event.tokens === "number" ? ` · ${event.tokens} tokens` : ""}`;
    case "item.completed":
      return event.itemType === "assistant_text" ? "Assistant text settled" : `Tool ${event.ok ? "completed" : "failed"}`;
    case "content.delta":
      return `${event.streamKind === "assistant_text" ? "Assistant" : "Reasoning"} stream · ${event.delta.length} chars`;
    case "request.opened":
      return `${event.requestType === "permission" ? "Approval" : "Question"} · ${event.summary.slice(0, 140)}`;
    case "request.resolved":
      return `Request ${event.behavior} · ${event.source}`;
    case "thread.token-usage.updated":
      return `Token usage · ${event.input} in / ${event.output} out`;
    case "runtime.error":
      return `Error · ${event.message.slice(0, 160)}`;
  }
}

function runtimeProjection(event: RuntimeEvent): RuntimeInspectorEntry {
  const { raw: _raw, ...rest } = event;
  const detail: Record<string, unknown> = { ...rest };
  if (event.type === "content.delta") detail.delta = event.delta.slice(0, MAX_STRING);
  if (event.type === "item.completed" && event.itemType === "assistant_text") {
    detail.text = event.text.slice(0, MAX_STRING);
  }
  if (event.type === "request.opened") detail.summary = event.summary.slice(0, MAX_STRING);
  if (event.type === "runtime.error") detail.message = event.message.slice(0, MAX_STRING);
  const bounded = boundedPayload(detail);
  return {
    kind: "runtime",
    at: event.createdAt,
    type: event.type,
    provider: event.provider.slice(0, 120),
    ...(event.providerInstanceId ? { providerInstanceId: event.providerInstanceId.slice(0, 120) } : {}),
    summary: runtimeSummary(event),
    detail: isRecord(bounded.value) ? bounded.value : { value: bounded.value },
  };
}

function nativeRecord(value: unknown): NativeRecord | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.at !== "string" ||
    (value.dir !== "in" && value.dir !== "out") ||
    typeof value.source !== "string" ||
    !Object.hasOwn(value, "msg")
  ) return null;
  return {
    at: value.at,
    dir: value.dir,
    source: value.source.slice(0, 160),
    msg: value.msg,
  };
}

function parseRecent<T>(
  text: string,
  limit: number,
  decode: (value: unknown) => T | null,
): { rows: T[]; omittedByLimit: boolean } {
  const rows: T[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const decoded = decode(JSON.parse(line));
      if (decoded) rows.push(decoded);
    } catch {
      // A torn final line or a damaged diagnostic record must not hide older data.
    }
  }
  return { rows: rows.slice(-limit), omittedByLimit: rows.length > limit };
}

export function readThreadInspector(input: {
  eventsDir: string;
  nativeDir: string;
  threadId: string;
  limit?: number;
}): ThreadInspectorSnapshot {
  assertThreadId(input.threadId);
  const limit = inspectorLimit(input.limit);
  const runtimeFile = tailText(join(input.eventsDir, `${input.threadId}.ndjson`));
  const nativeFile = tailText(join(input.nativeDir, `${input.threadId}.ndjson`));

  const runtime = parseRecent(runtimeFile.text, limit, (value) => {
    const event = runtimeEvent(value, input.threadId);
    return event ? runtimeProjection(event) : null;
  });
  const native = parseRecent(nativeFile.text, limit, (value) => {
    const record = nativeRecord(value);
    if (!record) return null;
    const payload = boundedPayload(record.msg);
    return {
      kind: "native" as const,
      at: record.at,
      dir: record.dir,
      source: record.source,
      payload: payload.value,
      payloadTruncated: payload.truncated,
    };
  });

  return {
    runtime: runtime.rows,
    native: native.rows,
    hasEarlier: {
      runtime: runtimeFile.truncatedAtStart || runtime.omittedByLimit,
      native: nativeFile.truncatedAtStart || native.omittedByLimit,
    },
  };
}
