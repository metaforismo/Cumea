import { createHash, randomUUID } from "node:crypto";

export type EffectState = "intended" | "applying" | "applied" | "failed" | "unknown";
export type EffectOrigin = "controlled" | "provider_observation";

export interface EffectDescriptor {
  /** Stable integration boundary, for example `calendar.create`. */
  boundary: string;
  action: string;
  /** A deliberately non-secret label, never a URL, address, token, or body. */
  targetHint?: string;
}

export interface EffectResultMetadata {
  ok: boolean;
  kind: string;
  code?: string;
  reference?: string;
  digest: string;
}

export interface EffectAuditRecord {
  id: string;
  event: "intended" | "applying" | "applied" | "failed" | "restart_unknown" | "ambiguous_unknown" | "duplicate" | "observed_unknown" | "user_resolved";
  at: number;
  note?: string;
}

export interface ExternalEffectRecord {
  id: string;
  runId: string;
  taskId: string;
  botId: string;
  stepId?: string;
  itemId?: string;
  origin: EffectOrigin;
  descriptor: EffectDescriptor;
  /** Digest of canonical request data. The request itself is never retained. */
  requestHash: string;
  /** Local reconciliation key. It is intentionally hidden from companion devices. */
  idempotencyKey: string;
  /** Canonical owner + descriptor + request fingerprint used for reconciliation. */
  fingerprint: string;
  attempt: number;
  retryOf?: string;
  state: EffectState;
  result?: EffectResultMetadata;
  audit: EffectAuditRecord[];
  createdAt: number;
  updatedAt: number;
}

export interface BeginEffectInput {
  boundary: string;
  action: string;
  targetHint?: string;
  request?: unknown;
  /** A destination-issued idempotency key. Only its digest is persisted. */
  destinationIdempotencyKey?: string;
  stepId?: string;
  itemId?: string;
}

/** A trusted adapter may throw this only after the destination explicitly
 * proves that the mutation was rejected before it could be applied. */
export class ExternalEffectNotAppliedError extends Error {
  readonly effectCode: string;

  constructor(effectCode = "not_applied") {
    super("The destination confirmed that the external effect was not applied.");
    this.name = "ExternalEffectNotAppliedError";
    this.effectCode = /^[A-Za-z0-9._:-]{1,40}$/.test(effectCode) ? effectCode : "not_applied";
  }
}

export function isExternalEffectNotApplied(error: unknown): error is ExternalEffectNotAppliedError {
  return error instanceof ExternalEffectNotAppliedError;
}

const SAFE_PART = /^[a-z0-9][a-z0-9._:-]{0,79}$/;
const SECRETISH = /(?:bearer\s+|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|private[_-]?key|https?:\/\/|@|\bsk-[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{16,}|\bxox[baprs]-[A-Za-z0-9-]{16,})/i;
const WRITE_VERB = /(?:^|[_:.-])(create|update|delete|remove|send|post|publish|upload|write|invite|pay|purchase|book|schedule|cancel|execute|deploy|merge|close|reply)(?:$|[_:.-])/i;
const LOCAL_SERVICES = new Set(["memory", "file", "files", "filesystem", "computer", "local", "agents"]);

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonical(value: unknown, seen = new Set<object>()): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : JSON.stringify(String(value));
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (typeof value === "undefined") return "null";
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

function safePart(value: unknown, label: string): string {
  if (typeof value !== "string") throw Object.assign(new Error(`${label} must be a string`), { status: 400 });
  const part = value.trim().toLowerCase();
  if (!SAFE_PART.test(part)) throw Object.assign(new Error(`${label} is invalid`), { status: 400 });
  return part;
}

function safeHint(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw Object.assign(new Error("effect target hint must be a string"), { status: 400 });
  const hint = value.replace(/\s+/g, " ").trim();
  if (!hint) return undefined;
  if (hint.length > 100 || SECRETISH.test(hint)) {
    throw Object.assign(new Error("effect target hint must be a short non-secret label"), { status: 400 });
  }
  return hint;
}

export function normalizeEffectDescriptor(input: Pick<BeginEffectInput, "boundary" | "action" | "targetHint">): EffectDescriptor {
  const targetHint = safeHint(input.targetHint);
  return {
    boundary: safePart(input.boundary, "effect boundary"),
    action: safePart(input.action, "effect action"),
    ...(targetHint ? { targetHint } : {}),
  };
}

export function effectRequestHash(request: unknown): string {
  return sha256(canonical(request));
}

export function effectBaseFingerprint(input: {
  taskId: string;
  botId: string;
  descriptor: EffectDescriptor;
  requestHash: string;
  destinationIdempotencyKey?: string;
}): string {
  const destinationKeyHash = input.destinationIdempotencyKey === undefined
    ? null
    : sha256(input.destinationIdempotencyKey);
  return sha256(canonical({
    taskId: input.taskId,
    botId: input.botId,
    descriptor: input.descriptor,
    requestHash: input.requestHash,
    destinationKeyHash,
  }));
}

export function attemptIdempotencyKey(baseFingerprint: string, attempt: number, destinationKey?: string): string {
  // A destination key is already the retry identity; its plaintext is not kept.
  return destinationKey === undefined
    ? sha256(`${baseFingerprint}:attempt:${attempt}`)
    : sha256(`${baseFingerprint}:destination:${sha256(destinationKey)}`);
}

export function effectAudit(event: EffectAuditRecord["event"], at: number, note?: string): EffectAuditRecord {
  const safeNote = note?.replace(/\s+/g, " ").trim().slice(0, 160);
  return { id: `effect-audit-${randomUUID()}`, event, at, ...(safeNote ? { note: safeNote } : {}) };
}

/**
 * Classifies only explicit integration-shaped write tools. Shell commands,
 * file edits, browser/computer activity and generic tool titles are excluded:
 * their side effects cannot be inferred safely from an opaque provider event.
 */
export function classifyOpaquePotentialEffect(title: unknown): EffectDescriptor | null {
  if (typeof title !== "string") return null;
  const token = title.trim().split(/\s/, 1)[0]?.toLowerCase() ?? "";
  if (token.length > 160 || (!token.startsWith("mcp__") && !token.startsWith("plugin__") && !token.startsWith("connector__"))) {
    return null;
  }
  if (!WRITE_VERB.test(token)) return null;
  const parts = token.split("__").filter(Boolean);
  const action = parts.at(-1)?.replace(/[^a-z0-9._:-]/g, "-").slice(0, 80) ?? "write";
  const service = parts.length > 2 ? parts.at(-2)! : parts[0];
  if (LOCAL_SERVICES.has(service)) return null;
  return normalizeEffectDescriptor({ boundary: `${service}.${action}`.slice(0, 80), action });
}

export function boundedEffectResult(value: unknown, ok: boolean): EffectResultMetadata {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const codeValue = record?.code ?? record?.status;
  const referenceValue = record?.id ?? record?.reference;
  const candidateCode = typeof codeValue === "string" || typeof codeValue === "number" ? String(codeValue) : "";
  const code = /^[A-Za-z0-9._:-]{1,40}$/.test(candidateCode) ? candidateCode : undefined;
  const reference = typeof referenceValue === "string" && /^[A-Za-z0-9._:-]{1,100}$/.test(referenceValue) && !SECRETISH.test(referenceValue)
    ? referenceValue
    : undefined;
  return {
    ok,
    kind: value === null ? "null" : Array.isArray(value) ? "array" : typeof value,
    ...(code ? { code } : {}),
    ...(reference ? { reference } : {}),
    digest: effectRequestHash(value),
  };
}
