import type { RuntimeEvent } from "./contracts.ts";
import type { BotRecord, Message } from "./store.ts";

export const MOBILE_BOOTSTRAP_MESSAGE_LIMIT = 50;
export const MOBILE_MESSAGE_PAGE_LIMIT = 50;
export const MOBILE_MESSAGE_PAGE_LIMIT_MAX = 200;
export const MOBILE_COMPUTER_PREVIEW_MAX_BYTES = 5 * 1024 * 1024;
export const MOBILE_WORKSPACE_RECORD_LIMIT = 500;

export interface MobileComputerPreview {
  bytes: Buffer;
  mime: "image/png" | "image/jpeg";
}

/** Decode an already-captured screen frame without accepting arbitrary
 * content types or oversized base64 allocations. */
export function decodeMobileComputerPreview(
  encoded: unknown,
  mime: unknown,
  maxBytes = MOBILE_COMPUTER_PREVIEW_MAX_BYTES,
): MobileComputerPreview | null {
  if (mime !== "image/png" && mime !== "image/jpeg") return null;
  if (typeof encoded !== "string" || !encoded) return null;
  const prefix = `data:${mime};base64,`;
  const base64 = encoded.startsWith("data:") ? (encoded.startsWith(prefix) ? encoded.slice(prefix.length) : "") : encoded;
  if (!base64 || base64.length > Math.ceil(maxBytes / 3) * 4 + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null;
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length || bytes.length > maxBytes) return null;
  const validMagic =
    mime === "image/png"
      ? bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return validMagic ? { bytes, mime } : null;
}

function stringValue(value: unknown, max = 100_000): string | undefined {
  return typeof value === "string" ? value.slice(0, max) : undefined;
}

function publicAttachment(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const attachment = value as Record<string, unknown>;
  if (typeof attachment.id !== "string" || typeof attachment.name !== "string") return null;
  return {
    id: attachment.id,
    name: attachment.name.slice(0, 180),
    mime: stringValue(attachment.mime, 120) ?? "application/octet-stream",
    size: typeof attachment.size === "number" && Number.isFinite(attachment.size) ? attachment.size : 0,
  };
}

/** An allowlisted transcript projection. In particular, inline screen bytes
 * never cross the mobile API/SSE boundary. */
export function publicMobileMessage(
  message: Message,
  visibleBotIds?: ReadonlySet<string>,
): Record<string, unknown> {
  const safe: Record<string, unknown> = {
    id: message.id,
    role: message.role,
    kind: message.kind,
    at: message.at,
  };
  if (message.text !== undefined) safe.text = message.text;
  if (message.mime !== undefined) safe.mime = message.mime;
  if (message.attachments?.length) {
    safe.attachments = message.attachments.map(publicAttachment).filter((value) => value !== null);
  }
  if (message.card) {
    safe.card = {
      title: message.card.title,
      subtitle: message.card.subtitle,
      options: message.card.options,
      ...(message.card.answered !== undefined ? { answered: message.card.answered } : {}),
      ...(message.card.dismissed !== undefined ? { dismissed: message.card.dismissed } : {}),
      ...(message.card.requestId !== undefined ? { requestId: message.card.requestId } : {}),
      ...(message.card.requestType !== undefined ? { requestType: message.card.requestType } : {}),
      ...(message.card.tool !== undefined ? { tool: message.card.tool } : {}),
    };
  }
  if (message.tool) {
    safe.tool = {
      name: message.tool.ok === false ? "Action failed" : message.tool.ok === true ? "Action completed" : "Working",
      ...(message.tool.ok !== undefined ? { ok: message.tool.ok } : {}),
    };
  }
  if (message.handoff) {
    const peersVisible = !visibleBotIds
      || (visibleBotIds.has(message.handoff.fromBotId) && visibleBotIds.has(message.handoff.toBotId));
    if (peersVisible) {
      safe.handoff = {
        fromBotId: message.handoff.fromBotId,
        fromName: message.handoff.fromName,
        toBotId: message.handoff.toBotId,
        toName: message.handoff.toName,
        prompt: message.handoff.prompt,
        status: message.handoff.status,
        ...(message.handoff.reply !== undefined ? { reply: message.handoff.reply } : {}),
      };
    }
  }
  return safe;
}

/** An allowlisted bot projection: no provider routing, session cursor,
 * permission policy, connector, or computer configuration. */
export function publicMobileBot(
  bot: BotRecord,
  messages?: Message[],
  messageLimit = MOBILE_BOOTSTRAP_MESSAGE_LIMIT,
  visibleBotIds?: ReadonlySet<string>,
): Record<string, unknown> {
  const safe: Record<string, unknown> = {
    id: bot.id,
    threadId: bot.threadId,
    name: bot.name,
    title: bot.title,
    description: bot.description,
    notifications: bot.notifications,
    color: bot.color,
    avatar: bot.avatar,
    mascotExpression: bot.mascotExpression ?? null,
    unread: bot.unread,
    pinned: Boolean(bot.pinned),
    busy: Boolean(bot.busy),
    sectionId: bot.sectionId ?? null,
    createdAt: bot.createdAt,
  };
  if (messages) safe.messages = messageLimit > 0
    ? messages.slice(-messageLimit).map((message) => publicMobileMessage(message, visibleBotIds))
    : [];
  return safe;
}

function publicRuntimeEvent(event: RuntimeEvent): Record<string, unknown> | null {
  const base = {
    eventId: event.eventId,
    threadId: event.threadId,
    createdAt: event.createdAt,
    ...(event.turnId ? { turnId: event.turnId } : {}),
  };
  switch (event.type) {
    case "content.delta":
      // Never stream provider reasoning traces to a companion device.
      if (event.streamKind !== "assistant_text") return null;
      return { ...base, type: event.type, streamKind: event.streamKind, delta: event.delta };
    case "turn.started":
      return { ...base, type: event.type };
    case "turn.completed":
      return { ...base, type: event.type, ok: event.ok };
    case "runtime.error":
      // Provider-native errors can contain command lines, endpoints, and
      // credentials. The persisted activity message remains user-readable.
      return { ...base, type: event.type, message: "The bot run failed." };
    default:
      return null;
  }
}

const TASK_STATUSES = new Set(["queued", "running", "needs_attention", "completed", "failed", "cancelled"]);
const RUN_STATUSES = new Set(["running", "needs_attention", "completed", "failed", "cancelled"]);
const STEP_STATUSES = new Set(["running", "needs_attention", "completed", "failed", "denied"]);
const STEP_KINDS = new Set(["tool", "approval", "handoff"]);
const ARTIFACT_KINDS = new Set(["attachment", "response", "screen"]);
const TASK_SOURCES = new Set(["message", "routine", "handoff"]);
const ROUTINE_LAST_STATUSES = new Set(["running", "completed", "failed"]);

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function publicSchedule(value: unknown): Record<string, unknown> | null {
  const schedule = recordValue(value);
  if (!schedule || typeof schedule.kind !== "string") return null;
  if (schedule.kind === "interval") {
    const everyMinutes = numberValue(schedule.everyMinutes);
    return everyMinutes === undefined ? null : { kind: "interval", everyMinutes };
  }
  if (schedule.kind !== "daily" && schedule.kind !== "weekly") return null;
  const time = stringValue(schedule.time, 5);
  const timezone = stringValue(schedule.timezone, 100);
  if (!time || !timezone) return null;
  if (schedule.kind === "weekly") {
    const weekdays = Array.isArray(schedule.weekdays)
      ? schedule.weekdays.filter((day): day is number => Number.isInteger(day) && Number(day) >= 0 && Number(day) <= 6).slice(0, 7)
      : [];
    if (!weekdays.length) return null;
    return { kind: "weekly", time, timezone, weekdays };
  }
  return { kind: "daily", time, timezone };
}

/** A structural allowlist for the companion's durable-work view. Provider
 * errors, prompts, step titles, request IDs, and disk paths are deliberately
 * absent: blocking suspicious key names is insufficient when a secret sits
 * inside an otherwise ordinary string value. */
export function publicMobileWorkspace(
  value: unknown,
  visibleBotIds?: ReadonlySet<string>,
): Record<string, unknown> {
  const workspace = recordValue(value) ?? {};
  const list = (key: string, limit = MOBILE_WORKSPACE_RECORD_LIMIT): unknown[] =>
    (Array.isArray(workspace[key]) ? workspace[key] as unknown[] : []).slice(-limit);
  const visible = (record: Record<string, unknown>): string | null => {
    const botId = stringValue(record.botId, 100);
    if (!botId || (visibleBotIds && !visibleBotIds.has(botId))) return null;
    return botId;
  };

  const sections = list("sections", 200).flatMap((value) => {
    const section = recordValue(value);
    const id = section && stringValue(section.id, 100);
    const name = section && stringValue(section.name, 60);
    if (!section || !id || !name) return [];
    return [{ id, name, ...(numberValue(section.createdAt) !== undefined ? { createdAt: numberValue(section.createdAt) } : {}) }];
  });

  const attachments = list("attachments").flatMap((value) => {
    const attachment = recordValue(value);
    const id = attachment && stringValue(attachment.id, 100);
    const botId = attachment && visible(attachment);
    const name = attachment && stringValue(attachment.name, 180);
    if (!attachment || !id || !botId || !name) return [];
    return [{
      id,
      botId,
      name,
      mime: stringValue(attachment.mime, 120) ?? "application/octet-stream",
      size: Math.max(0, numberValue(attachment.size) ?? 0),
      ...(numberValue(attachment.createdAt) !== undefined ? { createdAt: numberValue(attachment.createdAt) } : {}),
    }];
  });

  const tasks = list("tasks").flatMap((value) => {
    const task = recordValue(value);
    const id = task && stringValue(task.id, 100);
    const botId = task && visible(task);
    const status = task && stringValue(task.status, 32);
    if (!task || !id || !botId || !status || !TASK_STATUSES.has(status)) return [];
    const source = stringValue(task.source, 20);
    return [{
      id,
      botId,
      status,
      needsAttention: status === "needs_attention",
      ...(source && TASK_SOURCES.has(source) ? { source } : {}),
      ...(stringValue(task.routineId, 100) ? { routineId: stringValue(task.routineId, 100) } : {}),
      ...(stringValue(task.latestRunId, 100) ? { latestRunId: stringValue(task.latestRunId, 100) } : {}),
      attachmentIds: Array.isArray(task.attachmentIds)
        ? task.attachmentIds.flatMap((id) => stringValue(id, 100) ?? []).slice(0, 10)
        : [],
      ...(numberValue(task.createdAt) !== undefined ? { createdAt: numberValue(task.createdAt) } : {}),
      ...(numberValue(task.updatedAt) !== undefined ? { updatedAt: numberValue(task.updatedAt) } : {}),
    }];
  });

  const runs = list("runs").flatMap((value) => {
    const run = recordValue(value);
    const id = run && stringValue(run.id, 100);
    const taskId = run && stringValue(run.taskId, 100);
    const botId = run && visible(run);
    const status = run && stringValue(run.status, 32);
    if (!run || !id || !taskId || !botId || !status || !RUN_STATUSES.has(status)) return [];
    const steps = (Array.isArray(run.steps) ? run.steps : []).slice(-100).flatMap((value) => {
      const step = recordValue(value);
      const stepId = step && stringValue(step.id, 100);
      const kind = step && stringValue(step.kind, 20);
      const stepStatus = step && stringValue(step.status, 32);
      if (!step || !stepId || !kind || !stepStatus || !STEP_KINDS.has(kind) || !STEP_STATUSES.has(stepStatus)) return [];
      return [{
        id: stepId,
        kind,
        status: stepStatus,
        needsAttention: stepStatus === "needs_attention",
        ...(numberValue(step.startedAt) !== undefined ? { startedAt: numberValue(step.startedAt) } : {}),
        ...(numberValue(step.completedAt) !== undefined ? { completedAt: numberValue(step.completedAt) } : {}),
      }];
    });
    const artifacts = (Array.isArray(run.artifacts) ? run.artifacts : []).slice(-100).flatMap((value) => {
      const artifact = recordValue(value);
      const artifactId = artifact && stringValue(artifact.id, 100);
      const kind = artifact && stringValue(artifact.kind, 20);
      if (!artifact || !artifactId || !kind || !ARTIFACT_KINDS.has(kind)) return [];
      return [{
        id: artifactId,
        kind,
        ...(stringValue(artifact.attachmentId, 100) ? { attachmentId: stringValue(artifact.attachmentId, 100) } : {}),
        ...(numberValue(artifact.createdAt) !== undefined ? { createdAt: numberValue(artifact.createdAt) } : {}),
      }];
    });
    return [{
      id,
      taskId,
      botId,
      status,
      needsAttention: status === "needs_attention",
      ...(stringValue(run.routineId, 100) ? { routineId: stringValue(run.routineId, 100) } : {}),
      steps,
      artifacts,
      ...(numberValue(run.startedAt) !== undefined ? { startedAt: numberValue(run.startedAt) } : {}),
      ...(numberValue(run.completedAt) !== undefined ? { completedAt: numberValue(run.completedAt) } : {}),
    }];
  });

  const routines = list("routines").flatMap((value) => {
    const routine = recordValue(value);
    const id = routine && stringValue(routine.id, 100);
    const botId = routine && visible(routine);
    const name = routine && stringValue(routine.name, 100);
    const schedule = routine && publicSchedule(routine.schedule);
    if (!routine || !id || !botId || !name || !schedule || typeof routine.enabled !== "boolean") return [];
    const lastStatus = stringValue(routine.lastStatus, 20);
    return [{
      id,
      botId,
      name,
      schedule,
      enabled: routine.enabled,
      nextRunAt: routine.nextRunAt === null ? null : numberValue(routine.nextRunAt) ?? null,
      ...(numberValue(routine.createdAt) !== undefined ? { createdAt: numberValue(routine.createdAt) } : {}),
      ...(numberValue(routine.updatedAt) !== undefined ? { updatedAt: numberValue(routine.updatedAt) } : {}),
      ...(numberValue(routine.lastRunAt) !== undefined ? { lastRunAt: numberValue(routine.lastRunAt) } : {}),
      ...(lastStatus && ROUTINE_LAST_STATUSES.has(lastStatus) ? { lastStatus } : {}),
    }];
  });

  return { sections, attachments, tasks, runs, routines };
}

/** Convert a local SSE payload to the narrow companion protocol. Unknown
 * events are dropped instead of being forwarded optimistically. */
export function sanitizeRemoteSsePayload(
  payload: unknown,
  options: { visibleBotIds?: ReadonlySet<string> } = {},
): unknown | null {
  if (!payload || typeof payload !== "object") return null;
  const envelope = payload as Record<string, unknown>;
  switch (envelope.kind) {
    case "hello":
      return { kind: "hello" };
    case "runtime": {
      const event = envelope.event as RuntimeEvent | undefined;
      if (!event || typeof event.type !== "string") return null;
      const safeEvent = publicRuntimeEvent(event);
      return safeEvent ? { kind: "runtime", event: safeEvent } : null;
    }
    case "message":
    case "message.patch": {
      const message = envelope.message as Message | undefined;
      if (!message || typeof message.id !== "string") return null;
      return {
        kind: envelope.kind,
        threadId: stringValue(envelope.threadId, 100) ?? "",
        message: publicMobileMessage(message, options.visibleBotIds),
      };
    }
    case "bot": {
      const bot = envelope.bot as BotRecord | undefined;
      if (!bot || typeof bot.id !== "string") return null;
      return { kind: "bot", bot: publicMobileBot(bot, undefined, MOBILE_BOOTSTRAP_MESSAGE_LIMIT, options.visibleBotIds) };
    }
    case "workspace":
      return { kind: "workspace", workspace: publicMobileWorkspace(envelope.workspace, options.visibleBotIds) };
    case "bot.deleted":
      return { kind: "bot.deleted", botId: stringValue(envelope.botId, 100) ?? "" };
    default:
      // config, instances, computer, raw screen frames, and all future event
      // kinds stay local until they receive an explicit projection above.
      return null;
  }
}
