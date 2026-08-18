import type { AttachmentRef, Message } from "./store.ts";

export const BUSY_STEERING_MAX_MESSAGES = 8;
export const BUSY_STEERING_MAX_TEXT_BYTES = 64 * 1024;
export const BUSY_STEERING_MAX_ATTACHMENTS = 20;

export interface SteeringQueueItem {
  id: string;
  text: string;
  attachmentIds: string[];
  at: number;
}

export interface CoalescedSteering {
  messageIds: string[];
  text: string;
  attachmentIds: string[];
}

function statusError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

function textBytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

export function queuedSteering(messages: readonly Message[]): SteeringQueueItem[] {
  return messages
    .filter(
      (message) =>
        message.role === "user" &&
        message.kind === "text" &&
        message.delivery === "queued" &&
        typeof message.text === "string" &&
        message.text.trim().length > 0,
    )
    .map((message) => ({
      id: message.id,
      text: message.text!,
      attachmentIds: (message.attachments ?? []).map((attachment) => attachment.id),
      at: message.at,
    }));
}

export function assertBusySteeringCapacity(input: {
  current: readonly SteeringQueueItem[];
  text: string;
  attachments?: readonly AttachmentRef[];
}): void {
  const nextText = input.text.trim();
  if (!nextText) throw statusError(400, "text required");
  if (input.current.length >= BUSY_STEERING_MAX_MESSAGES) {
    throw statusError(429, `busy steering queue is full (${BUSY_STEERING_MAX_MESSAGES} messages)`);
  }
  const existingBytes = input.current.reduce((sum, item) => sum + textBytes(item.text), 0);
  if (existingBytes + textBytes(nextText) > BUSY_STEERING_MAX_TEXT_BYTES) {
    throw statusError(413, "busy steering queue exceeds its 64 KiB text budget");
  }
  const ids = new Set(input.current.flatMap((item) => item.attachmentIds));
  for (const attachment of input.attachments ?? []) ids.add(attachment.id);
  if (ids.size > BUSY_STEERING_MAX_ATTACHMENTS) {
    throw statusError(413, `busy steering queue exceeds ${BUSY_STEERING_MAX_ATTACHMENTS} attachments`);
  }
}

export function coalesceBusySteering(items: readonly SteeringQueueItem[]): CoalescedSteering | null {
  if (!items.length) return null;
  const ordered = [...items].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  const attachmentIds = [...new Set(ordered.flatMap((item) => item.attachmentIds))];
  const text = ordered.length === 1
    ? ordered[0].text
    : ordered
        .map((item, index) => `[Steering note ${index + 1}/${ordered.length}]\n${item.text}`)
        .join("\n\n");
  return {
    messageIds: ordered.map((item) => item.id),
    text,
    attachmentIds,
  };
}

export function publicQueuedState(message: Message): "queued" | undefined {
  return message.delivery === "queued" ? "queued" : undefined;
}
