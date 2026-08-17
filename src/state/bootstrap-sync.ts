import type { Bot, ConfigStatus, InstanceInfo, Message, WorkspaceSnapshot } from "./store";

export const DESKTOP_BOOTSTRAP_SCHEMA = "cumea.desktop-bootstrap" as const;
export const DESKTOP_BOOTSTRAP_VERSION = 1 as const;

export interface BootstrapWorkspace extends WorkspaceSnapshot {
  truncated: {
    sections: number;
    attachments: number;
    tasks: number;
    runs: number;
    routines: number;
  };
}

export interface DesktopBootstrap {
  schema: typeof DESKTOP_BOOTSTRAP_SCHEMA;
  version: typeof DESKTOP_BOOTSTRAP_VERSION;
  eventCursor: number;
  bots: Array<Omit<Bot, "messages">>;
  botsTruncated: boolean;
  selected: {
    botId: string;
    threadId: string;
    page: {
      messages: Message[];
      nextBefore: string | null;
      hasMore: boolean;
      omittedOversize: number;
      encodedBytes: number;
    };
  } | null;
  config: ConfigStatus;
  instances: InstanceInfo[];
  workspace: BootstrapWorkspace;
  needsYouCount: number;
  computerStatus: {
    cloudConfigured?: boolean;
    localConfigured?: boolean;
  };
}

export interface CursorFrame extends Record<string, unknown> {
  kind: string;
  eventCursor: number;
}

export function validEventCursor(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

export function parseCursorFrame(value: unknown): CursorFrame | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const frame = value as Record<string, unknown>;
  if (typeof frame.kind !== "string" || !validEventCursor(frame.eventCursor)) return null;
  return frame as CursorFrame;
}

export function materializeDesktopBootstrap(snapshot: DesktopBootstrap): {
  bots: Bot[];
  selectedId: string;
  workspace: WorkspaceSnapshot;
  workspaceComplete: boolean;
} {
  if (
    snapshot.schema !== DESKTOP_BOOTSTRAP_SCHEMA ||
    snapshot.version !== DESKTOP_BOOTSTRAP_VERSION ||
    !validEventCursor(snapshot.eventCursor)
  ) {
    throw new Error("unsupported desktop bootstrap snapshot");
  }

  const selectedId = snapshot.selected?.botId ?? snapshot.bots[0]?.id ?? "";
  const selectedMessages = snapshot.selected?.page.messages ?? [];
  const bots = snapshot.bots.map((bot) => ({
    ...bot,
    messages: bot.id === selectedId ? selectedMessages : [],
  }));
  const { truncated, ...workspace } = snapshot.workspace;
  const workspaceComplete = Object.values(truncated).every((count) => count === 0);
  return { bots, selectedId, workspace, workspaceComplete };
}

/**
 * A lazy page may race with newer SSE message/message.patch frames. Existing
 * renderer entries therefore win on duplicate IDs; the fetched page only
 * fills history that was not already observed locally.
 */
export function mergeThreadMessages(existing: readonly Message[], fetched: readonly Message[]): Message[] {
  const merged = new Map<string, Message>();
  for (const message of fetched) merged.set(message.id, message);
  for (const message of existing) merged.set(message.id, message);
  return [...merged.values()].sort((left, right) => left.at - right.at || left.id.localeCompare(right.id));
}

export function framesAfterCursor(frames: readonly CursorFrame[], cursor: number): CursorFrame[] {
  if (!validEventCursor(cursor)) throw new Error("invalid bootstrap cursor");
  const accepted: CursorFrame[] = [];
  let last = cursor;
  for (const frame of frames) {
    if (!validEventCursor(frame.eventCursor)) continue;
    if (frame.eventCursor <= last) continue;
    accepted.push(frame);
    last = frame.eventCursor;
  }
  return accepted;
}
