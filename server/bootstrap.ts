import type { BotRecord, Message } from "./store.ts";
import type {
  AttachmentRecord,
  RunRecord,
  RoutineRecord,
  SectionRecord,
  TaskRecord,
} from "./workspace.ts";

export const DESKTOP_BOOTSTRAP_SCHEMA = "cumea.desktop-bootstrap" as const;
export const DESKTOP_BOOTSTRAP_VERSION = 1 as const;
export const DESKTOP_BOOTSTRAP_BOT_LIMIT = 200;
export const DESKTOP_BOOTSTRAP_MESSAGE_LIMIT = 80;
export const DESKTOP_BOOTSTRAP_MESSAGE_BYTES = 2 * 1024 * 1024;
export const DESKTOP_BOOTSTRAP_MESSAGE_ITEM_BYTES = 512 * 1024;
export const DESKTOP_BOOTSTRAP_WORKSPACE_ITEM_BYTES = 256 * 1024;

const WORKSPACE_LIMITS = Object.freeze({
  sections: { count: 200, bytes: 128 * 1024 },
  attachments: { count: 200, bytes: 256 * 1024 },
  tasks: { count: 200, bytes: 512 * 1024 },
  runs: { count: 200, bytes: 768 * 1024 },
  routines: { count: 100, bytes: 512 * 1024 },
});

type PublicAttachment = Omit<AttachmentRecord, "storedPath">;

export interface PublicWorkspaceSnapshot {
  sections: SectionRecord[];
  attachments: PublicAttachment[];
  tasks: TaskRecord[];
  runs: RunRecord[];
  routines: RoutineRecord[];
}

export interface BootstrapMessagePage {
  messages: Message[];
  nextBefore: string | null;
  hasMore: boolean;
  omittedOversize: number;
  encodedBytes: number;
}

export interface BootstrapWorkspaceProjection extends PublicWorkspaceSnapshot {
  truncated: {
    sections: number;
    attachments: number;
    tasks: number;
    runs: number;
    routines: number;
  };
}

export interface DesktopBootstrapInput {
  bots: BotRecord[];
  messagesFor: (threadId: string) => Message[];
  selectedBotId?: string | null;
  config: unknown;
  instances: unknown[];
  workspace: PublicWorkspaceSnapshot;
  needsYouCount: number;
  computerStatus: unknown;
  eventCursor: number;
}

function utf8Bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function boundedMessage(message: Message): Message | null {
  if (utf8Bytes(message) <= DESKTOP_BOOTSTRAP_MESSAGE_ITEM_BYTES) return message;

  // Screen bytes are a reproducible projection. Keep the transcript record
  // but omit the expensive frame from the startup critical path.
  if (message.kind === "screen" && message.png) {
    const withoutFrame = { ...message, png: undefined };
    if (utf8Bytes(withoutFrame) <= DESKTOP_BOOTSTRAP_MESSAGE_ITEM_BYTES) return withoutFrame;
  }

  // Never turn oversized canonical text into different text. Later paging can
  // recover an omitted item from durable storage.
  return null;
}

export function bootstrapMessagePage(messages: Message[]): BootstrapMessagePage {
  const selected: Message[] = [];
  let bytes = 0;
  let omittedOversize = 0;

  for (
    let index = messages.length - 1;
    index >= 0 && selected.length < DESKTOP_BOOTSTRAP_MESSAGE_LIMIT;
    index -= 1
  ) {
    const candidate = boundedMessage(messages[index]);
    if (!candidate) {
      omittedOversize += 1;
      continue;
    }
    const candidateBytes = utf8Bytes(candidate);
    if (selected.length > 0 && bytes + candidateBytes > DESKTOP_BOOTSTRAP_MESSAGE_BYTES) break;
    if (selected.length === 0 && candidateBytes > DESKTOP_BOOTSTRAP_MESSAGE_BYTES) {
      omittedOversize += 1;
      continue;
    }
    selected.push(candidate);
    bytes += candidateBytes;
  }

  selected.reverse();
  const first = selected[0];
  const firstIndex = first ? messages.findIndex((message) => message.id === first.id) : messages.length;
  const hasMore = omittedOversize > 0 || firstIndex > 0 || selected.length < messages.length;

  return {
    messages: selected,
    nextBefore: hasMore && first ? first.id : null,
    hasMore,
    omittedOversize,
    encodedBytes: bytes,
  };
}

export function publicBootstrapBot(bot: BotRecord): Omit<BotRecord, "resumeCursors"> {
  const { resumeCursors: _resumeCursors, ...publicBot } = bot;
  return publicBot;
}

function boundedRecent<T>(
  values: readonly T[],
  limit: number,
  byteBudget: number,
): { items: T[]; omitted: number } {
  const selected: T[] = [];
  let bytes = 0;
  for (let index = values.length - 1; index >= 0 && selected.length < limit; index -= 1) {
    const item = values[index];
    const itemBytes = utf8Bytes(item);
    if (itemBytes > DESKTOP_BOOTSTRAP_WORKSPACE_ITEM_BYTES) continue;
    if (selected.length > 0 && bytes + itemBytes > byteBudget) break;
    if (selected.length === 0 && itemBytes > byteBudget) continue;
    selected.push(item);
    bytes += itemBytes;
  }
  selected.reverse();
  return { items: selected, omitted: Math.max(0, values.length - selected.length) };
}

export function bootstrapWorkspace(workspace: PublicWorkspaceSnapshot): BootstrapWorkspaceProjection {
  const sections = boundedRecent(workspace.sections, WORKSPACE_LIMITS.sections.count, WORKSPACE_LIMITS.sections.bytes);
  const attachments = boundedRecent(
    workspace.attachments,
    WORKSPACE_LIMITS.attachments.count,
    WORKSPACE_LIMITS.attachments.bytes,
  );
  const tasks = boundedRecent(workspace.tasks, WORKSPACE_LIMITS.tasks.count, WORKSPACE_LIMITS.tasks.bytes);
  const runs = boundedRecent(workspace.runs, WORKSPACE_LIMITS.runs.count, WORKSPACE_LIMITS.runs.bytes);
  const routines = boundedRecent(
    workspace.routines,
    WORKSPACE_LIMITS.routines.count,
    WORKSPACE_LIMITS.routines.bytes,
  );
  return {
    sections: sections.items,
    attachments: attachments.items,
    tasks: tasks.items,
    runs: runs.items,
    routines: routines.items,
    truncated: {
      sections: sections.omitted,
      attachments: attachments.omitted,
      tasks: tasks.omitted,
      runs: runs.omitted,
      routines: routines.omitted,
    },
  };
}

export function buildDesktopBootstrap(input: DesktopBootstrapInput) {
  if (!Number.isSafeInteger(input.eventCursor) || input.eventCursor < 0) {
    throw new Error("desktop bootstrap event cursor is invalid");
  }
  if (!Number.isSafeInteger(input.needsYouCount) || input.needsYouCount < 0) {
    throw new Error("desktop bootstrap Needs You count is invalid");
  }

  const requested = input.selectedBotId
    ? input.bots.find((bot) => bot.id === input.selectedBotId)
    : undefined;
  const bots = input.bots.slice(0, DESKTOP_BOOTSTRAP_BOT_LIMIT);
  if (requested && !bots.some((bot) => bot.id === requested.id)) {
    if (bots.length === DESKTOP_BOOTSTRAP_BOT_LIMIT) bots[bots.length - 1] = requested;
    else bots.push(requested);
  }
  const selected = requested ?? bots[0] ?? null;
  const page = selected
    ? bootstrapMessagePage(input.messagesFor(selected.threadId))
    : { messages: [], nextBefore: null, hasMore: false, omittedOversize: 0, encodedBytes: 0 };
  const workspace = bootstrapWorkspace(input.workspace);

  return {
    schema: DESKTOP_BOOTSTRAP_SCHEMA,
    version: DESKTOP_BOOTSTRAP_VERSION,
    eventCursor: input.eventCursor,
    bots: bots.map(publicBootstrapBot),
    botsTruncated: input.bots.length > bots.length,
    selected: selected
      ? {
          botId: selected.id,
          threadId: selected.threadId,
          page,
        }
      : null,
    config: input.config,
    instances: input.instances,
    workspace,
    needsYouCount: input.needsYouCount,
    computerStatus: input.computerStatus,
  };
}
