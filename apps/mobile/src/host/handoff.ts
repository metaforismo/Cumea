import type { ChatHandoff, HandoffStatus } from "./types";

export const HANDOFF_FIELD_LIMITS = {
  agentId: 160,
  agentName: 80,
  prompt: 2_000,
  result: 4_000,
} as const;

const HANDOFF_STATUSES = new Set<HandoffStatus>(["requested", "completed", "failed"]);
const UNSAFE_INVISIBLE_CHARACTER = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedText(value: unknown, limit: number, collapseWhitespace = false): string | null {
  if (typeof value !== "string") return null;
  const clean = value
    .replace(UNSAFE_INVISIBLE_CHARACTER, "")
    .trim();
  const normalized = collapseWhitespace ? clean.replace(/\s+/g, " ") : clean;
  if (!normalized) return null;
  let result = "";
  let codePoints = 0;
  for (const point of normalized) {
    if (codePoints === limit) break;
    result += point;
    codePoints += 1;
  }
  return result;
}

function boundedAgentId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  if (!id || id.length > HANDOFF_FIELD_LIMITS.agentId || !/^[a-z0-9._:-]+$/i.test(id)) return null;
  return id;
}

/**
 * Accept only a complete handoff object projected by the host. In particular,
 * this mapper never fills omitted peer details from the mobile agent roster.
 */
export function parseProjectedHandoff(value: unknown): ChatHandoff | undefined {
  if (!isRecord(value) || !HANDOFF_STATUSES.has(value.status as HandoffStatus)) return undefined;
  const fromAgentId = boundedAgentId(value.fromBotId);
  const fromName = boundedText(value.fromName, HANDOFF_FIELD_LIMITS.agentName, true);
  const toAgentId = boundedAgentId(value.toBotId);
  const toName = boundedText(value.toName, HANDOFF_FIELD_LIMITS.agentName, true);
  const prompt = boundedText(value.prompt, HANDOFF_FIELD_LIMITS.prompt);
  if (!fromAgentId || !fromName || !toAgentId || !toName || !prompt) return undefined;
  const result = value.reply === undefined
    ? undefined
    : boundedText(value.reply, HANDOFF_FIELD_LIMITS.result);
  return {
    fromAgentId,
    fromName,
    toAgentId,
    toName,
    prompt,
    status: value.status as HandoffStatus,
    ...(result ? { result } : {}),
  };
}

export function handoffStatusLabel(status: HandoffStatus): string {
  if (status === "requested") return "Waiting for response";
  if (status === "completed") return "Completed";
  return "Failed";
}

export function isHandoffTargetVisible(handoff: ChatHandoff, visibleAgentIds: ReadonlySet<string>): boolean {
  return visibleAgentIds.has(handoff.toAgentId);
}
