import { fetch as expoFetch } from "expo/fetch";
import type {
  AgentSummary,
  AttentionItem,
  AvatarConfig,
  ChatAttachment,
  ChatMessage,
  ComputerPreview,
  Enrollment,
  HostStreamEvent,
  MessagesPage,
  MobileSnapshot,
  PairClaimResponse,
  PairingClaimInput,
  PendingAttachment,
  RoutineSummary,
} from "./types";
import { responseDecision } from "./response-decision";

type HostEnrollment = Extract<Enrollment, { mode: "host" }>;

interface RawCard {
  title?: string;
  subtitle?: string;
  options?: string[];
  answered?: string;
  dismissed?: boolean;
  requestId?: string;
  requestType?: "permission" | "question";
}

interface RawMessage {
  id: string;
  role: "bot" | "user";
  kind: "text" | "options" | "activity" | "screen" | "handoff";
  text?: string;
  card?: RawCard;
  attachments?: Array<{ id: string; name: string; mime: string; size: number }>;
  handoff?: { prompt?: string; reply?: string; status?: string };
  tool?: { name?: string; ok?: boolean };
  at: number;
}

interface RawBot {
  id: string;
  threadId: string;
  name: string;
  title?: string;
  description?: string;
  unread?: boolean;
  busy?: boolean;
  createdAt?: number;
  avatar?: Partial<AvatarConfig> & { kind?: "mote" | "upload"; imageDataUrl?: string };
  messages?: RawMessage[];
}

interface RawRoutine {
  id: string;
  botId: string;
  name: string;
  schedule:
    | { kind: "interval"; everyMinutes: number }
    | { kind: "daily"; time: string; timezone: string }
    | { kind: "weekly"; time: string; timezone: string; weekdays: number[] };
  enabled: boolean;
  nextRunAt: number | null;
  lastStatus?: "running" | "completed" | "failed";
}

interface RawBootstrap {
  app?: string;
  host?: { name?: string };
  profile?: { name?: string; email?: string };
  capabilities?: { computerPreview?: boolean };
  bots?: RawBot[];
  workspace?: { routines?: RawRoutine[] };
}

const FALLBACK_AVATAR: AvatarConfig = {
  version: 1,
  kind: "mote",
  shapeId: "orb",
  color: "#2f8de3",
  motion: "playful",
};

const MAX_SSE_BUFFER_BYTES = 8 * 1024 * 1024;
const MAX_COMPUTER_PREVIEW_BASE64_CHARS = Math.ceil((5 * 1024 * 1024) / 3) * 4;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function rawBot(value: unknown): RawBot | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.threadId !== "string" || typeof value.name !== "string") {
    return null;
  }
  return value as unknown as RawBot;
}

function rawMessage(value: unknown): RawMessage | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.at !== "number") return null;
  if (!["bot", "user"].includes(String(value.role)) || !["text", "options", "activity", "screen", "handoff"].includes(String(value.kind))) {
    return null;
  }
  return value as unknown as RawMessage;
}

function mergeRawMessages(previous: readonly RawMessage[], incoming: readonly RawMessage[]): RawMessage[] {
  const byId = new Map(previous.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((left, right) =>
    left.at === right.at ? left.id.localeCompare(right.id) : left.at - right.at,
  );
}

export function normalizeHostUrl(raw: string): string {
  const value = raw.trim().replace(/\/+$/, "");
  if (!value) throw new Error("Enter the host URL from Cumea desktop.");
  const url = new URL(value);
  const loopback = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname);
  const developmentLoopback = __DEV__ && url.protocol === "http:" && loopback;
  if (url.protocol !== "https:" && !developmentLoopback) {
    throw new Error("A Cumea host must use HTTPS. HTTP is only available for loopback development.");
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Use the bare host origin without a path, query, or credentials.");
  }
  return url.origin;
}

export function parsePairingUri(raw: string): PairingClaimInput {
  const value = raw.trim();
  if (!value) throw new Error("Paste or scan the pairing data shown by Cumea desktop.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("That pairing data is not valid.");
  }
  const isPairLink = url.protocol === "cumea:" && (url.hostname === "pair" || url.pathname.replace(/^\//, "") === "pair");
  if (!isPairLink) throw new Error("Use the cumea://pair payload shown by your desktop host.");
  const hostUrl = url.searchParams.get("host") ?? url.searchParams.get("hostUrl") ?? "";
  const sessionId = url.searchParams.get("session") ?? url.searchParams.get("sessionId") ?? "";
  const secret = url.searchParams.get("secret") ?? "";
  if (!hostUrl || !sessionId || !secret) throw new Error("The pairing data is missing host, session, or secret values.");
  return { hostUrl: normalizeHostUrl(hostUrl), sessionId, secret };
}

async function parseJson(response: Response): Promise<Record<string, unknown>> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(body.error ?? `${response.status} ${response.statusText}`));
  return body;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 15_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await expoFetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("The Cumea host did not respond in time.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function claimPairing(input: PairingClaimInput): Promise<HostEnrollment> {
  const hostUrl = normalizeHostUrl(input.hostUrl);
  const sessionId = input.sessionId.trim();
  const secret = input.secret.trim();
  if (!sessionId || !secret) throw new Error("Session ID and one-time secret are required.");
  // A pairing claim consumes the one-time session. Do not add a client-side
  // abort that could discard a successfully minted token after the host commits.
  const response = await expoFetch(`${hostUrl}/api/pairing/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, secret, deviceName: "Cumea mobile" }),
  });
  const body = (await parseJson(response)) as unknown as PairClaimResponse;
  if (!body.token || !body.device?.id || !body.hostUrl) {
    throw new Error("The host returned an incomplete pairing response.");
  }
  return {
    mode: "host",
    hostUrl: normalizeHostUrl(body.hostUrl),
    deviceId: body.device.id,
    token: body.token,
  };
}

function avatarFor(bot: RawBot): AvatarConfig {
  const avatar = bot.avatar;
  const uploadedImage = avatar?.kind === "upload" &&
    typeof avatar.imageDataUrl === "string" &&
    avatar.imageDataUrl.startsWith("data:image/") &&
    avatar.imageDataUrl.length <= 720_000
    ? avatar.imageDataUrl
    : undefined;
  if (
    avatar?.shapeId &&
    avatar.color &&
    avatar.motion &&
    ["orb", "soft", "tile", "capsule", "peak", "gem", "ripple", "drop"].includes(avatar.shapeId) &&
    /^#[0-9a-f]{6}$/i.test(avatar.color) &&
    ["calm", "playful", "kinetic"].includes(avatar.motion)
  ) {
    return {
      version: 1,
      kind: uploadedImage ? "upload" : "mote",
      shapeId: avatar.shapeId,
      color: avatar.color,
      motion: avatar.motion,
      ...(uploadedImage ? { imageDataUrl: uploadedImage } : {}),
    };
  }
  return FALLBACK_AVATAR;
}

function messageText(message: RawMessage): string {
  if (message.text) return message.text;
  if (message.card) return [message.card.title, message.card.subtitle].filter(Boolean).join("\n");
  if (message.tool?.name) return message.tool.name;
  if (message.handoff) return message.handoff.reply ?? message.handoff.prompt ?? "Agent handoff";
  if (message.kind === "screen") return "Computer screen updated";
  return "Activity updated";
}

function mapMessage(agentId: string, message: RawMessage): ChatMessage {
  return {
    id: message.id,
    agentId,
    role: message.role === "user" ? "user" : message.kind === "activity" ? "system" : "agent",
    kind: message.kind === "activity" || message.kind === "screen"
      ? "activity"
      : message.kind === "options"
        ? "approval"
        : message.kind === "handoff"
          ? "handoff"
          : "text",
    text: messageText(message),
    createdAt: message.at,
    status: message.tool?.ok === false ? "error" : "done",
    attachments: message.attachments,
  };
}

function pendingAttention(bot: RawBot): AttentionItem[] {
  return (bot.messages ?? []).flatMap((message) => {
    const card = message.card;
    if (!card?.requestId || card.answered || card.dismissed) return [];
    const requestType = card.requestType ?? "question";
    const choices = card.options?.length
      ? card.options
      : requestType === "permission"
        ? ["Always allow", "Allow once", "Never"]
        : [];
    return [{
      id: message.id,
      requestId: card.requestId,
      agentId: bot.id,
      agentName: bot.name,
      title: card.title ?? (requestType === "permission" ? "Approval needed" : "Your bot has a question"),
      summary: card.subtitle ?? "This bot is waiting for your input.",
      choices,
      requestType,
      createdAt: message.at,
    }];
  });
}

function mapAgent(bot: RawBot): AgentSummary {
  const messages = bot.messages ?? [];
  const last = messages.at(-1);
  const attention = pendingAttention(bot);
  const needsYou = attention.length > 0;
  return {
    id: bot.id,
    threadId: bot.threadId,
    name: bot.name || "Untitled bot",
    role: bot.title || bot.description || "AI teammate",
    preview: last ? messageText(last).replace(/\s+/g, " ").trim() : "Ready when you are.",
    updatedAt: last?.at ?? bot.createdAt ?? Date.now(),
    unread: Boolean(bot.unread),
    needsYou,
    presence: needsYou ? "needs-you" : bot.busy ? "working" : "idle",
    avatar: avatarFor(bot),
  };
}

function scheduleLabel(routine: RawRoutine): string {
  const schedule = routine.schedule;
  if (schedule.kind === "interval") return `Every ${schedule.everyMinutes} minutes`;
  if (schedule.kind === "daily") return `Daily at ${schedule.time}`;
  return `Weekly at ${schedule.time}`;
}

function mapRoutines(routines: RawRoutine[], bots: Map<string, RawBot>): RoutineSummary[] {
  return routines.map((routine) => ({
    id: routine.id,
    agentId: routine.botId,
    agentName: bots.get(routine.botId)?.name ?? "Bot",
    name: routine.name,
    schedule: scheduleLabel(routine),
    enabled: routine.enabled,
    nextRunAt: routine.nextRunAt,
    lastStatus: routine.lastStatus,
  }));
}

function parseSseData(block: string): unknown | null {
  const data = block
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""))
    .join("\n");
  if (!data) return null;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return null;
  }
}

function nextSseBoundary(buffer: string): { index: number; length: number } | null {
  const candidates = [
    { index: buffer.indexOf("\r\n\r\n"), length: 4 },
    { index: buffer.indexOf("\n\n"), length: 2 },
    { index: buffer.indexOf("\r\r"), length: 2 },
  ].filter((candidate) => candidate.index >= 0);
  if (!candidates.length) return null;
  return candidates.reduce((earliest, candidate) => candidate.index < earliest.index ? candidate : earliest);
}

export class HostClient {
  private readonly bots = new Map<string, RawBot>();
  private readonly botIdByThread = new Map<string, string>();
  private rawRoutines: RawRoutine[] = [];

  constructor(private readonly credentials: HostEnrollment) {}

  private async request(path: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<Record<string, unknown>> {
    const response = await fetchWithTimeout(`${this.credentials.hostUrl}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${this.credentials.token}`,
        ...(typeof init.body === "string" ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    }, timeoutMs);
    return parseJson(response);
  }

  private rememberBot(incoming: RawBot, preserveMessages = false): RawBot {
    const existing = this.bots.get(incoming.id);
    const messages = preserveMessages || (incoming.messages?.length ?? 0) === 0
      ? existing?.messages ?? incoming.messages ?? []
      : incoming.messages ?? existing?.messages ?? [];
    const merged = { ...existing, ...incoming, messages };
    this.bots.set(merged.id, merged);
    this.botIdByThread.set(merged.threadId, merged.id);
    return merged;
  }

  private rememberSnapshot(raw: RawBootstrap): MobileSnapshot {
    const incomingBots = Array.isArray(raw.bots) ? raw.bots.map(rawBot).filter((bot): bot is RawBot => bot !== null) : [];
    const previousBots = new Map(this.bots);
    this.bots.clear();
    this.botIdByThread.clear();
    const mergedBots = incomingBots.map((bot) => this.rememberBot({
      ...bot,
      messages: mergeRawMessages(previousBots.get(bot.id)?.messages ?? [], bot.messages ?? []),
    }));
    this.rawRoutines = Array.isArray(raw.workspace?.routines) ? raw.workspace.routines : [];
    const agents = mergedBots.map(mapAgent).sort((left, right) => right.updatedAt - left.updatedAt);
    return {
      hostName: raw.host?.name,
      profile: { name: raw.profile?.name || "Cumea user", email: raw.profile?.email },
      capabilities: { computerPreview: raw.capabilities?.computerPreview === true },
      agents,
      attention: mergedBots.flatMap(pendingAttention).sort((left, right) => right.createdAt - left.createdAt),
      routines: mapRoutines(this.rawRoutines, this.bots),
      messages: Object.fromEntries(mergedBots.map((bot) => [bot.id, (bot.messages ?? []).map((message) => mapMessage(bot.id, message))])),
      serverTime: Date.now(),
    };
  }

  private mapEvent(payload: unknown): HostStreamEvent | null {
    if (!isRecord(payload) || typeof payload.kind !== "string") return null;
    if (payload.kind === "hello") return { kind: "hello" };
    if (payload.kind === "bot") {
      const incoming = rawBot(payload.bot);
      if (!incoming) return null;
      const bot = this.rememberBot(incoming, true);
      return { kind: "agent", agent: mapAgent(bot), attention: pendingAttention(bot) };
    }
    if (payload.kind === "bot.deleted" && typeof payload.botId === "string") {
      const bot = this.bots.get(payload.botId);
      if (bot) this.botIdByThread.delete(bot.threadId);
      this.bots.delete(payload.botId);
      return { kind: "agent.deleted", agentId: payload.botId };
    }
    if ((payload.kind === "message" || payload.kind === "message.patch") && typeof payload.threadId === "string") {
      const agentId = this.botIdByThread.get(payload.threadId);
      const message = rawMessage(payload.message);
      if (!agentId || !message) return null;
      const bot = this.bots.get(agentId);
      if (!bot) return null;
      const messages = [...(bot.messages ?? [])];
      const existingIndex = messages.findIndex((candidate) => candidate.id === message.id);
      if (existingIndex >= 0) messages[existingIndex] = message;
      else messages.push(message);
      const merged = this.rememberBot({ ...bot, messages });
      return {
        kind: payload.kind,
        agent: mapAgent(merged),
        message: mapMessage(agentId, message),
        attention: pendingAttention(merged),
      };
    }
    if (payload.kind === "runtime" && isRecord(payload.event)) {
      const event = payload.event;
      const agentId = typeof event.threadId === "string" ? this.botIdByThread.get(event.threadId) : undefined;
      if (!agentId || typeof event.type !== "string") return null;
      if (event.type === "content.delta" && typeof event.delta === "string") {
        return { kind: "content.delta", agentId, delta: event.delta };
      }
      if (event.type === "turn.started") {
        const bot = this.bots.get(agentId);
        if (bot) this.rememberBot({ ...bot, busy: true }, true);
        return { kind: "turn.started", agentId };
      }
      if (event.type === "turn.completed") {
        const bot = this.bots.get(agentId);
        if (bot) this.rememberBot({ ...bot, busy: false }, true);
        return { kind: "turn.completed", agentId, ok: event.ok === true };
      }
      if (event.type === "runtime.error") {
        return { kind: "runtime.error", agentId, message: typeof event.message === "string" ? event.message : "The bot run failed." };
      }
      return null;
    }
    if (payload.kind === "workspace" && isRecord(payload.workspace)) {
      this.rawRoutines = Array.isArray(payload.workspace.routines) ? payload.workspace.routines as RawRoutine[] : [];
      return { kind: "workspace", routines: mapRoutines(this.rawRoutines, this.bots) };
    }
    return null;
  }

  async snapshot(): Promise<MobileSnapshot> {
    const body = await this.request("/api/mobile/bootstrap");
    return this.rememberSnapshot(body as unknown as RawBootstrap);
  }

  async messages(agentId: string, before?: string | null): Promise<MessagesPage> {
    const query = new URLSearchParams({ limit: "50" });
    if (before) query.set("before", before);
    const body = await this.request(`/api/bots/${encodeURIComponent(agentId)}/messages?${query.toString()}`);
    const messages = Array.isArray(body.messages)
      ? body.messages.map(rawMessage).filter((message): message is RawMessage => message !== null)
      : [];
    const bot = this.bots.get(agentId);
    if (bot) this.rememberBot({ ...bot, messages: mergeRawMessages(bot.messages ?? [], messages) });
    const page = isRecord(body.page) ? body.page : null;
    const nextCursor = page && typeof page.nextBefore === "string"
      ? page.nextBefore
      : typeof body.nextCursor === "string"
        ? body.nextCursor
        : null;
    return {
      messages: messages.map((message) => mapMessage(agentId, message)),
      nextCursor,
    };
  }

  async streamEvents(onEvent: (event: HostStreamEvent) => void | Promise<void>, signal: AbortSignal): Promise<void> {
    const response = await expoFetch(`${this.credentials.hostUrl}/api/events`, {
      headers: {
        accept: "text/event-stream",
        authorization: `Bearer ${this.credentials.token}`,
        "cache-control": "no-cache",
      },
      signal,
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      throw new Error(String(body.error ?? `${response.status} ${response.statusText}`));
    }
    if (!response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")) {
      throw new Error("The Cumea host returned an invalid event stream.");
    }
    if (!response.body) throw new Error("The Cumea host did not open an event stream.");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (!signal.aborted) {
        const result = await reader.read();
        if (result.done) break;
        buffer += decoder.decode(result.value, { stream: true });
        if (buffer.length > MAX_SSE_BUFFER_BYTES) throw new Error("The host event stream sent an oversized frame.");
        let boundary = nextSseBoundary(buffer);
        while (boundary) {
          const block = buffer.slice(0, boundary.index);
          buffer = buffer.slice(boundary.index + boundary.length);
          const event = this.mapEvent(parseSseData(block));
          if (event) await onEvent(event);
          boundary = nextSseBoundary(buffer);
        }
      }
      if (!signal.aborted) throw new Error("The Cumea host event stream closed.");
    } finally {
      try {
        await reader.cancel();
      } catch {}
    }
  }

  async uploadAttachment(agentId: string, attachment: PendingAttachment): Promise<ChatAttachment> {
    const source = await expoFetch(attachment.uri);
    if (!source.ok) throw new Error(`Could not read ${attachment.name}.`);
    const blob = await source.blob();
    if (!blob.size) throw new Error(`${attachment.name} is empty.`);
    if (blob.size > 25 * 1024 * 1024) throw new Error(`${attachment.name} is larger than 25 MB.`);
    const response = await fetchWithTimeout(
      `${this.credentials.hostUrl}/api/bots/${encodeURIComponent(agentId)}/attachments`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.credentials.token}`,
          "content-type": attachment.mime || "application/octet-stream",
          "x-file-name": encodeURIComponent(attachment.name),
        },
        body: blob,
      },
      60_000,
    );
    const body = await parseJson(response);
    if (!isRecord(body.attachment) || typeof body.attachment.id !== "string" || typeof body.attachment.name !== "string") {
      throw new Error("The host returned an incomplete attachment response.");
    }
    return {
      id: body.attachment.id,
      name: body.attachment.name,
      mime: typeof body.attachment.mime === "string" ? body.attachment.mime : attachment.mime,
      size: typeof body.attachment.size === "number" ? body.attachment.size : blob.size,
    };
  }

  async rollbackAttachments(attachmentIds: string[]): Promise<void> {
    await Promise.allSettled(attachmentIds.map((attachmentId) =>
      this.request(`/api/attachments/${encodeURIComponent(attachmentId)}`, { method: "DELETE" }),
    ));
  }

  async computerPreview(agentId: string): Promise<ComputerPreview> {
    const body = await this.request(`/api/bots/${encodeURIComponent(agentId)}/computer-preview`);
    if (body.available === false) return { available: false };
    if (
      body.available !== true ||
      (body.mime !== "image/png" && body.mime !== "image/jpeg") ||
      typeof body.png !== "string" ||
      body.png.length === 0 ||
      body.png.length > MAX_COMPUTER_PREVIEW_BASE64_CHARS ||
      typeof body.capturedAt !== "number" ||
      !Number.isFinite(body.capturedAt)
    ) {
      throw new Error("The host returned an invalid computer preview.");
    }
    return {
      available: true,
      mime: body.mime,
      dataUrl: `data:${body.mime};base64,${body.png}`,
      capturedAt: body.capturedAt,
    };
  }

  async sendMessage(agentId: string, text: string, attachmentIds: string[] = []): Promise<void> {
    await this.request(`/api/bots/${encodeURIComponent(agentId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ text, attachmentIds }),
    });
  }

  async createAgent(name: string, title: string): Promise<AgentSummary> {
    const body = await this.request("/api/bots", {
      method: "POST",
      body: JSON.stringify({ name, title }),
    });
    const incoming = rawBot(body.bot);
    if (!incoming) throw new Error("The host returned an incomplete bot response.");
    return mapAgent(this.rememberBot(incoming));
  }

  async markRead(agentId: string): Promise<void> {
    const body = await this.request(`/api/bots/${encodeURIComponent(agentId)}`, {
      method: "PATCH",
      body: JSON.stringify({ unread: false }),
    });
    const incoming = rawBot(body.bot);
    if (incoming) this.rememberBot(incoming, true);
  }

  async interrupt(agentId: string): Promise<void> {
    await this.request(`/api/bots/${encodeURIComponent(agentId)}/interrupt`, { method: "POST" });
  }

  async respond(item: AttentionItem, choice: string): Promise<void> {
    const decision = responseDecision(item.requestType, choice);
    await this.request(`/api/bots/${encodeURIComponent(item.agentId)}/respond`, {
      method: "POST",
      body: JSON.stringify({
        requestId: item.requestId,
        ...decision,
      }),
    });
  }
}
