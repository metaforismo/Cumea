import type { BotRecord, Message } from "./store.ts";

export const TRANSCRIPT_WINDOW_DEFAULT_LIMIT = 120;
export const TRANSCRIPT_WINDOW_MAX_LIMIT = 240;
export const TRANSCRIPT_EXPORT_MAX_MESSAGES = 20_000;
export const TRANSCRIPT_EXPORT_MAX_BYTES = 10 * 1024 * 1024;

export interface TranscriptMessageWindow {
  messages: Message[];
  focusMessageId: string;
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
  beforeCursor: string | null;
  latestMessageId: string | null;
}

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

export function transcriptMessageWindow(
  messages: readonly Message[],
  focusMessageId: string,
  rawLimit = TRANSCRIPT_WINDOW_DEFAULT_LIMIT,
): TranscriptMessageWindow {
  const focus = focusMessageId.trim();
  if (!focus || focus.length > 200) throw httpError(400, "invalid focus message id");
  if (!Number.isInteger(rawLimit) || rawLimit < 1) throw httpError(400, "limit must be a positive integer");
  const limit = Math.min(rawLimit, TRANSCRIPT_WINDOW_MAX_LIMIT);
  const index = messages.findIndex((message) => message.id === focus);
  if (index < 0) throw httpError(404, "no such transcript message");

  // Keep more context before the hit than after it, but always retain the hit.
  const beforeBudget = Math.floor(limit * 0.55);
  let start = Math.max(0, index - beforeBudget);
  let end = Math.min(messages.length, start + limit);
  if (end - start < limit) start = Math.max(0, end - limit);
  const page = messages.slice(start, end);
  return {
    messages: page,
    focusMessageId: focus,
    hasMoreBefore: start > 0,
    hasMoreAfter: end < messages.length,
    beforeCursor: start > 0 && page.length ? page[0].id : null,
    latestMessageId: messages.at(-1)?.id ?? null,
  };
}

export interface PublicTranscriptMessage {
  id: string;
  at: number;
  role: Message["role"];
  kind: Message["kind"];
  text?: string;
  card?: {
    title: string;
    subtitle: string;
    options: string[];
    answered?: string;
    dismissed?: boolean;
  };
  attachments?: Array<{ name: string; mime: string; size: number }>;
  handoff?: {
    fromName: string;
    toName: string;
    prompt: string;
    status: "requested" | "completed" | "failed";
    reply?: string;
  };
  tool?: { name: string; ok?: boolean };
  delivery?: "queued" | "dispatching" | "failed";
  screenOmitted?: true;
}

/** Export only fields already visible in the folded transcript. */
export function publicTranscriptMessage(message: Message): PublicTranscriptMessage {
  return {
    id: message.id,
    at: message.at,
    role: message.role,
    kind: message.kind,
    ...(message.text ? { text: message.text } : {}),
    ...(message.card
      ? {
          card: {
            title: message.card.title,
            subtitle: message.card.subtitle,
            options: [...message.card.options],
            ...(message.card.answered !== undefined ? { answered: message.card.answered } : {}),
            ...(message.card.dismissed !== undefined ? { dismissed: message.card.dismissed } : {}),
          },
        }
      : {}),
    ...(message.attachments?.length
      ? {
          attachments: message.attachments.map(({ name, mime, size }) => ({ name, mime, size })),
        }
      : {}),
    ...(message.handoff
      ? {
          handoff: {
            fromName: message.handoff.fromName,
            toName: message.handoff.toName,
            prompt: message.handoff.prompt,
            status: message.handoff.status,
            ...(message.handoff.reply !== undefined ? { reply: message.handoff.reply } : {}),
          },
        }
      : {}),
    ...(message.tool ? { tool: { name: message.tool.name, ...(message.tool.ok !== undefined ? { ok: message.tool.ok } : {}) } } : {}),
    ...(message.delivery === "queued" || message.delivery === "dispatching" || message.delivery === "failed" ? { delivery: message.delivery } : {}),
    ...(message.kind === "screen" ? { screenOmitted: true } : {}),
  };
}

function boundedExport(messages: readonly Message[]): PublicTranscriptMessage[] {
  if (messages.length > TRANSCRIPT_EXPORT_MAX_MESSAGES) {
    throw httpError(413, `transcript export exceeds ${TRANSCRIPT_EXPORT_MAX_MESSAGES} messages`);
  }
  const projected = messages.map(publicTranscriptMessage);
  const bytes = Buffer.byteLength(JSON.stringify(projected), "utf8");
  if (bytes > TRANSCRIPT_EXPORT_MAX_BYTES) {
    throw httpError(413, "transcript export exceeds the 10 MiB visible-data budget");
  }
  return projected;
}

function markdownText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function transcriptExportJson(bot: BotRecord, messages: readonly Message[]): string {
  const projected = boundedExport(messages);
  return `${JSON.stringify(
    {
      schema: "cumea.visible-transcript.v1",
      bot: { name: bot.name, title: bot.title, description: bot.description },
      exportedAt: new Date().toISOString(),
      messages: projected,
    },
    null,
    2,
  )}\n`;
}

export function transcriptExportMarkdown(bot: BotRecord, messages: readonly Message[]): string {
  const projected = boundedExport(messages);
  const lines = [`# ${bot.name}`, "", ...(bot.title ? [markdownText(bot.title), ""] : [])];
  for (const message of projected) {
    lines.push(`## ${message.role === "user" ? "You" : bot.name} · ${new Date(message.at).toISOString()}`, "");
    if (message.text) lines.push(markdownText(message.text), "");
    if (message.delivery === "queued") lines.push("_Queued for the next attended turn._", "");
    if (message.delivery === "dispatching") lines.push("_Steering dispatch was in progress._", "");
    if (message.delivery === "failed") lines.push("_This steering message was not delivered._", "");
    if (message.card) {
      lines.push(`**${markdownText(message.card.title)}**`);
      if (message.card.subtitle) lines.push(markdownText(message.card.subtitle));
      for (const option of message.card.options) lines.push(`- ${markdownText(option)}`);
      if (message.card.answered) lines.push(`Answered: ${markdownText(message.card.answered)}`);
      lines.push("");
    }
    if (message.attachments?.length) {
      lines.push("Attachments:");
      for (const attachment of message.attachments) {
        lines.push(`- ${markdownText(attachment.name)} (${attachment.mime}, ${attachment.size} bytes)`);
      }
      lines.push("");
    }
    if (message.tool) lines.push(`Activity: ${markdownText(message.tool.name)}${message.tool.ok === false ? " (failed)" : ""}`, "");
    if (message.handoff) {
      lines.push(`Handoff: ${markdownText(message.handoff.fromName)} → ${markdownText(message.handoff.toName)}`);
      lines.push(markdownText(message.handoff.prompt));
      if (message.handoff.reply) lines.push("", markdownText(message.handoff.reply));
      lines.push("");
    }
    if (message.screenOmitted) lines.push("[Computer screenshot omitted from export]", "");
  }
  const output = `${lines.join("\n").trimEnd()}\n`;
  if (Buffer.byteLength(output, "utf8") > TRANSCRIPT_EXPORT_MAX_BYTES) {
    throw httpError(413, "transcript export exceeds the 10 MiB visible-data budget");
  }
  return output;
}
