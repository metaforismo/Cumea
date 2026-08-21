import { createHash, randomUUID } from "node:crypto";

export type CheckpointPhase = "created" | "turn_accepted" | "session" | "tool" | "approval" | "provider";
export type CheckpointStatus = "available" | "unsafe" | "consumed";
export type CheckpointUnsafeReason =
  | "turn_not_accepted"
  | "unknown_effect"
  | "missing_transcript"
  | "branch_mismatch"
  | "provider_unavailable";

export interface RunCheckpoint {
  version: 1;
  id: string;
  runId: string;
  taskId: string;
  botId: string;
  phase: CheckpointPhase;
  status: CheckpointStatus;
  activeLeafId: string;
  provider: { instanceId: string; model: string };
  cursor?: { instanceId: string; digest: string };
  sequence: number;
  createdAt: number;
  updatedAt: number;
  unsafeReason?: CheckpointUnsafeReason;
  resumedByRunId?: string;
}

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const ID = /^[\w-]{1,100}$/;
const SAFE_PROVIDER_VALUE = /^[^\u0000-\u001f\u007f]{1,200}$/;
const MAX_CURSOR_CANONICAL_BYTES = 16 * 1024;
const MAX_TIMESTAMP = Date.UTC(2100, 0, 1);
const CHECKPOINT_KEYS = new Set([
  "version", "id", "runId", "taskId", "botId", "phase", "status", "activeLeafId",
  "provider", "cursor", "sequence", "createdAt", "updatedAt", "unsafeReason", "resumedByRunId",
]);

function canonical(value: unknown, seen = new Set<object>()): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : JSON.stringify(String(value));
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(`[${typeof value}]`);
  if (seen.has(value)) return JSON.stringify("[circular]");
  seen.add(value);
  try {
    if (Array.isArray(value)) return `[${value.map((entry) => canonical(entry, seen)).join(",")}]`;
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry, seen)}`)
      .join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

/** Digest only: provider cursors remain in the credential-bearing bot store. */
export function checkpointCursorDigest(cursor: unknown): string | null {
  if (cursor === undefined || cursor === null) return null;
  const value = canonical(cursor);
  if (Buffer.byteLength(value, "utf8") > MAX_CURSOR_CANONICAL_BYTES) return null;
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function createRunCheckpoint(input: {
  runId: string;
  taskId: string;
  botId: string;
  activeLeafId: string;
  instanceId: string;
  model: string;
  cursor?: unknown;
  now?: number;
}): RunCheckpoint {
  const now = input.now ?? Date.now();
  const digest = checkpointCursorDigest(input.cursor);
  return {
    version: 1,
    id: `checkpoint-${randomUUID()}`,
    runId: input.runId,
    taskId: input.taskId,
    botId: input.botId,
    phase: "created",
    status: "unsafe",
    unsafeReason: "turn_not_accepted",
    activeLeafId: input.activeLeafId,
    provider: { instanceId: input.instanceId, model: input.model },
    ...(digest ? { cursor: { instanceId: input.instanceId, digest } } : {}),
    sequence: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function validRunCheckpoint(value: unknown, owner: { id: string; taskId: string; botId: string }): value is RunCheckpoint {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<RunCheckpoint>;
  if (Object.keys(row).some((key) => !CHECKPOINT_KEYS.has(key))) return false;
  if (row.version !== 1 || typeof row.id !== "string" || !ID.test(row.id)) return false;
  if (row.runId !== owner.id || row.taskId !== owner.taskId || row.botId !== owner.botId) return false;
  if (!["created", "turn_accepted", "session", "tool", "approval", "provider"].includes(String(row.phase))) return false;
  if (!["available", "unsafe", "consumed"].includes(String(row.status))) return false;
  if (typeof row.activeLeafId !== "string" || !ID.test(row.activeLeafId)) return false;
  if (!row.provider || typeof row.provider !== "object" || Array.isArray(row.provider)) return false;
  if (Object.keys(row.provider).some((key) => key !== "instanceId" && key !== "model")) return false;
  if (!SAFE_PROVIDER_VALUE.test(row.provider.instanceId) || !SAFE_PROVIDER_VALUE.test(row.provider.model)) return false;
  if (!Number.isSafeInteger(row.sequence) || Number(row.sequence) < 0 || Number(row.sequence) > 1_000_000) return false;
  if (
    !Number.isSafeInteger(row.createdAt) || Number(row.createdAt) <= 0 || Number(row.createdAt) > MAX_TIMESTAMP ||
    !Number.isSafeInteger(row.updatedAt) || Number(row.updatedAt) < Number(row.createdAt) || Number(row.updatedAt) > MAX_TIMESTAMP
  ) return false;
  if (row.cursor !== undefined) {
    if (!row.cursor || typeof row.cursor !== "object" || Array.isArray(row.cursor)) return false;
    if (Object.keys(row.cursor).some((key) => key !== "instanceId" && key !== "digest")) return false;
    if (row.cursor.instanceId !== row.provider.instanceId || !DIGEST.test(row.cursor.digest)) return false;
  }
  const unsafeReason = ["turn_not_accepted", "unknown_effect", "missing_transcript", "branch_mismatch", "provider_unavailable"].includes(String(row.unsafeReason));
  if ((row.status === "unsafe") !== unsafeReason) return false;
  if (row.phase === "created" && (row.status !== "unsafe" || row.unsafeReason !== "turn_not_accepted")) return false;
  if (row.resumedByRunId !== undefined && (typeof row.resumedByRunId !== "string" || !ID.test(row.resumedByRunId))) return false;
  if ((row.status === "consumed") !== (row.resumedByRunId !== undefined)) return false;
  return true;
}

export interface CheckpointResumePlan {
  allowed: boolean;
  useProviderCursor: boolean;
  reason?: CheckpointUnsafeReason | "already_resumed";
}

/** Provider input for an explicit resume. It is deliberately not a durable
 * transcript row: fresh sessions receive the complete surviving text path,
 * while a verified native session receives only the bounded continuation. */
export function checkpointContinuationInput(input: {
  survivingTranscript: Array<{ role: "user" | "assistant"; text: string }>;
  attachments?: Array<{ name: string; storedPath: string }>;
  useProviderCursor: boolean;
}): { text: string; transcript: Array<{ role: "user" | "assistant"; text: string }> } {
  const attachmentLines = (input.attachments ?? []).slice(0, 100).map((attachment) => {
    const name = attachment.name.replace(/[\r\n]+/g, " ").slice(0, 500);
    const path = attachment.storedPath.replace(/[\r\n]+/g, " ").slice(0, 2_000);
    return `- ${name}: ${path}`;
  });
  const text = [
    "Continue the interrupted task from its last durable checkpoint. Reconstruct progress from the surviving conversation and do not repeat completed external actions.",
    ...(attachmentLines.length ? ["Attached files remain available:", ...attachmentLines] : []),
  ].join("\n").slice(0, 16 * 1024);
  return {
    text,
    transcript: input.useProviderCursor ? [] : input.survivingTranscript.slice(-40),
  };
}

export function planCheckpointResume(input: {
  checkpoint: RunCheckpoint;
  activeLeafId: string | null;
  providerAvailable: boolean;
  currentInstanceId: string;
  currentModel: string;
  currentCursor: unknown;
  sessionResumeCapable: boolean;
  unsafeEffects: boolean;
}): CheckpointResumePlan {
  const checkpoint = input.checkpoint;
  if (checkpoint.status === "consumed" || checkpoint.resumedByRunId) return { allowed: false, useProviderCursor: false, reason: "already_resumed" };
  if (input.unsafeEffects) return { allowed: false, useProviderCursor: false, reason: "unknown_effect" };
  if (checkpoint.status !== "available") return { allowed: false, useProviderCursor: false, reason: checkpoint.unsafeReason ?? "turn_not_accepted" };
  if (!input.activeLeafId || input.activeLeafId !== checkpoint.activeLeafId) return { allowed: false, useProviderCursor: false, reason: "branch_mismatch" };
  if (!input.providerAvailable) return { allowed: false, useProviderCursor: false, reason: "provider_unavailable" };
  const currentDigest = checkpointCursorDigest(input.currentCursor);
  const useProviderCursor = Boolean(
    input.sessionResumeCapable && checkpoint.cursor &&
    checkpoint.provider.instanceId === input.currentInstanceId &&
    checkpoint.provider.model === input.currentModel &&
    checkpoint.cursor.instanceId === input.currentInstanceId &&
    currentDigest === checkpoint.cursor.digest,
  );
  return { allowed: true, useProviderCursor };
}
