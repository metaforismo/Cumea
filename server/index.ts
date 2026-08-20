// Cumea server — the harness host. Clients hold no transports
// (upstream rule): the React app dispatches typed commands over HTTP and
// folds one SSE event stream; every provider process runs here.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir, hostname } from "node:os";
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { writeFileAtomic } from "./atomic.ts";
import { buildDesktopBootstrap } from "./bootstrap.ts";
import { assertBusySteeringCapacity, coalesceBusySteering, queuedSteering } from "./busy-steering.ts";
import { buildStructuredPreview } from "./document-preview.ts";
import { FileCapabilityStore, botWorkspaceDirectory, publicFileCapability, readLocalBotFile, readStoredAttachmentFile, stageBotWorkspaceForDeletion } from "./file-capabilities.ts";
import {
  localHostAllowed,
  localOriginAllowed,
  postHarnessReady,
  requestedLocalPort,
  requestedRemotePort,
  tcpPort,
} from "./local-listener.ts";
import * as box from "./box.ts";
import * as composio from "./composio.ts";
import { ATTACHMENTS_DIR, DATA_DIR, ensureDirs, instanceConfigs, loadConfig, saveConfig, EVENTS_DIR, NATIVE_DIR } from "./config.ts";
import type { RuntimeEvent } from "./contracts.ts";
import { stageFilesForDeletion, type StagedFileDeletion } from "./delete-files.ts";

import { BUILT_IN_DRIVERS } from "./drivers/builtIn.ts";
import { threadEventKey, threadEventPrefix } from "./event-key.ts";
import { EventBus } from "./harness/bus.ts";
import { ProviderRegistry } from "./harness/registry.ts";
import {
  MOBILE_BOOTSTRAP_MESSAGE_LIMIT,
  MOBILE_MESSAGE_PAGE_LIMIT,
  MOBILE_MESSAGE_PAGE_LIMIT_MAX,
  decodeMobileComputerPreview,
  publicMobileBot,
  publicMobileMessage,
  publicMobileWorkspace,
  sanitizeRemoteSsePayload,
} from "./mobile.ts";
import { PairingStore } from "./pairing.ts";
import { LifecycleWatchdog, type RunLifecycleAlert, type RunLifecycleProjection } from "./lifecycle-watchdog.ts";
import { SessionFreshnessStore } from "./session-freshness.ts";
import { mentionedBots, parseBotAvatar, Store, type Message } from "./store.ts";
import {
  TRANSCRIPT_WINDOW_DEFAULT_LIMIT,
  transcriptExportJson,
  transcriptExportMarkdown,
  transcriptMessageWindow,
} from "./transcript-navigation.ts";
import { boundedTurnTranscript, decideTurnContext } from "./turn-context.ts";
import { readThreadInspector } from "./thread-inspector.ts";
import { WorkspaceStore, type AttachmentRecord, type RoutineSchedule, type TaskSource } from "./workspace.ts";

const REQUESTED_LOCAL_PORT = requestedLocalPort();
let LOCAL_PORT = REQUESTED_LOCAL_PORT;
const STATIC_DIR = process.env.CUMEA_STATIC_DIR || null;

interface RemoteListenerConfig {
  bind: string;
  port: number;
  publicUrl: string;
}

type RequestSurface = "local" | "remote";

function remoteListenerConfig(): RemoteListenerConfig | null {
  if (process.env.CUMEA_REMOTE_ACCESS !== "1") return null;
  const port = requestedRemotePort();
  if (!Number.isInteger(port) || port < 1 || port > 65_535 || REQUESTED_LOCAL_PORT !== 0 && port === REQUESTED_LOCAL_PORT) {
    throw new Error("CUMEA_REMOTE_PORT must be a valid port different from CUMEA_PORT");
  }
  const bind = String(process.env.CUMEA_REMOTE_BIND || "127.0.0.1").trim();
  if (!bind) throw new Error("CUMEA_REMOTE_BIND cannot be empty");
  const loopbackBind = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(bind);
  if (!loopbackBind && process.env.CUMEA_REMOTE_ALLOW_DIRECT_BIND !== "1") {
    throw new Error("non-loopback CUMEA_REMOTE_BIND requires CUMEA_REMOTE_ALLOW_DIRECT_BIND=1");
  }
  const rawPublicUrl = String(process.env.CUMEA_REMOTE_PUBLIC_URL || "").trim();
  if (!rawPublicUrl) throw new Error("CUMEA_REMOTE_PUBLIC_URL is required when remote access is enabled");
  let publicUrl: URL;
  try {
    publicUrl = new URL(rawPublicUrl);
  } catch {
    throw new Error("CUMEA_REMOTE_PUBLIC_URL must be an absolute URL");
  }
  if (publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash || publicUrl.pathname !== "/") {
    throw new Error("CUMEA_REMOTE_PUBLIC_URL must be an origin without credentials, path, query, or fragment");
  }
  const insecureAllowed = process.env.CUMEA_REMOTE_ALLOW_INSECURE === "1";
  if (publicUrl.protocol !== "https:" && !(insecureAllowed && publicUrl.protocol === "http:")) {
    throw new Error("CUMEA_REMOTE_PUBLIC_URL must use HTTPS (HTTP requires CUMEA_REMOTE_ALLOW_INSECURE=1)");
  }
  return { bind, port, publicUrl: publicUrl.origin };
}

const REMOTE = remoteListenerConfig();
const REMOTE_SCREEN_PREVIEW = Boolean(REMOTE) && process.env.CUMEA_REMOTE_SCREEN_PREVIEW === "1";
const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

ensureDirs();
const cfg = loadConfig();
const registry = new ProviderRegistry(BUILT_IN_DRIVERS);
await registry.load(instanceConfigs(cfg));

const bus = new EventBus();
bus.attach(registry.instances());

// ── peer-agent comms wiring ────────────────────────────────────────────
// A shared secret guards the localhost-only /api/internal endpoints the
// agents-proxy calls; regenerated each boot (the proxy gets it via env).
const COMMS_TOKEN = randomBytes(24).toString("hex");
// Cap message chains: depth 0 = a user-initiated turn (may ask a peer);
// a peer invoked via ask_bot runs at depth 1 and gets NO agents tool, so
// A→B is allowed but B→C (and A→B→A loops) never start.
const MAX_COMMS_DEPTH = 1;
// proxy entry: .ts in dev (node type-strips), .js in the packaged dist-server
const agentsProxyPath = (() => {
  const ts = join(dirname(fileURLToPath(import.meta.url)), "drivers", "agents-proxy.ts");
  return existsSync(ts) ? ts : ts.replace(/\.ts$/, ".js");
})();
// in the packaged app process.execPath is Electron — run the proxy as node
const AGENTS_NODE_FLAG = { ELECTRON_RUN_AS_NODE: "1" };

function agentsIntegration(botId: string, depth: number) {
  return {
    command: process.execPath,
    args: [agentsProxyPath],
    env: {
      ...AGENTS_NODE_FLAG,
      CUMEA_HARNESS_URL: `http://127.0.0.1:${LOCAL_PORT}`,
      CUMEA_BOT_ID: botId,
      CUMEA_COMMS_TOKEN: COMMS_TOKEN,
      CUMEA_TURN_DEPTH: String(depth),
    },
  };
}

/** Run a turn on `targetBotId` and resolve with its assistant text — the
 * synchronous half of ask_bot. Subscribes to the bus, folds assistant_text
 * for that thread, resolves on turn.completed (or a 4-min ceiling). */
function askBotAndWait(targetBotId: string, message: string, depth: number, sourceBotId?: string): Promise<string> {
  const target = store.bot(targetBotId);
  if (!target) return Promise.resolve("(no such bot)");
  const threadId = target.threadId;
  return new Promise((resolve) => {
    let text = "";
    let done = false;
    const finish = (out: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsub();
      resolve(out);
    };
    const unsub = bus.subscribe((e: RuntimeEvent) => {
      if (e.threadId !== threadId) return;
      if (e.type === "item.completed" && e.itemType === "assistant_text") {
        text += (text ? "\n" : "") + e.text;
      } else if (e.type === "turn.completed") {
        finish(text || "(the bot finished without a text reply)");
      }
    });
    const timer = setTimeout(() => finish(text || "(timed out waiting for the bot to reply)"), 4 * 60_000);
    startTurn(targetBotId, message, {
      commsDepth: depth + 1,
      source: "handoff",
      sourceBotId,
      taskTitle: `Handoff from ${store.bot(sourceBotId ?? "")?.name ?? "another bot"}`,
    }).catch((err) =>
      finish(`(couldn't start that bot: ${err instanceof Error ? err.message : String(err)})`),
    );
  });
}

// default selection for new bots: first available instance, claude preferred
async function defaultSelection() {
  const described = await registry.describe();
  const available = described.filter((d) => d.snapshot.state === "available");
  const pick = available.find((d) => d.driverKind === "claudeAgent") ?? available[0] ?? described[0];
  return { instanceId: pick?.instanceId ?? "claude", model: pick?.models.default || "claude-sonnet-5" };
}
let bootSelection = { instanceId: "claude", model: "claude-sonnet-5" };
const store = new Store(() => bootSelection, { messageSearch: true, transcripts: true });
const sessionFreshness = new SessionFreshnessStore(DATA_DIR);
const workspace = new WorkspaceStore();
const lifecycleWatchdog = new LifecycleWatchdog();
const pairing = new PairingStore();
const fileCapabilities = new FileCapabilityStore();
bootSelection = await defaultSelection();
store.seedIfEmpty();

// ── SSE fan-out to clients ─────────────────────────────────────────────
interface SseClient {
  surface: RequestSurface;
  deviceId?: string;
}

const sseClients = new Map<ServerResponse, SseClient>();
let localEventCursor = 0;

function nextLocalEventCursor(): number {
  if (localEventCursor >= Number.MAX_SAFE_INTEGER) {
    throw new Error("local event cursor exhausted");
  }
  localEventCursor += 1;
  return localEventCursor;
}
interface BroadcastOptions {
  /** Used only when the local event has a deliberately different remote
   * meaning, such as a visible bot becoming hidden. */
  remoteOverride?: unknown | null;
  remoteDeletedBotWasVisible?: boolean;
}

function visibleRemoteBotIds(): Set<string> {
  return new Set(store.bots.filter((bot) => !bot.hidden).map((bot) => bot.id));
}

/** Visibility is resolved against the canonical store immediately before
 * every remote write. Unknown/malformed bot-scoped event families fail closed. */
function visibleRemoteSsePayload(payload: unknown, allowDeletedBot: boolean): unknown | null {
  if (!payload || typeof payload !== "object") return null;
  const envelope = payload as Record<string, unknown>;
  switch (envelope.kind) {
    case "bot": {
      const eventBot = envelope.bot as { id?: unknown } | undefined;
      if (typeof eventBot?.id !== "string") return null;
      const current = store.bot(eventBot.id);
      return current && !current.hidden ? payload : null;
    }
    case "message":
    case "message.patch": {
      if (typeof envelope.threadId !== "string") return null;
      return store.bots.some((bot) => bot.threadId === envelope.threadId && !bot.hidden) ? payload : null;
    }
    case "runtime": {
      const event = envelope.event as { threadId?: unknown } | undefined;
      if (typeof event?.threadId !== "string") return null;
      return store.bots.some((bot) => bot.threadId === event.threadId && !bot.hidden) ? payload : null;
    }
    case "bot.deleted":
      return allowDeletedBot && typeof envelope.botId === "string" && envelope.botId ? payload : null;
    default:
      return payload;
  }
}

function broadcast(payload: unknown, options: BroadcastOptions = {}) {
  const eventCursor = nextLocalEventCursor();
  for (const [res, client] of [...sseClients]) {
    if (client.surface === "remote" && (!client.deviceId || !pairing.isActive(client.deviceId))) {
      sseClients.delete(res);
      res.end();
      continue;
    }
    const surface = client.surface;
    const remoteCandidate = Object.prototype.hasOwnProperty.call(options, "remoteOverride")
      ? options.remoteOverride
      : payload;
    const visibleCandidate = surface === "remote"
      ? visibleRemoteSsePayload(remoteCandidate, options.remoteDeletedBotWasVisible === true)
      : payload;
    const outgoing = surface === "remote"
      ? sanitizeRemoteSsePayload(visibleCandidate, { visibleBotIds: visibleRemoteBotIds() })
      : visibleCandidate;
    if (outgoing === null) continue;
    const visible =
      surface === "local" && outgoing && typeof outgoing === "object" && !Array.isArray(outgoing)
        ? { ...(outgoing as Record<string, unknown>), eventCursor }
        : outgoing;
    const frame = `data: ${JSON.stringify(visible)}\n\n`;
    try {
      res.write(frame);
    } catch {
      sseClients.delete(res);
    }
  }
}

function publicAttachment(attachment: AttachmentRecord) {
  const { storedPath: _storedPath, ...safe } = attachment;
  return safe;
}

function publicWorkspace() {
  const snapshot = workspace.snapshot();
  return {
    sections: snapshot.sections,
    attachments: snapshot.attachments.map(publicAttachment),
    tasks: snapshot.tasks,
    runs: snapshot.runs,
    routines: snapshot.routines,
  };
}

function publicRemoteWorkspace() {
  return publicMobileWorkspace(publicWorkspace(), visibleRemoteBotIds());
}

function broadcastWorkspace() {
  broadcast({ kind: "workspace", workspace: publicWorkspace() });
}


function syncLifecycleProjection(value: RunLifecycleProjection | null) {
  if (!value) return;
  if (workspace.setRunLifecycle(value.runId, value)) broadcastWorkspace();
}

function surfaceLifecycleAlert(alert: RunLifecycleAlert | null) {
  if (!alert) return;
  if (workspace.markLifecycleAttention(alert.runId, alert)) broadcastWorkspace();
}

function signalLifecycle(threadId: string) {
  const before = lifecycleWatchdog.get(threadId);
  const after = lifecycleWatchdog.signal(threadId);
  if (before?.state !== after?.state) syncLifecycleProjection(after);
}

// ── server-side event folding (upstream's ingestion worker, miniature) ──
// The canonical stream is the source of truth; the persisted transcript
// and every client view are projections of it.
const toolMessageByItem = new Map<string, string>(); // threadId + itemId -> messageId
const askMessageByRequest = new Map<string, string>(); // threadId + requestId -> messageId
const activeRunByThread = new Map<string, string>();
/** Threads whose current turn actually invoked a computer tool. */
const usedComputerByThread = new Set<string>();

function clearThreadEventState(threadId: string) {
  const prefix = threadEventPrefix(threadId);
  for (const key of toolMessageByItem.keys()) if (key.startsWith(prefix)) toolMessageByItem.delete(key);
  for (const key of askMessageByRequest.keys()) if (key.startsWith(prefix)) askMessageByRequest.delete(key);
  usedComputerByThread.delete(threadId);
}

bus.subscribe((event: RuntimeEvent) => {
  broadcast({ kind: "runtime", event });
  const bot = store.botByThread(event.threadId);
  if (!bot) return;

  const lifecycleRunId = activeRunByThread.get(event.threadId);
  if (lifecycleRunId) {
    if (event.type === "request.opened" && event.requestId) {
      syncLifecycleProjection(lifecycleWatchdog.openWait(event.threadId, event.requestId, event.summary));
    } else if (event.type === "request.resolved" && event.requestId) {
      syncLifecycleProjection(lifecycleWatchdog.resolveWait(event.threadId, event.requestId));
    } else if (event.type === "item.started" && event.itemType === "tool" && event.title?.trim()) {
      const before = lifecycleWatchdog.get(event.threadId);
      const alert = lifecycleWatchdog.recordEffect(event.threadId, event.title);
      const after = lifecycleWatchdog.get(event.threadId);
      if (before?.state !== after?.state) syncLifecycleProjection(after);
      surfaceLifecycleAlert(alert);
    } else if (event.type !== "turn.completed") {
      signalLifecycle(event.threadId);
    }
  }

  const pushMessage = (m: Omit<Message, "id" | "at">) => {
    const message = store.appendMessage(event.threadId, m);
    broadcast({ kind: "message", threadId: event.threadId, message });
    return message;
  };

  switch (event.type) {
    case "session.started":
      if (event.sessionId && event.providerInstanceId) {
        // Cursor receipt alone is not enough to declare the session fresh: a
        // native runtime can announce its session before it has incorporated
        // the current user turn. Confirmation happens only on successful
        // turn.completed below.
        store.setResumeCursor(bot.id, event.providerInstanceId, event.sessionId);
      }
      break;
    case "item.completed":
      if (event.itemType === "assistant_text") {
        const message = pushMessage({ role: "bot", kind: "text", text: event.text });
        const runId = activeRunByThread.get(event.threadId);
        if (runId) {
          workspace.addArtifact(runId, { kind: "response", label: "Bot response", messageId: message.id, mime: "text/plain" });
          broadcastWorkspace();
        }
      } else if (event.itemType === "tool" && event.itemId) {
        const key = threadEventKey(event.threadId, event.itemId);
        const messageId = toolMessageByItem.get(key);
        if (messageId) {
          const patched = store.patchMessage(event.threadId, messageId, {
            tool: { name: store.messagesFor(event.threadId).find((m) => m.id === messageId)?.tool?.name ?? "tool", ok: event.ok },
          });
          if (patched) broadcast({ kind: "message.patch", threadId: event.threadId, message: patched });
          toolMessageByItem.delete(key);
        }
        const runId = activeRunByThread.get(event.threadId);
        if (runId) {
          workspace.completeStep(runId, event.itemId, event.ok ? "completed" : "failed");
          broadcastWorkspace();
        }
        // the bot just finished acting — refresh its screen preview now
        pokeScreenPoller(bot.id);
      }
      break;
    case "item.started":
      if (event.itemType === "tool") {
        const message = pushMessage({ role: "bot", kind: "activity", tool: { name: event.title ?? "tool" } });
        if (event.itemId) toolMessageByItem.set(threadEventKey(event.threadId, event.itemId), message.id);
        if ((event.title ?? "").startsWith("mcp__computer__")) usedComputerByThread.add(event.threadId);
        const runId = activeRunByThread.get(event.threadId);
        if (runId) {
          workspace.addStep(runId, { kind: "tool", title: event.title ?? "Tool", itemId: event.itemId });
          broadcastWorkspace();
        }
      }
      break;
    case "request.opened": {
      const permission = event.requestType === "permission";
      const runId = activeRunByThread.get(event.threadId);
      const policy = permission ? bot.approvalPolicy ?? "ask" : "ask";
      if (permission && policy !== "ask") {
        const behavior = policy === "allow" ? "allow" : "deny";
        pushMessage({
          role: "bot",
          kind: "options",
          card: {
            title: policy === "allow" ? "Allowed by bot policy" : "Denied by bot policy",
            subtitle: event.summary,
            options: ["Always allow", "Allow once", "Never"],
            requestId: event.requestId,
            requestType: event.requestType,
            tool: event.tool,
            answered: behavior,
            dismissed: true,
          },
        });
        if (runId) {
          workspace.addStep(runId, {
            kind: "approval",
            title: event.summary,
            itemId: event.requestId,
            status: behavior === "allow" ? "completed" : "denied",
          });
          broadcastWorkspace();
        }
        const instance = registry.get(bot.modelSelection.instanceId);
        void instance?.adapter.respondToRequest(event.threadId, event.requestId ?? "", { behavior }).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          pushMessage({ role: "bot", kind: "activity", tool: { name: `approval policy failed: ${message.slice(0, 120)}`, ok: false } });
        });
        break;
      }
      const message = pushMessage({
        role: "bot",
        kind: "options",
        card: {
          title: permission ? "Approval needed" : "Your bot has a question",
          subtitle: event.summary,
          options: event.choices?.length ? event.choices : permission ? ["Always allow", "Allow once", "Never"] : [],
          requestId: event.requestId,
          requestType: event.requestType,
          tool: event.tool,
        },
      });
      if (event.requestId) askMessageByRequest.set(threadEventKey(event.threadId, event.requestId), message.id);
      if (runId) {
        workspace.markNeedsAttention(runId, event.summary, event.requestId);
        broadcastWorkspace();
      }
      break;
    }
    case "request.resolved": {
      const key = event.requestId ? threadEventKey(event.threadId, event.requestId) : null;
      const messageId = key ? askMessageByRequest.get(key) : null;
      if (messageId) {
        const existing = store.messagesFor(event.threadId).find((m) => m.id === messageId);
        if (existing?.card && !existing.card.answered) {
          const patched = store.patchMessage(event.threadId, messageId, {
            card: { ...existing.card, answered: event.behavior, dismissed: event.source !== "user" },
          });
          if (patched) broadcast({ kind: "message.patch", threadId: event.threadId, message: patched });
        }
        if (key) askMessageByRequest.delete(key);
      }
      const runId = activeRunByThread.get(event.threadId);
      if (runId) {
        workspace.resumeRun(runId, event.requestId, event.behavior === "deny");
        broadcastWorkspace();
      }
      break;
    }
    case "runtime.error": {
      pushMessage({ role: "bot", kind: "activity", tool: { name: `error: ${event.message.slice(0, 160)}`, ok: false } });
      const runId = activeRunByThread.get(event.threadId);
      if (runId) {
        workspace.addStep(runId, { kind: "tool", title: event.message.slice(0, 160), status: "failed" });
        broadcastWorkspace();
      }
      break;
    }
    case "turn.completed": {
      if (event.ok && event.providerInstanceId) {
        try {
          sessionFreshness.confirm(event.threadId, event.providerInstanceId);
        } catch (error) {
          // Leaving the private state pending is conservative: the next turn
          // rebuilds canonical history instead of trusting a cursor whose
          // completion could not be durably confirmed.
          console.error("session freshness completion could not be persisted", error);
        }
      }
      // the last live frame becomes a settled inline screen message —
      // the screenshot-in-chat moment
      const frame = stopScreenPoller(bot.id);
      if (frame && usedComputerByThread.has(event.threadId)) {
        const message = pushMessage({ role: "bot", kind: "screen", png: frame.png, mime: frame.mime });
        const runId = activeRunByThread.get(event.threadId);
        if (runId) workspace.addArtifact(runId, { kind: "screen", label: "Final screen", messageId: message.id, mime: frame.mime });
      }
      const runId = activeRunByThread.get(event.threadId);
      if (runId) {
        workspace.completeRun(runId, event.ok, event.stopReason || (event.ok ? undefined : "Provider run failed"));
        activeRunByThread.delete(event.threadId);
        lifecycleWatchdog.stop(event.threadId);
        broadcastWorkspace();
      }
      const steeringMessageIds = activeSteeringByThread.get(event.threadId);
      if (steeringMessageIds?.length) {
        try {
          patchSteeringDelivery(event.threadId, steeringMessageIds);
        } catch (error) {
          console.error("settled steering delivery state could not be persisted", error);
        } finally {
          activeSteeringByThread.delete(event.threadId);
        }
      }
      store.patchBot(bot.id, { busy: false, unread: true });
      broadcast({ kind: "bot", bot: store.bot(bot.id) });
      clearThreadEventState(event.threadId);
      scheduleSteeringDrain(bot.id);
      break;
    }
  }
});

// ── live screen: poll the bot's box while it works ────────────────────
// Frames stream to clients as SSE {kind:'screen'} (the "Bot's screen"
// panel); the final frame is folded into the transcript on turn end.
type Frame = { png: string; mime: string; capturedAt: number };
const screenPollers = new Map<
  string,
  { timer: ReturnType<typeof setInterval>; capture: () => Promise<void>; last: Frame | null }
>();

function startScreenPoller(botId: string) {
  if (screenPollers.has(botId) || !box.boxConfigured(cfg)) return;
  let inFlight = false;
  const capture = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const { png, format } = await box.screenshotBox(cfg, botId);
      const frame = { png, mime: format === "jpeg" ? "image/jpeg" : "image/png", capturedAt: Date.now() };
      entry.last = frame;
      broadcast({ kind: "screen", botId, png: frame.png, mime: frame.mime });
    } catch {
      /* box asleep or mid-command — try again next tick */
    } finally {
      inFlight = false;
    }
  };
  const entry = {
    timer: setInterval(capture, 4000),
    capture,
    last: null as Frame | null,
  };
  screenPollers.set(botId, entry);
}

/** Event-driven refresh: capture NOW (the bot just acted on its screen)
 * instead of waiting for the next interval tick. */
function pokeScreenPoller(botId: string) {
  void screenPollers.get(botId)?.capture();
}

function stopScreenPoller(botId: string): Frame | null {
  const entry = screenPollers.get(botId);
  if (!entry) return null;
  clearInterval(entry.timer);
  screenPollers.delete(botId);
  return entry.last;
}

// Local computer-use contract written by Electron main on startup
// (~/Library/Application Support/Cumea/cua-connection.json). Read
// fresh each turn — Electron may restart or permissions may change.
function readCuaConnection(): { command: string; args: string[]; env: Record<string, string> } | null {
  const explicit = process.env.CUMEA_CUA_CONNECTION;
  const candidates = [
    ...(explicit && isAbsolute(explicit) ? [explicit] : []),
    ...(process.platform === "darwin"
      ? [join(homedir(), "Library", "Application Support", "Cumea", "cua-connection.json")]
      : process.platform === "win32"
        ? [join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "Cumea", "cua-connection.json")]
        : [join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "Cumea", "cua-connection.json")]),
  ];
  for (const path of candidates) {
    try {
      const conn = JSON.parse(readFileSync(path, "utf8"));
      if (!conn || conn.mode === "unavailable" || !conn.mcpCommand) continue;
      return { command: conn.mcpCommand, args: conn.mcpArgs ?? ["mcp"], env: conn.mcpEnv ?? {} };
    } catch {
      /* try the next location */
    }
  }
  return null;
}

// ── turn dispatch (upstream ProviderCommandReactor, miniature) ──────────
interface TurnOptions {
  commsDepth?: number;
  source?: TaskSource;
  sourceBotId?: string;
  routineId?: string;
  taskId?: string;
  taskTitle?: string;
  attachments?: AttachmentRecord[];
  track?: boolean;
  /** Existing queued user rows consumed by this single attended follow-up. */
  existingUserMessageIds?: string[];
  onDispatchFailed?: (error: unknown) => void;
}

const steeringDrainInFlight = new Set<string>();
const activeSteeringByThread = new Map<string, string[]>();

function patchSteeringDelivery(threadId: string, messageIds: readonly string[], delivery?: "queued" | "dispatching" | "failed") {
  const messages = store.patchMessageDeliveryBatch(threadId, messageIds, delivery);
  for (const message of messages) broadcast({ kind: "message.patch", threadId, message });
}

function markSteeringFailed(
  bot: NonNullable<ReturnType<typeof store.bot>>,
  messageIds: readonly string[],
  error: unknown,
  appendActivity: boolean,
) {
  patchSteeringDelivery(bot.threadId, messageIds, "failed");
  if (!appendActivity) return;
  const detail = error instanceof Error ? error.message : String(error);
  const activity = store.appendMessage(bot.threadId, {
    role: "bot",
    kind: "activity",
    tool: { name: "queued steering failed: " + detail.slice(0, 140), ok: false },
  });
  broadcast({ kind: "message", threadId: bot.threadId, message: activity });
}

function queueBusySteering(
  bot: NonNullable<ReturnType<typeof store.bot>>,
  text: string,
  attachments: AttachmentRecord[],
) {
  const current = queuedSteering(store.messagesFor(bot.threadId));
  assertBusySteeringCapacity({ current, text, attachments });
  const message = store.appendMessage(bot.threadId, {
    role: "user",
    kind: "text",
    text,
    delivery: "queued",
    ...(attachments.length ? { attachments: attachments.map(publicAttachment) } : {}),
  });
  broadcast({ kind: "message", threadId: bot.threadId, message });
  return message;
}

function scheduleSteeringDrain(botId: string) {
  queueMicrotask(() => void drainBusySteering(botId));
}

async function drainBusySteering(botId: string) {
  if (steeringDrainInFlight.has(botId)) return;
  const bot = store.bot(botId);
  if (!bot || bot.busy) return;
  const group = coalesceBusySteering(queuedSteering(store.messagesFor(bot.threadId)));
  if (!group) return;

  steeringDrainInFlight.add(botId);
  try {
    const attachments = workspace.attachmentsFor(bot.id, group.attachmentIds);
    patchSteeringDelivery(bot.threadId, group.messageIds, "dispatching");
    activeSteeringByThread.set(bot.threadId, [...group.messageIds]);
    await startTurn(bot.id, group.text, {
      attachments,
      existingUserMessageIds: group.messageIds,
      track: true,
      onDispatchFailed: (error) => {
        markSteeringFailed(bot, group.messageIds, error, false);
        activeSteeringByThread.delete(bot.threadId);
      },
    });
  } catch (error) {
    markSteeringFailed(bot, group.messageIds, error, true);
    activeSteeringByThread.delete(bot.threadId);
  } finally {
    steeringDrainInFlight.delete(botId);
  }
}
async function startTurn(botId: string, text: string, opts: TurnOptions = {}) {
  const bot = store.bot(botId);
  if (!bot) throw Object.assign(new Error("no such bot"), { status: 404 });
  if (bot.busy) throw Object.assign(new Error("the bot is already working — interrupt it first"), { status: 409 });
  const commsDepth = opts.commsDepth ?? 0;
  const attachments = opts.attachments ?? [];
  const selection = { ...bot.modelSelection };
  const localWorkspace = botWorkspaceDirectory(bot.id);
  const existingUserMessageIds = [...new Set(opts.existingUserMessageIds ?? [])];
  if (existingUserMessageIds.length) {
    const byId = new Map(store.messagesFor(bot.threadId).map((message) => [message.id, message]));
    for (const messageId of existingUserMessageIds) {
      const message = byId.get(messageId);
      if (!message || message.role !== "user" || message.kind !== "text" || message.delivery !== "dispatching") {
        throw Object.assign(new Error("queued steering state changed before dispatch"), { status: 409 });
      }
    }
  }

  const task = opts.track === false
    ? null
    : opts.taskId
      ? workspace.task(opts.taskId)
      : workspace.createTask({
          botId: bot.id,
          prompt: text,
          title: opts.taskTitle,
          source: opts.source,
          sourceBotId: opts.sourceBotId,
          routineId: opts.routineId,
          attachmentIds: attachments.map((attachment) => attachment.id),
        });
  if (opts.track !== false && !task) throw Object.assign(new Error("no such task"), { status: 404 });
  if (task && task.botId !== bot.id) {
    throw Object.assign(new Error("task belongs to another bot"), { status: 409 });
  }

  // Capture prior trust before changing it, then persist pending before the
  // new user message itself becomes canonical. If anything fails after this
  // point, a later turn rebuilds rather than trusting an older native cursor.
  const previousSelection = sessionFreshness.get(bot.threadId);
  sessionFreshness.begin(bot.threadId, selection);

  const userMessage = existingUserMessageIds.length
    ? null
    : store.appendMessage(bot.threadId, {
        role: "user",
        kind: "text",
        text,
        ...(attachments.length ? { attachments: attachments.map(publicAttachment) } : {}),
      });
  if (userMessage) broadcast({ kind: "message", threadId: bot.threadId, message: userMessage });

  let runId: string | undefined;
  if (task) {
    const run = workspace.createRun(task.id);
    runId = run.id;
    syncLifecycleProjection(lifecycleWatchdog.start(bot.threadId, run.id));
    broadcastWorkspace();
  }

  const instance = registry.get(selection.instanceId);
  if (!instance) {
    const message = `provider instance "${selection.instanceId}" is unavailable — pick another model in settings`;
    if (runId) { workspace.completeRun(runId, false, message); lifecycleWatchdog.stop(bot.threadId); }
    broadcastWorkspace();
    throw Object.assign(new Error(message), { status: 409 });
  }
  if (runId) activeRunByThread.set(bot.threadId, runId);

  const transcript = boundedTurnTranscript(
    store.messagesFor(bot.threadId),
    existingUserMessageIds.length ? existingUserMessageIds : userMessage?.id,
  );
  const turnContext = decideTurnContext({
    selectedInstanceId: selection.instanceId,
    selectedModel: selection.model,
    sessionModelSwitch: instance.adapter.capabilities.sessionModelSwitch,
    sessionState: previousSelection?.state ?? null,
    lastDispatchedInstanceId: previousSelection?.state === "dispatched" ? previousSelection.instanceId : undefined,
    lastDispatchedModel: previousSelection?.state === "dispatched" ? previousSelection.model : undefined,
    resumeCursors: bot.resumeCursors,
    transcript,
  });

  const persona = [
    `You are ${bot.name}, a personal bot in Cumea.`,
    bot.title && `Role: ${bot.title}.`,
    bot.description && `About: ${bot.description}`,
  ]
    .filter(Boolean)
    .join(" ");
  const providerText = attachments.length
    ? `${text}\n\nAttached files available on this computer:\n${attachments
        .map((attachment) => `- ${attachment.name} (${attachment.mime}, ${attachment.size} bytes): ${attachment.storedPath}`)
        .join("\n")}`
    : text;

  // busy flips immediately so the composer locks; the dispatch itself runs
  // in the background — box provisioning can take ~90s and must never
  // hang the HTTP request
  store.patchBot(bot.id, { busy: true, unread: false });
  broadcast({ kind: "bot", bot: store.bot(bot.id) });

  void (async () => {
    try {
      const integrations: NonNullable<Parameters<typeof instance.adapter.sendTurn>[0]["integrations"]> = {};
      if (bot.appsEnabled !== false && instance.adapter.capabilities.composioMcp === true && cfg.composio?.key) {
        integrations.composio = { key: cfg.composio.key, url: cfg.composio.url };
      }
      const wants = bot.computer; // 'cloud' | 'local' | 'off' | undefined(auto)
      if (instance.adapter.capabilities.cloudComputerMcp === true && wants !== "off" && wants !== "local" && box.boxConfigured(cfg)) {
        let b = await box.findBox(cfg, bot.id).catch(() => null);
        // the Computer driver runs ON the box — provision it on first use
        if (!b && instance.driverKind === "boxAgent") {
          broadcast({ kind: "computer", botId: bot.id, state: "provisioning" });
          await box.provisionBox(cfg, bot.id, bot.name);
          b = await box.findBox(cfg, bot.id).catch(() => null);
        }
        if (b) integrations.computer = { boxId: b.id, token: cfg.box!.token! };
      }
      // local computer (this Mac) via the Electron-hosted cua-driver: the
      // Electron main process owns the daemon (TCC attribution) and writes
      // its spawn contract to cua-connection.json; the harness only reads it
      if (instance.adapter.capabilities.localComputerMcp === true && !integrations.computer && wants !== "off" && wants !== "cloud") {
        const cua = readCuaConnection();
        if (cua) integrations.localComputer = cua;
      }
      // peer-agent comms: give a user-initiated turn the list_bots/ask_bot
      // tools. A comms-invoked turn (depth ≥ cap) gets none — hard recursion
      // stop, so the user's tokens can't be burned by a bot-to-bot loop.
      // Only drivers that mount the tools get the integration (and, via the
      // integrations.agents gate below, the prompt hint) — a bot on a driver
      // without it must not be told about tools it cannot call. Any bot can
      // still be the TARGET of ask_bot regardless of its driver.
      if (
        commsDepth < MAX_COMMS_DEPTH &&
        bot.collaborationEnabled !== false &&
        instance.adapter.capabilities.agentsMcp === true &&
        store.bots.filter((b) => b.id !== bot.id && !b.hidden).length > 0
      ) {
        integrations.agents = agentsIntegration(bot.id, commsDepth);
      }
      // @mentions in the user's message (the composer's tagging UI) become
      // an explicit delegation nudge — the agent still does the ask_bot call
      // itself, so the harness stays the single owner of turns/permissions
      const tagged = integrations.agents
        ? mentionedBots(
            providerText,
            store.bots.filter((b) => b.id !== bot.id),
          )
        : [];

      const started = await instance.adapter.sendTurn({
        threadId: bot.threadId,
        text: providerText,
        model: selection.model,
        resumeCursor: turnContext.resumeCursor,
        transcript: turnContext.transcript,
        rebuildContext: turnContext.rebuildContext,
        cwd: localWorkspace,
        system:
          persona +
          " When you create a user-facing file, write it inside the current working directory and cite it with a relative path such as ./report.md, ./report.pdf, or ./report.docx so Cumea can offer a safe preview." +
          (integrations.computer && instance.driverKind !== "boxAgent"
            ? " You have your own cloud computer — use the computer tools (screenshot, computer_exec, open_url) whenever browsing or acting on a desktop helps."
            : integrations.localComputer
              ? " You can act on the user's computer through the computer tools — take a screenshot or read the desktop state first, prefer accessibility actions over raw coordinates, and act carefully."
              : "") +
          (integrations.agents
            ? " You can work with the user's other bots through the agents tools — list_bots shows who's available, ask_bot sends one of them a message and returns their reply."
            : "") +
          (integrations.composio
            ? " The user's connected apps are available through the composio tools. Search for the right tool and use it before telling the user that a service is unavailable."
            : "") +
          (tagged.length
            ? ` The user tagged ${tagged
                .map((t) => `@${t.name} (ask_bot bot_id ${t.id})`)
                .join(" and ")} in their message — bring them in with ask_bot and fold their reply into your answer.`
            : ""),
        integrations,
      });
      if (runId) {
        workspace.bindTurn(runId, started.turnId);
        broadcastWorkspace();
      }
      if (integrations.computer) startScreenPoller(bot.id);
    } catch (e) {
      try { opts.onDispatchFailed?.(e); } catch (callbackError) { console.error("steering failure callback failed", callbackError); }
      const message = e instanceof Error ? e.message : String(e);
      const failure = store.appendMessage(bot.threadId, {
        role: "bot",
        kind: "activity",
        tool: { name: `error: ${message.slice(0, 160)}`, ok: false },
      });
      broadcast({ kind: "message", threadId: bot.threadId, message: failure });
      if (runId) {
        workspace.completeRun(runId, false, message);
        activeRunByThread.delete(bot.threadId);
        lifecycleWatchdog.stop(bot.threadId);
        broadcastWorkspace();
      }
      store.patchBot(bot.id, { busy: false });
      broadcast({ kind: "bot", bot: store.bot(bot.id) });
      scheduleSteeringDrain(bot.id);
    }
  })();
  return userMessage;
}

// ── config hot-reload ─────────────────────────────────────────────────
function configStatus() {
  return {
    xai: { configured: Boolean(cfg.xai?.key) },
    composio: { configured: Boolean(cfg.composio?.key), apiKeyConfigured: Boolean(cfg.composio?.apiKey) },
    box: { configured: Boolean(cfg.box?.token) },
    // not a secret — the sidebar shows it
    profile: { name: cfg.profile?.name ?? "", email: cfg.profile?.email ?? "" },
  };
}

/** Rebuild the provider fleet after a config change so new keys take
 * effect without a server restart (kills any in-flight turns). */
async function reloadProviders() {
  // Persist the distrust marker before touching the current fleet. If this
  // owner-local write fails, leave the live providers intact rather than
  // creating a restart window where an old cursor could be trusted again.
  sessionFreshness.invalidate(store.bots.map((bot) => bot.threadId));
  bus.detachAll();
  await registry.disposeAll();
  await registry.load(instanceConfigs(cfg));
  bus.attach(registry.instances());
  // disposeAll terminates old turns after the bus is detached, so their
  // completion events cannot clear persisted UI state for us.
  for (const bot of store.bots) {
    const steeringMessageIds = activeSteeringByThread.get(bot.threadId);
    if (steeringMessageIds?.length) {
      try { markSteeringFailed(bot, steeringMessageIds, new Error("provider reload interrupted steering dispatch"), false); }
      catch (error) { console.error("could not mark interrupted steering after provider reload", error); }
      activeSteeringByThread.delete(bot.threadId);
    }
    if (bot.busy) {
      store.patchBot(bot.id, { busy: false });
      const runId = activeRunByThread.get(bot.threadId);
      if (runId) {
        workspace.completeRun(runId, false, "Providers reloaded while the task was running.");
        activeRunByThread.delete(bot.threadId);
        lifecycleWatchdog.stop(bot.threadId);
      }
      clearThreadEventState(bot.threadId);
      broadcast({ kind: "bot", bot: store.bot(bot.id) });
    }
    scheduleSteeringDrain(bot.id);
  }
  broadcastWorkspace();
}

async function runRoutine(routineId: string, manual = false) {
  const routine = workspace.snapshot().routines.find((candidate) => candidate.id === routineId);
  if (!routine) throw Object.assign(new Error("no such routine"), { status: 404 });
  const bot = store.bot(routine.botId);
  workspace.advanceRoutine(routine.id);
  if (!bot) {
    workspace.markRoutineFailure(routine.id, "The routine's bot no longer exists.");
    broadcastWorkspace();
    if (manual) throw Object.assign(new Error("the routine's bot no longer exists"), { status: 409 });
    return;
  }
  if (bot.busy) {
    workspace.markRoutineFailure(routine.id, "The bot was already working when this routine became due.");
    broadcastWorkspace();
    if (manual) throw Object.assign(new Error("the bot is already working"), { status: 409 });
    return;
  }
  broadcastWorkspace();
  try {
    await startTurn(bot.id, routine.prompt, {
      source: "routine",
      routineId: routine.id,
      taskTitle: routine.name,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    workspace.markRoutineFailure(routine.id, message);
    broadcastWorkspace();
    if (manual) throw error;
  }
}

let dispatchingRoutines = false;
async function dispatchDueRoutines() {
  if (dispatchingRoutines) return;
  dispatchingRoutines = true;
  try {
    for (const routine of workspace.dueRoutines()) await runRoutine(routine.id);
  } finally {
    dispatchingRoutines = false;
  }
}

const routineTimer = setInterval(() => void dispatchDueRoutines(), 30_000);
routineTimer.unref();

const lifecycleTimer = setInterval(() => {
  const { projections, alerts } = lifecycleWatchdog.tick();
  let changed = false;
  for (const value of projections) {
    const current = workspace.run(value.runId)?.lifecycle;
    const semanticChange =
      !current ||
      current.state !== value.state ||
      current.waitingSince !== value.waitingSince ||
      current.reason !== value.reason;
    if (semanticChange) changed = workspace.setRunLifecycle(value.runId, value) || changed;
  }
  for (const alert of alerts) changed = workspace.markLifecycleAttention(alert.runId, alert) || changed;
  if (changed) broadcastWorkspace();
}, 15_000);
lifecycleTimer.unref();
const initialRoutineTimer = setTimeout(() => void dispatchDueRoutines(), 1_000);
initialRoutineTimer.unref();

const steeringRecoveryTimer = setTimeout(() => {
  for (const bot of store.bots) {
    const messages = store.messagesFor(bot.threadId);
    const interrupted = messages.filter((message) => message.role === "user" && message.delivery === "dispatching");
    if (interrupted.length) {
      try {
        patchSteeringDelivery(bot.threadId, interrupted.map((message) => message.id), "failed");
        const activity = store.appendMessage(bot.threadId, {
          role: "bot",
          kind: "activity",
          tool: { name: "steering dispatch was interrupted by restart; retry if still needed", ok: false },
        });
        broadcast({ kind: "message", threadId: bot.threadId, message: activity });
      } catch (error) {
        console.error("could not reconcile interrupted steering after restart", error);
      }
    }
    if (!queuedSteering(store.messagesFor(bot.threadId)).length) continue;
    const instance = registry.get(bot.modelSelection.instanceId);
    if (bot.busy && !instance?.adapter.hasSession(bot.threadId)) {
      store.patchBot(bot.id, { busy: false });
      broadcast({ kind: "bot", bot: store.bot(bot.id) });
    }
    scheduleSteeringDrain(bot.id);
  }
}, 1_200);
steeringRecoveryTimer.unref();

// ── HTTP plumbing ─────────────────────────────────────────────────────
function json(res: ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, { ...SECURITY_HEADERS, "content-type": "application/json" });
  res.end(data);
}

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = "";
    let done = false;
    const fail = (error: Error) => {
      if (done) return;
      done = true;
      reject(error);
    };
    req.on("data", (c) => {
      if (done) return;
      data += c;
      if (Buffer.byteLength(data, "utf8") > 1_000_000) fail(Object.assign(new Error("body too large"), { status: 413 }));
    });
    req.on("end", () => {
      if (done) return;
      try {
        const body = data ? JSON.parse(data) : {};
        done = true;
        resolve(body);
      } catch {
        fail(Object.assign(new Error("invalid JSON body"), { status: 400 }));
      }
    });
    req.on("error", (error) => fail(error));
  });
}

const ATTACHMENT_MAX_FILE_BYTES = 25 * 1024 * 1024;

function readBytes(req: IncomingMessage, maxBytes = ATTACHMENT_MAX_FILE_BYTES): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;
    const fail = (error: Error) => {
      if (done) return;
      done = true;
      reject(error);
    };
    req.on("data", (chunk: Buffer | string) => {
      if (done) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += bytes.length;
      if (total > maxBytes) {
        fail(Object.assign(new Error("attachment is larger than 25 MB"), { status: 413 }));
        return;
      }
      chunks.push(bytes);
    });
    req.on("end", () => {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks));
    });
    req.on("error", fail);
  });
}

async function uploadAttachment(req: IncomingMessage, res: ServerResponse, botId: string) {
  const bot = store.bot(botId);
  if (!bot) return json(res, 404, { error: "no such bot" });
  // Count is checked before consuming a body. Content-Length, when present,
  // also lets us reject a storage-quota violation before buffering bytes.
  workspace.assertAttachmentCapacity(bot.id, 0);
  const declaredLength = Array.isArray(req.headers["content-length"])
    ? req.headers["content-length"][0]
    : req.headers["content-length"];
  if (declaredLength !== undefined) {
    const expectedBytes = Number(declaredLength);
    if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0) {
      throw Object.assign(new Error("invalid attachment content length"), { status: 400 });
    }
    if (expectedBytes > ATTACHMENT_MAX_FILE_BYTES) {
      throw Object.assign(new Error("attachment is larger than 25 MB"), { status: 413 });
    }
    workspace.assertAttachmentCapacity(bot.id, expectedBytes);
  }
  const rawHeader = Array.isArray(req.headers["x-file-name"])
    ? req.headers["x-file-name"][0]
    : req.headers["x-file-name"];
  let requestedName = "attachment";
  try {
    requestedName = decodeURIComponent(String(rawHeader || "attachment"));
  } catch {
    throw Object.assign(new Error("invalid attachment name"), { status: 400 });
  }
  const safeName = basename(requestedName)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 180) || "attachment";
  const bytes = await readBytes(req);
  if (!bytes.length) return json(res, 400, { error: "attachment is empty" });
  // The exact post-read check does not trust a missing or incorrect header.
  workspace.assertAttachmentCapacity(bot.id, bytes.length);
  const directory = join(ATTACHMENTS_DIR, bot.id);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const storedPath = join(directory, `${randomBytes(12).toString("hex")}-${safeName}`);
  writeFileAtomic(storedPath, bytes);
  const attachment = workspace.createAttachment({
    botId: bot.id,
    threadId: bot.threadId,
    name: safeName,
    mime: String(req.headers["content-type"] || "application/octet-stream").slice(0, 120),
    size: bytes.length,
    storedPath,
  });
  broadcastWorkspace();
  return json(res, 201, { attachment: publicAttachment(attachment) });
}

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "cross-origin-resource-policy": "same-origin",
};
const DOCUMENT_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "connect-src 'self' http://127.0.0.1:8799 http://127.0.0.1:5199 http://localhost:8799 http://localhost:5199 ws://127.0.0.1:5199 ws://localhost:5199",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

function requestOriginAllowed(req: IncomingMessage, method: string): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return true;
  const origin = req.headers.origin;
  if (!origin) return true; // native app, CLI, and internal agent helpers
  return localOriginAllowed(origin, LOCAL_PORT);
}

function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header || Array.isArray(header)) return null;
  const match = header.match(/^Bearer ([^\s]+)$/);
  return match?.[1] ?? null;
}

/** Least-privilege mobile surface. Provider credentials, connector setup,
 * instance metadata, and raw computer execution remain local-only. */
function remoteRouteAllowed(method: string, path: string): boolean {
  if (method === "GET" && ["/api/health", "/api/mobile/bootstrap", "/api/events", "/api/work", "/api/bots"].includes(path)) {
    return true;
  }
  if (method === "GET" && /^\/api\/bots\/[\w-]+\/messages$/.test(path)) return true;
  if (method === "GET" && /^\/api\/bots\/[\w-]+\/computer-preview$/.test(path)) return true;
  if (method === "DELETE" && /^\/api\/attachments\/[\w-]+$/.test(path)) return true;
  if (method === "POST" && path === "/api/bots") return true;
  if (method === "POST" && /^\/api\/bots\/[\w-]+\/attachments$/.test(path)) return true;
  if (method === "PATCH" && /^\/api\/bots\/[\w-]+$/.test(path)) return true;
  if (method === "POST" && /^\/api\/bots\/[\w-]+\/(messages|respond|interrupt)$/.test(path)) return true;
  return false;
}

function publicRemoteError(status: number, message: string): string {
  if (/provider|adapter|instance/i.test(message)) return "provider unavailable";
  if (status >= 500) return "request failed";
  return message.slice(0, 240);
}

function parseRoutineSchedule(value: unknown): RoutineSchedule {
  if (!value || typeof value !== "object") {
    throw Object.assign(new Error("schedule required"), { status: 400 });
  }
  const schedule = value as Record<string, unknown>;
  if (schedule.kind === "interval") {
    return { kind: "interval", everyMinutes: Number(schedule.everyMinutes) };
  }
  if (schedule.kind === "daily") {
    return { kind: "daily", time: String(schedule.time ?? ""), timezone: String(schedule.timezone ?? "") };
  }
  if (schedule.kind === "weekly") {
    return {
      kind: "weekly",
      time: String(schedule.time ?? ""),
      timezone: String(schedule.timezone ?? ""),
      weekdays: Array.isArray(schedule.weekdays) ? schedule.weekdays.map(Number) : [],
    };
  }
  throw Object.assign(new Error("unknown schedule kind"), { status: 400 });
}

async function handleRequest(req: IncomingMessage, res: ServerResponse, surface: RequestSurface) {
  let url: URL;
  try {
    url = new URL(req.url ?? "/", `http://localhost:${LOCAL_PORT}`);
  } catch {
    return json(res, 400, { error: "invalid request URL" });
  }
  const path = url.pathname;
  const method = req.method ?? "GET";
  if (surface === "local" && !localHostAllowed(req.headers.host, LOCAL_PORT)) {
    return json(res, 403, { error: "host not allowed" });
  }
  try {
    const pairingClaim = method === "POST" && path === "/api/pairing/claim";
    let authenticatedDeviceId: string | undefined;
    if (surface === "remote" && !pairingClaim) {
      const token = bearerToken(req);
      const device = token ? pairing.authenticate(token) : null;
      if (!device) {
        res.setHeader("www-authenticate", 'Bearer realm="cumea-mobile"');
        return json(res, 401, { error: "device authentication required" });
      }
      authenticatedDeviceId = device.id;
      if (path.startsWith("/api/internal/") || !remoteRouteAllowed(method, path)) {
        return json(res, 403, { error: "endpoint is not available to mobile devices" });
      }
    }
    if (!requestOriginAllowed(req, method)) return json(res, 403, { error: "origin not allowed" });

    // ── self-hosted mobile pairing ────────────────────────────────────
    // Pairing sessions and device revocation are deliberately local-only.
    if (method === "POST" && path === "/api/pairing/sessions") {
      if (surface !== "local") return json(res, 403, { error: "pairing sessions can only be created locally" });
      if (!REMOTE) return json(res, 409, { error: "remote access is disabled" });
      const body = await readBody(req);
      const ttlMs = body.ttlMs === undefined ? undefined : Number(body.ttlMs);
      const session = pairing.createSession(REMOTE.publicUrl, ttlMs);
      res.setHeader("cache-control", "no-store");
      return json(res, 201, {
        session: {
          ...session,
          hostName: String(cfg.profile?.name || hostname()).slice(0, 100),
        },
      });
    }
    if (method === "POST" && path === "/api/pairing/claim") {
      if (surface !== "remote") return json(res, 403, { error: "pairing claims must use the remote listener" });
      if (!REMOTE) return json(res, 409, { error: "remote access is disabled" });
      const body = await readBody(req);
      const claimed = pairing.claim(String(body.sessionId ?? ""), String(body.secret ?? ""), body.deviceName);
      res.setHeader("cache-control", "no-store");
      return json(res, 201, { ...claimed, hostUrl: REMOTE.publicUrl });
    }
    if (method === "GET" && path === "/api/devices") {
      if (surface !== "local") return json(res, 403, { error: "device management is local-only" });
      return json(res, 200, { devices: pairing.list() });
    }
    let deviceMatch = path.match(/^\/api\/devices\/([\w-]+)$/);
    if (method === "DELETE" && deviceMatch) {
      if (surface !== "local") return json(res, 403, { error: "device management is local-only" });
      const device = pairing.revoke(deviceMatch[1]);
      if (!device) return json(res, 404, { error: "no such device" });
      return json(res, 200, { device });
    }

    if (method === "GET" && path === "/api/mobile/bootstrap") {
      const visibleBotIds = visibleRemoteBotIds();
      return json(res, 200, {
        app: "cumea",
        host: { name: String(cfg.profile?.name || hostname()).slice(0, 100) },
        profile: { name: cfg.profile?.name ?? "" },
        capabilities: { computerPreview: REMOTE_SCREEN_PREVIEW },
        bots: store.bots
          .filter((bot) => !bot.hidden)
          .map((bot) => publicMobileBot(bot, store.messagesFor(bot.threadId), MOBILE_BOOTSTRAP_MESSAGE_LIMIT, visibleBotIds)),
        workspace: publicRemoteWorkspace(),
      });
    }

    const inspectorMatch = path.match(/^\/api\/bots\/([\w-]+)\/inspector$/);
    if (method === "GET" && inspectorMatch) {
      if (surface !== "local") return json(res, 403, { error: "runtime diagnostics are local-only" });
      const bot = store.bot(inspectorMatch[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      const rawLimit = url.searchParams.get("limit");
      let limit: number | undefined;
      if (rawLimit !== null) {
        const parsed = Number(rawLimit);
        if (!Number.isInteger(parsed) || parsed < 1) return json(res, 400, { error: "limit must be a positive integer" });
        limit = parsed;
      }
      const inspector = readThreadInspector({
        eventsDir: EVENTS_DIR,
        nativeDir: NATIVE_DIR,
        threadId: bot.threadId,
        limit,
      });
      res.setHeader("cache-control", "no-store");
      return json(res, 200, { inspector });
    }
    // ── internal peer-agent comms (localhost + shared token only) ──────
    // The agents-proxy (spawned inside a bot's agent process) calls these to
    // discover peers and hand a message to one. Not part of the public API.
    if (path.startsWith("/api/internal/")) {
      if (req.headers.authorization !== `Bearer ${COMMS_TOKEN}`) {
        return json(res, 401, { error: "unauthorized" });
      }
      if (method === "GET" && path === "/api/internal/agents") {
        const self = url.searchParams.get("self");
        const bots = store.bots
          .filter((b) => b.id !== self && !b.hidden)
          .map((b) => ({ id: b.id, name: b.name, model: b.modelSelection.model, busy: !!b.busy }));
        return json(res, 200, { bots });
      }
      if (method === "POST" && path === "/api/internal/ask-bot") {
        const body = await readBody(req);
        const fromBotId = String(body.fromBotId ?? "");
        const toBotId = String(body.toBotId ?? "");
        const message = String(body.message ?? "").trim();
        const depth = Number(body.depth ?? 0) || 0;
        if (!toBotId || !message) return json(res, 400, { error: "toBotId and message required" });
        if (toBotId === fromBotId) return json(res, 400, { error: "a bot cannot message itself" });
        if (depth >= MAX_COMMS_DEPTH) return json(res, 200, { error: "message chains are limited to one hop" });
        const target = store.bot(toBotId);
        if (!target) return json(res, 404, { error: "no such bot" });
        if (target.busy) return json(res, 200, { busy: true });
        // visibility: surface the cross-talk on the caller's own thread so
        // bot-to-bot turns are never invisible (they cost the user tokens)
        const from = store.bot(fromBotId);
        const fromName = from?.name ?? "another bot";
        let handoffMessageId: string | undefined;
        let handoffStepId: string | undefined;
        if (from) {
          const note = store.appendMessage(from.threadId, {
            role: "bot",
            kind: "activity",
            tool: { name: `asked @${target.name}: ${message.slice(0, 80)}` },
          });
          broadcast({ kind: "message", threadId: from.threadId, message: note });
          const handoff = store.appendMessage(from.threadId, {
            role: "bot",
            kind: "handoff",
            handoff: {
              fromBotId: from.id,
              fromName: from.name,
              toBotId: target.id,
              toName: target.name,
              prompt: message,
              status: "requested",
            },
          });
          handoffMessageId = handoff.id;
          broadcast({ kind: "message", threadId: from.threadId, message: handoff });
          const callerRunId = activeRunByThread.get(from.threadId);
          if (callerRunId) {
            const step = workspace.addStep(callerRunId, {
              kind: "handoff",
              title: `Handoff to ${target.name}`,
              itemId: handoff.id,
            });
            handoffStepId = step?.itemId;
            broadcastWorkspace();
          }
        }
        const prefixed = `[Message from @${fromName}, another bot in this Cumea workspace. Reply to them.]\n\n${message}`;
        const reply = await askBotAndWait(toBotId, prefixed, depth, fromBotId);
        if (from && handoffMessageId) {
          const existing = store.messagesFor(from.threadId).find((candidate) => candidate.id === handoffMessageId);
          if (existing?.handoff) {
            const patched = store.patchMessage(from.threadId, handoffMessageId, {
              handoff: { ...existing.handoff, status: "completed", reply },
            });
            if (patched) broadcast({ kind: "message.patch", threadId: from.threadId, message: patched });
          }
          const callerRunId = activeRunByThread.get(from.threadId);
          if (callerRunId && handoffStepId) {
            workspace.completeStep(callerRunId, handoffStepId, "completed");
            broadcastWorkspace();
          }
        }
        return json(res, 200, { botName: target.name, text: reply });
      }
      return json(res, 404, { error: "unknown internal endpoint" });
    }

    // ── events stream ──
    if (method === "GET" && path === "/api/events") {
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write(`data: ${JSON.stringify(surface === "local" ? { kind: "hello", eventCursor: localEventCursor } : { kind: "hello" })}\n\n`);
      sseClients.set(res, { surface, ...(authenticatedDeviceId ? { deviceId: authenticatedDeviceId } : {}) });
      const keepalive = setInterval(() => {
        const client = sseClients.get(res);
        if (client?.surface === "remote" && (!client.deviceId || !pairing.isActive(client.deviceId))) {
          clearInterval(keepalive);
          sseClients.delete(res);
          res.end();
          return;
        }
        try {
          res.write(": keepalive\n\n");
        } catch {}
      }, 25_000);
      req.on("close", () => {
        clearInterval(keepalive);
        sseClients.delete(res);
      });
      return;
    }

    // ── local transcript search ──────────────────────────────────────
    if (method === "GET" && path === "/api/search/messages") {
      if (surface !== "local") return json(res, 403, { error: "transcript search is local-only" });
      const query = url.searchParams.get("q") ?? "";
      const rawLimit = url.searchParams.get("limit");
      const limit = rawLimit === null ? undefined : Number(rawLimit);
      return json(res, 200, store.searchMessages(query, limit));
    }

    // ── atomic desktop startup snapshot ───────────────────────────────
    if (method === "GET" && path === "/api/bootstrap") {
      if (surface !== "local") return json(res, 403, { error: "desktop bootstrap is local-only" });
      const rawSelected = url.searchParams.get("selectedBotId");
      if (rawSelected && !/^[\w-]{1,100}$/.test(rawSelected)) {
        return json(res, 400, { error: "invalid selectedBotId" });
      }

      // Discovery may await provider processes. Do it before the synchronous
      // snapshot cut; any event after the cut receives a strictly greater
      // localEventCursor and is replayed by the renderer's buffered SSE fold.
      const instances = await registry.describe();
      const workspaceSnapshot = publicWorkspace();
      const eventCursor = localEventCursor;
      const needsYouCount = workspaceSnapshot.runs.filter(
        (run) => run.status === "needs_attention",
      ).length;
      const computerStatus = {
        cloudConfigured: box.boxConfigured(cfg),
        localConfigured: Boolean(readCuaConnection()),
      };
      const snapshot = buildDesktopBootstrap({
        bots: store.bots,
        messagesFor: (threadId) => store.messagesFor(threadId),
        selectedBotId: rawSelected,
        config: configStatus(),
        instances,
        workspace: workspaceSnapshot,
        needsYouCount,
        computerStatus,
        eventCursor,
      });
      res.setHeader("cache-control", "no-store");
      return json(res, 200, snapshot);
    }

    // ── durable work model: sections, tasks, runs, artifacts, routines ──
    if (method === "GET" && path === "/api/work") {
      return json(res, 200, { workspace: surface === "remote" ? publicRemoteWorkspace() : publicWorkspace() });
    }
    if (method === "POST" && path === "/api/sections") {
      const body = await readBody(req);
      const section = workspace.createSection(String(body.name ?? ""));
      broadcastWorkspace();
      return json(res, 201, { section });
    }
    let m = path.match(/^\/api\/sections\/([\w-]+)$/);
    if (m && method === "PATCH") {
      const body = await readBody(req);
      const section = workspace.patchSection(m[1], String(body.name ?? ""));
      if (!section) return json(res, 404, { error: "no such section" });
      broadcastWorkspace();
      return json(res, 200, { section });
    }
    m = path.match(/^\/api\/sections\/([\w-]+)$/);
    if (m && method === "DELETE") {
      if (!workspace.deleteSection(m[1])) return json(res, 404, { error: "no such section" });
      for (const bot of store.bots) {
        if (bot.sectionId !== m[1]) continue;
        const patched = store.patchBot(bot.id, { sectionId: null });
        if (patched) broadcast({ kind: "bot", bot: patched });
      }
      broadcastWorkspace();
      return json(res, 200, { ok: true });
    }
    if (method === "POST" && path === "/api/routines") {
      const body = await readBody(req);
      const botId = String(body.botId ?? "");
      if (!store.bot(botId)) return json(res, 404, { error: "no such bot" });
      const routine = workspace.createRoutine({
        botId,
        name: String(body.name ?? ""),
        prompt: String(body.prompt ?? ""),
        schedule: parseRoutineSchedule(body.schedule),
        enabled: body.enabled === undefined ? true : Boolean(body.enabled),
      });
      broadcastWorkspace();
      return json(res, 201, { routine });
    }
    m = path.match(/^\/api\/routines\/([\w-]+)$/);
    if (m && method === "PATCH") {
      const body = await readBody(req);
      const routine = workspace.patchRoutine(m[1], {
        ...(body.name !== undefined ? { name: String(body.name) } : {}),
        ...(body.prompt !== undefined ? { prompt: String(body.prompt) } : {}),
        ...(body.schedule !== undefined ? { schedule: parseRoutineSchedule(body.schedule) } : {}),
        ...(body.enabled !== undefined ? { enabled: Boolean(body.enabled) } : {}),
      });
      if (!routine) return json(res, 404, { error: "no such routine" });
      broadcastWorkspace();
      return json(res, 200, { routine });
    }
    m = path.match(/^\/api\/routines\/([\w-]+)$/);
    if (m && method === "DELETE") {
      if (!workspace.deleteRoutine(m[1])) return json(res, 404, { error: "no such routine" });
      broadcastWorkspace();
      return json(res, 200, { ok: true });
    }
    m = path.match(/^\/api\/routines\/([\w-]+)\/run$/);
    if (m && method === "POST") {
      await runRoutine(m[1], true);
      return json(res, 202, { ok: true });
    }
    m = path.match(/^\/api\/tasks\/([\w-]+)\/teach$/);
    if (m && method === "POST") {
      const task = workspace.task(m[1]);
      if (!task) return json(res, 404, { error: "no such task" });
      const body = await readBody(req);
      const timezone = String(body.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
      const routine = workspace.createRoutine({
        botId: task.botId,
        name: String(body.name || task.title),
        prompt: task.prompt,
        schedule: body.schedule
          ? parseRoutineSchedule(body.schedule)
          : { kind: "daily", time: "09:00", timezone },
        enabled: body.enabled === undefined ? false : Boolean(body.enabled),
      });
      broadcastWorkspace();
      return json(res, 201, { routine });
    }
    m = path.match(/^\/api\/tasks\/([\w-]+)\/retry$/);
    if (m && method === "POST") {
      const task = workspace.task(m[1]);
      if (!task) return json(res, 404, { error: "no such task" });
      const attachments = workspace.attachmentsFor(task.botId, task.attachmentIds);
      if (attachments.some((attachment) => !existsSync(attachment.storedPath))) {
        return json(res, 409, { error: "one or more task attachments are missing from disk" });
      }
      await startTurn(task.botId, task.prompt, { taskId: task.id, attachments });
      return json(res, 202, { ok: true });
    }
    m = path.match(/^\/api\/attachments\/([\w-]+)$/);
    if (m && method === "GET") {
      const attachment = workspace.attachment(m[1]);
      if (!attachment) return json(res, 404, { error: "no such attachment" });
      try {
        const data = readFileSync(attachment.storedPath);
        const encodedName = encodeURIComponent(attachment.name);
        res.writeHead(200, {
          ...SECURITY_HEADERS,
          "content-type": attachment.mime || "application/octet-stream",
          "content-length": String(data.length),
          "content-disposition": `attachment; filename*=UTF-8''${encodedName}`,
        });
        return res.end(data);
      } catch {
        return json(res, 410, { error: "attachment file is missing" });
      }
    }
    if (m && method === "DELETE") {
      const attachment = workspace.attachment(m[1]);
      if (surface === "remote" && attachment && store.bot(attachment.botId)?.hidden) {
        return json(res, 404, { error: "no such attachment" });
      }
      if (!workspace.deleteAttachment(m[1])) return json(res, 404, { error: "no such attachment" });
      broadcastWorkspace();
      return json(res, 200, { ok: true });
    }
    // ── bots ──
    if (method === "GET" && path === "/api/bots") {
      const visibleBotIds = visibleRemoteBotIds();
      return json(res, 200, {
        bots:
          surface === "remote"
            ? store.bots
                .filter((bot) => !bot.hidden)
                .map((bot) => publicMobileBot(bot, store.messagesFor(bot.threadId), MOBILE_BOOTSTRAP_MESSAGE_LIMIT, visibleBotIds))
            : store.bots.map((b) => ({ ...b, messages: store.messagesFor(b.threadId) })),
      });
    }
    if (method === "POST" && path === "/api/bots") {
      const body = await readBody(req);
      if (surface === "remote" && Object.keys(body).some((key) => !["name", "title"].includes(key))) {
        return json(res, 403, { error: "mobile bot creation only accepts name and title" });
      }
      const requestedName =
        body.name === undefined
          ? undefined
          : String(body.name).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80);
      if (requestedName !== undefined && !requestedName) return json(res, 400, { error: "name cannot be empty" });
      const requestedTitle =
        body.title === undefined
          ? undefined
          : String(body.title).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 120);
      const bot = store.createBot();
      const patch: Record<string, unknown> = { modelSelection: await defaultSelection() };
      if (requestedName !== undefined) patch.name = requestedName;
      if (requestedTitle !== undefined) patch.title = requestedTitle;
      store.patchBot(bot.id, patch);
      const created = store.bot(bot.id)!;
      broadcast({ kind: "bot", bot: created });
      return json(res, 201, {
        bot:
          surface === "remote"
            ? publicMobileBot(created, store.messagesFor(created.threadId), MOBILE_BOOTSTRAP_MESSAGE_LIMIT, visibleRemoteBotIds())
            : { ...created, messages: store.messagesFor(bot.threadId) },
      });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)$/);
    if (m && method === "PATCH") {
      const body = await readBody(req);
      if (surface === "remote") {
        if (Object.keys(body).length !== 1 || typeof body.unread !== "boolean") {
          return json(res, 403, { error: "mobile bot updates only accept unread" });
        }
        if (store.bot(m[1])?.hidden) return json(res, 404, { error: "no such bot" });
        const bot = store.patchBot(m[1], { unread: body.unread });
        if (!bot) return json(res, 404, { error: "no such bot" });
        broadcast({ kind: "bot", bot });
        return json(res, 200, { bot: publicMobileBot(bot, undefined, MOBILE_BOOTSTRAP_MESSAGE_LIMIT, visibleRemoteBotIds()) });
      }
      const remoteWasVisible = Boolean(store.bot(m[1]) && !store.bot(m[1])!.hidden);
      const patch: Record<string, unknown> = {};
      for (const key of [
        "name",
        "title",
        "description",
        "notifications",
        "modelSelection",
        "unread",
        "computer",
        "color",
        "mascotExpression",
        "pinned",
        "hidden",
        "appsEnabled",
        "collaborationEnabled",
      ] as const) {
        if (body[key] !== undefined) patch[key] = body[key];
      }
      if (body.avatar !== undefined) {
        const avatar = parseBotAvatar(body.avatar);
        if (!avatar) return json(res, 400, { error: "invalid avatar" });
        patch.avatar = avatar;
      }
      if (body.sectionId !== undefined) {
        const sectionId = body.sectionId === null || body.sectionId === "" ? null : String(body.sectionId);
        if (sectionId && !workspace.snapshot().sections.some((section) => section.id === sectionId)) {
          return json(res, 400, { error: "no such section" });
        }
        patch.sectionId = sectionId;
      }
      if (body.approvalPolicy !== undefined) {
        if (!["ask", "allow", "deny"].includes(body.approvalPolicy)) {
          return json(res, 400, { error: "unknown approval policy" });
        }
        patch.approvalPolicy = body.approvalPolicy;
      }
      const bot = store.patchBot(m[1], patch);
      if (!bot) return json(res, 404, { error: "no such bot" });
      if (remoteWasVisible && bot.hidden) {
        // Desktop sees the full local patch; companions only learn that a
        // formerly-visible row disappeared, never the hidden record itself.
        broadcast(
          { kind: "bot", bot },
          { remoteOverride: { kind: "bot.deleted", botId: bot.id }, remoteDeletedBotWasVisible: true },
        );
      } else {
        broadcast({ kind: "bot", bot });
      }
      return json(res, 200, { bot });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)$/);
    if (m && method === "DELETE") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      const rawOperationId = String(req.headers["x-cumea-operation-id"] ?? "");
      const operationId = /^[\w-]{1,100}$/.test(rawOperationId) ? rawOperationId : undefined;
      // a running turn dies with its bot
      await registry.get(bot.modelSelection.instanceId)?.adapter.interruptTurn(bot.threadId).catch(() => {});
      stopScreenPoller(bot.id);
      const runId = activeRunByThread.get(bot.threadId);
      if (runId) {
        workspace.completeRun(runId, false, "interrupted");
        activeRunByThread.delete(bot.threadId);
      }
      lifecycleWatchdog.stop(bot.threadId);
      clearThreadEventState(bot.threadId);
      activeSteeringByThread.delete(bot.threadId);
      // Snapshot canonical transcript state while its JSON file is still at
      // the live path. Existing bots may have a cold in-memory transcript
      // cache after restart; once stageFilesForDeletion renames that file, a
      // later metadata failure must still be able to rebuild the search index.
      const transcriptSnapshot = [...store.messagesFor(bot.threadId)];
      let stagedFiles: StagedFileDeletion | null = null;
      let stagedBotWorkspace: StagedFileDeletion | null = null;
      let workspaceTransaction: ReturnType<typeof workspace.removeBotDataTransaction> | null = null;
      let botTransaction: ReturnType<typeof store.deleteBotRecordTransaction> | null = null;
      try {
        stagedBotWorkspace = stageBotWorkspaceForDeletion(bot.id);
        // Same-volume rename is the prepare phase: no bytes are destroyed
        // until both metadata stores have committed, and every path can be
        // restored if either commit fails.
        stagedFiles = stageFilesForDeletion([
          ...store.botDeletionFiles(bot.id),
          { path: join(EVENTS_DIR, `${bot.threadId}.ndjson`), label: "event log" },
          { path: join(NATIVE_DIR, `${bot.threadId}.ndjson`), label: "native log" },
          ...workspace.botDeletionFiles(bot.id),
        ]);
        workspaceTransaction = workspace.removeBotDataTransaction(bot.id);
        botTransaction = store.deleteBotRecordTransaction(bot.id, transcriptSnapshot);
        if (!botTransaction) throw Object.assign(new Error("bot disappeared during deletion"), { status: 500 });

        // A purge failure rolls metadata and all remaining quarantined bytes
        // back below. Only after a complete purge may the transcript cache be
        // forgotten and a deletion event be broadcast.
        stagedBotWorkspace.purge();
        stagedFiles.purge();
        botTransaction.finalize();
      } catch (error) {
        const rollbackErrors: unknown[] = [];
        for (const rollback of [
          botTransaction?.rollback,
          workspaceTransaction?.rollback,
          stagedBotWorkspace?.rollback,
          stagedFiles?.rollback,
        ]) {
          if (!rollback) continue;
          try {
            rollback();
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError);
          }
        }
        // The bot remains the durable retry anchor when cleanup cannot
        // complete. Its in-flight work was already stopped, so reflect that
        // honestly; persistence can itself be the failing boundary, hence the
        // best-effort patch without masking the original delete error.
        try {
          const patched = store.patchBot(bot.id, { busy: false });
          if (patched) broadcast({ kind: "bot", bot: patched });
        } catch {}
        broadcastWorkspace();
        if (rollbackErrors.length) {
          throw Object.assign(new Error("bot deletion failed and could not be fully rolled back"), {
            status: 500,
            cause: new AggregateError([error, ...rollbackErrors]),
          });
        }
        throw error;
      }
      fileCapabilities.revokeBot(bot.id);
      try { sessionFreshness.delete(bot.threadId); } catch (error) { console.error("could not remove session freshness metadata", error); }
      broadcast(
        { kind: "bot.deleted", botId: bot.id, ...(operationId ? { operationId } : {}) },
        { remoteDeletedBotWasVisible: !bot.hidden },
      );
      broadcastWorkspace();
      return json(res, 200, { ok: true, removed: workspaceTransaction.removed });
    }


    m = path.match(/^\/api\/bots\/([\w-]+)\/files\/resolve$/);
    if (m && method === "POST") {
      if (surface !== "local") return json(res, 403, { error: "file preview capabilities are local-only" });
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      const body = await readBody(req);
      const capability = fileCapabilities.issue(bot.id, readLocalBotFile(bot.id, body.path));
      res.setHeader("cache-control", "no-store");
      return json(res, 200, { file: publicFileCapability(capability) });
    }

    m = path.match(/^\/api\/attachments\/([\w-]+)\/files\/resolve$/);
    if (m && method === "POST") {
      if (surface !== "local") return json(res, 403, { error: "file preview capabilities are local-only" });
      const attachment = workspace.attachment(m[1]);
      if (!attachment) return json(res, 404, { error: "no such attachment" });
      const bot = store.bot(attachment.botId);
      if (!bot) return json(res, 404, { error: "attachment owner no longer exists" });
      const capability = fileCapabilities.issue(
        bot.id,
        readStoredAttachmentFile(attachment.storedPath, attachment.name),
      );
      res.setHeader("cache-control", "no-store");
      return json(res, 200, { file: publicFileCapability(capability) });
    }

    m = path.match(/^\/api\/files\/([A-Za-z0-9_-]{43})\/(preview|download)$/);
    if (m && method === "GET") {
      if (surface !== "local") return json(res, 403, { error: "file preview capabilities are local-only" });
      const capability = fileCapabilities.get(m[1]);
      if (!capability) return json(res, 404, { error: "file preview expired or was revoked" });
      const encodedName = encodeURIComponent(capability.name);
      if (m[2] === "download") {
        res.writeHead(200, {
          ...SECURITY_HEADERS,
          "cache-control": "no-store",
          "content-type": capability.mime,
          "content-length": String(capability.bytes.length),
          "content-disposition": "attachment; filename*=UTF-8''" + encodedName,
        });
        return res.end(capability.bytes);
      }
      if (capability.kind === "pdf") {
        res.writeHead(200, {
          ...SECURITY_HEADERS,
          "cache-control": "no-store",
          "content-type": "application/pdf",
          "content-length": String(capability.bytes.length),
          "content-disposition": "attachment; filename*=UTF-8''" + encodedName,
        });
        return res.end(capability.bytes);
      }
      const preview = await buildStructuredPreview(capability.kind, capability.bytes);
      const data = Buffer.from(JSON.stringify({ preview }));
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
        "content-length": String(data.length),
      });
      return res.end(data);
    }

    m = path.match(/^\/api\/bots\/([\w-]+)\/attachments$/);
    if (m && method === "POST") {
      if (surface === "remote" && store.bot(m[1])?.hidden) return json(res, 404, { error: "no such bot" });
      // Await so quota/body/filesystem rejections are handled by this
      // request's bounded error response instead of becoming unhandled.
      return await uploadAttachment(req, res, m[1]);
    }

    m = path.match(/^\/api\/bots\/([\w-]+)\/export$/);
    if (m && method === "GET") {
      if (surface !== "local") return json(res, 403, { error: "transcript export is local-only" });
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      const format = url.searchParams.get("format") ?? "markdown";
      if (format !== "markdown" && format !== "json") return json(res, 400, { error: "format must be markdown or json" });
      const data = format === "json"
        ? transcriptExportJson(bot, store.messagesFor(bot.threadId))
        : transcriptExportMarkdown(bot, store.messagesFor(bot.threadId));
      const safeName = (bot.name || "transcript")
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "transcript";
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        "cache-control": "no-store",
        "content-type": format === "json" ? "application/json; charset=utf-8" : "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="${safeName}.${format === "json" ? "json" : "md"}"`,
      });
      return res.end(data);
    }

    // onboarding/ask cards persist their answered/dismissed state
    m = path.match(/^\/api\/bots\/([\w-]+)\/cards\/([\w-]+)$/);
    if (m && method === "PATCH") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      const existing = store.messagesFor(bot.threadId).find((msg) => msg.id === m![2]);
      if (!existing?.card) return json(res, 404, { error: "no such card" });
      const body = await readBody(req);
      const patched = store.patchMessage(bot.threadId, m[2], {
        card: {
          ...existing.card,
          ...(body.answered !== undefined ? { answered: body.answered } : {}),
          ...(body.dismissed !== undefined ? { dismissed: body.dismissed } : {}),
        },
      });
      broadcast({ kind: "message.patch", threadId: bot.threadId, message: patched });
      return json(res, 200, { message: patched });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/messages$/);
    if (m) {
      const bot = store.bot(m[1]);
      if (!bot || (surface === "remote" && bot.hidden)) return json(res, 404, { error: "no such bot" });
    }
    if (m && method === "GET") {
      const bot = store.bot(m[1])!;
      const requestedLimit = url.searchParams.get("limit");
      const parsedLimit = requestedLimit === null ? MOBILE_MESSAGE_PAGE_LIMIT : Number(requestedLimit);
      if (!Number.isInteger(parsedLimit) || parsedLimit < 1) return json(res, 400, { error: "limit must be a positive integer" });
      const all = store.messagesFor(bot.threadId);
      const around = url.searchParams.get("around");
      if (around !== null) {
        if (surface !== "local") return json(res, 403, { error: "exact transcript navigation is local-only" });
        const windowLimit = requestedLimit === null ? TRANSCRIPT_WINDOW_DEFAULT_LIMIT : parsedLimit;
        return json(res, 200, transcriptMessageWindow(all, around, windowLimit));
      }
      const limit = Math.min(parsedLimit, MOBILE_MESSAGE_PAGE_LIMIT_MAX);
      const before = url.searchParams.get("before") ?? url.searchParams.get("cursor");
      const end = before ? all.findIndex((message) => message.id === before) : all.length;
      if (before && end < 0) return json(res, 400, { error: "unknown before message" });
      const start = Math.max(0, end - limit);
      const page = all.slice(start, end);
      const nextBefore = start > 0 && page.length ? page[0].id : null;
      return json(res, 200, {
        messages: surface === "remote"
          ? page.map((message) => publicMobileMessage(message, visibleRemoteBotIds()))
          : page,
        nextCursor: nextBefore,
        page: {
          limit,
          hasMore: start > 0,
          nextBefore,
        },
      });
    }
    if (m && method === "POST") {
      const bot = store.bot(m[1]);
      if (!bot || (surface === "remote" && bot.hidden)) return json(res, 404, { error: "no such bot" });
      const body = await readBody(req);
      const text = String(body.text ?? "").trim();
      if (!text) return json(res, 400, { error: "text required" });
      const attachmentIds = Array.isArray(body.attachmentIds) ? body.attachmentIds.map(String).slice(0, 10) : [];
      const attachments = workspace.attachmentsFor(m[1], attachmentIds);
      const alreadyQueued = queuedSteering(store.messagesFor(bot.threadId)).length > 0;
      if (bot.busy || alreadyQueued) {
        const message = queueBusySteering(bot, text, attachments);
        if (!bot.busy) scheduleSteeringDrain(bot.id);
        const responseMessage = surface === "remote" ? publicMobileMessage(message, visibleRemoteBotIds()) : message;
        return json(res, 202, { ok: true, queued: true, message: responseMessage });
      }
      const message = await startTurn(m[1], text, { attachments, track: body.track !== false });
      const responseMessage = message && surface === "remote" ? publicMobileMessage(message, visibleRemoteBotIds()) : message;
      return json(res, 202, { ok: true, queued: false, ...(responseMessage ? { message: responseMessage } : {}) });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/computer-preview$/);
    if (m && method === "GET") {
      if (surface !== "remote") return json(res, 404, { error: "no route" });
      res.setHeader("cache-control", "no-store");
      if (!REMOTE_SCREEN_PREVIEW) return json(res, 403, { error: "computer preview is disabled" });
      const bot = store.bot(m[1]);
      if (!bot || bot.hidden) return json(res, 404, { error: "no such bot" });
      const cached = screenPollers.get(bot.id)?.last;
      const transcript = [...store.messagesFor(bot.threadId)]
        .reverse()
        .find((message) => message.kind === "screen" && message.png);
      const source = cached ?? (transcript?.png ? { png: transcript.png, mime: transcript.mime ?? "image/png", capturedAt: transcript.at } : null);
      const preview = source ? decodeMobileComputerPreview(source.png, source.mime) : null;
      if (!preview) return json(res, 200, { available: false });
      return json(res, 200, {
        available: true,
        mime: preview.mime,
        png: preview.bytes.toString("base64"),
        capturedAt: source!.capturedAt,
      });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/respond$/);
    if (m && method === "POST") {
      const bot = store.bot(m[1]);
      if (!bot || (surface === "remote" && bot.hidden)) return json(res, 404, { error: "no such bot" });
      const body = await readBody(req);
      const requestId = typeof body.requestId === "string" ? body.requestId.trim() : "";
      if (!requestId) return json(res, 400, { error: "requestId required" });
      const requestKey = threadEventKey(bot.threadId, requestId);
      const requestMessageId = askMessageByRequest.get(requestKey);
      const requestMessage = requestMessageId
        ? store.messagesFor(bot.threadId).find((message) => message.id === requestMessageId)
        : undefined;
      if (!requestMessage?.card || requestMessage.card.answered) {
        return json(res, 409, { error: "no such pending request" });
      }
      if (!(["allow", "deny", "answer"] as unknown[]).includes(body.behavior)) {
        return json(res, 400, { error: "unknown response behavior" });
      }
      const requestType = requestMessage.card.requestType ?? "question";
      if (requestType === "permission" && body.behavior === "answer") {
        return json(res, 400, { error: "permission requests require allow or deny" });
      }
      if (requestType === "question" && body.behavior !== "answer") {
        return json(res, 400, { error: "question requests require an answer" });
      }
      const instance = registry.get(bot.modelSelection.instanceId);
      if (!instance) return json(res, 409, { error: "provider unavailable" });
      if (body.rememberPolicy !== undefined) {
        if (!["allow", "deny", "ask"].includes(body.rememberPolicy)) {
          return json(res, 400, { error: "unknown approval policy" });
        }
        if (requestMessage.card.requestType !== "permission") {
          return json(res, 400, { error: "approval policy applies only to permission requests" });
        }
      }
      await instance.adapter.respondToRequest(bot.threadId, requestId, {
        behavior: body.behavior,
        message: body.message,
      });
      // Persist a remembered policy only after the owning provider accepted
      // this exact pending request. A stale or forged request must never be
      // able to mutate future approval behavior.
      if (body.rememberPolicy !== undefined) {
        const patched = store.patchBot(bot.id, { approvalPolicy: body.rememberPolicy });
        if (patched) broadcast({ kind: "bot", bot: patched });
      }
      return json(res, 200, { ok: true });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/interrupt$/);
    if (m && method === "POST") {
      const bot = store.bot(m[1]);
      if (!bot || (surface === "remote" && bot.hidden)) return json(res, 404, { error: "no such bot" });
      const instance = registry.get(bot.modelSelection.instanceId);
      await instance?.adapter.interruptTurn(bot.threadId);
      return json(res, 200, { ok: true });
    }

    // identity handshake for the packaged app's port fallback: the forked
    // child proves it is OURS by echoing its pid (a stray dev server has
    // the same API shape but a different pid)
    if (method === "GET" && path === "/api/health") {
      return json(res, 200, {
        app: "cumea",
        ...(surface === "local" ? { pid: process.pid, static: Boolean(STATIC_DIR) } : {}),
        remoteAccess: Boolean(REMOTE),
        capabilities: { computerPreview: REMOTE_SCREEN_PREVIEW },
      });
    }

    // ── provider instances (model picker) ──
    if (method === "GET" && path === "/api/instances") {
      return json(res, 200, { instances: await registry.describe() });
    }

    // ── app config (API keys — never echoed back, booleans only) ──
    if (method === "GET" && path === "/api/config") {
      return json(res, 200, configStatus());
    }
    if ((method === "PUT" || method === "PATCH") && path === "/api/config") {
      const body = await readBody(req);
      const patch: Record<string, object> = {};
      for (const key of ["xai", "composio", "box", "profile"] as const) {
        if (body[key] && typeof body[key] === "object") patch[key] = body[key];
      }
      if (!Object.keys(patch).length) return json(res, 400, { error: "nothing to save" });
      saveConfig(patch);
      Object.assign(cfg, loadConfig());
      // provider keys change the fleet; a profile edit must not kill
      // in-flight turns with a pointless reload
      if (Object.keys(patch).some((k) => k !== "profile")) await reloadProviders();
      const status = configStatus();
      broadcast({ kind: "config", ...status });
      return json(res, 200, status);
    }

    // ── connectors (Composio) ──
    if (method === "GET" && path === "/api/connectors/catalog") {
      const { cards, source } = await composio.listToolkits(cfg);
      return json(res, 200, { configured: Boolean(cfg.composio?.key), source, cards });
    }
    if (method === "GET" && path === "/api/connectors") {
      const services = (url.searchParams.get("services") ?? "").split(",").filter(Boolean);
      if (!cfg.composio?.key) return json(res, 200, { configured: false, services: {} });
      const status = await composio.connectionStatus(cfg, services.length ? services : composio.CURATED_SLUGS);
      return json(res, 200, { configured: true, services: status });
    }
    m = path.match(/^\/api\/connectors\/([\w-]+)\/authorize$/);
    if (m && method === "POST") return json(res, 200, await composio.authorizeService(cfg, m[1]));
    m = path.match(/^\/api\/connectors\/([\w-]+)$/);
    if (m && method === "DELETE") return json(res, 200, await composio.removeService(cfg, m[1]));

    // ── the bot's cloud computer (Box) ──
    m = path.match(/^\/api\/bots\/([\w-]+)\/computer$/);
    if (m && method === "GET") return json(res, 200, await box.boxStatus(cfg, m[1]));
    m = path.match(/^\/api\/bots\/([\w-]+)\/computer\/(provision|join|sleep|exec|screenshot)$/);
    if (m && method === "POST") {
      const botId = m[1];
      const bot = store.bot(botId);
      if (!bot) return json(res, 404, { error: "no such bot" });
      switch (m[2]) {
        case "provision":
          return json(res, 200, await box.provisionBox(cfg, botId, bot.name));
        case "join":
          return json(res, 200, await box.joinBox(cfg, botId));
        case "sleep":
          return json(res, 200, await box.sleepBox(cfg, botId));
        case "exec": {
          const body = await readBody(req);
          return json(res, 200, await box.execOnBox(cfg, botId, String(body.command ?? "")));
        }
        case "screenshot":
          return json(res, 200, await box.screenshotBox(cfg, botId));
      }
    }

    // packaged app: the server serves the built UI too (window → :8799 for
    // everything, no dev proxy to die). CUMEA_STATIC_DIR is set by Electron.
    if (method === "GET" && !path.startsWith("/api/") && STATIC_DIR) {
      const root = resolve(STATIC_DIR);
      const candidate = path === "/" ? "/index.html" : path;
      const file = resolve(root, `.${candidate}`);
      if (file !== root && !file.startsWith(`${root}${sep}`)) return json(res, 404, { error: "not found" });
      try {
        const data = readFileSync(file);
        const headers: Record<string, string> = {
          ...SECURITY_HEADERS,
          "content-type": MIME[extname(file)] ?? "application/octet-stream",
        };
        if (extname(file) === ".html") headers["content-security-policy"] = DOCUMENT_CSP;
        res.writeHead(200, headers);
        return res.end(data);
      } catch {
        // SPA fallback
        try {
          const data = readFileSync(join(STATIC_DIR, "index.html"));
          res.writeHead(200, { ...SECURITY_HEADERS, "content-type": "text/html", "content-security-policy": DOCUMENT_CSP });
          return res.end(data);
        } catch {
          /* fall through to 404 */
        }
      }
    }

    return json(res, 404, { error: `no route: ${method} ${path}` });
  } catch (e) {
    const status = (e as any)?.status ?? 500;
    const message = e instanceof Error ? e.message : String(e);
    return json(res, status, { error: surface === "remote" ? publicRemoteError(status, message) : message });
  }
}

function listenTcp(
  listener: ReturnType<typeof createServer>,
  port: number,
  bind: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      listener.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      listener.off("error", onError);
      try {
        resolve(tcpPort(listener.address()));
      } catch (error) {
        listener.close();
        reject(error);
      }
    };
    listener.once("error", onError);
    listener.once("listening", onListening);
    listener.listen(port, bind);
  });
}

let remoteServer: ReturnType<typeof createServer> | null = null;
if (REMOTE) {
  remoteServer = createServer((req, res) => void handleRequest(req, res, "remote"));
  await listenTcp(remoteServer, REMOTE.port, REMOTE.bind);
  console.log(`Cumea remote listener running on ${REMOTE.bind}:${REMOTE.port}`);
}

const server = createServer((req, res) => void handleRequest(req, res, "local"));
LOCAL_PORT = await listenTcp(server, REQUESTED_LOCAL_PORT, "127.0.0.1");
console.log(`Cumea server running on http://127.0.0.1:${LOCAL_PORT}`);
postHarnessReady(LOCAL_PORT);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearInterval(routineTimer);
    clearInterval(lifecycleTimer);
    clearTimeout(initialRoutineTimer);
    clearTimeout(steeringRecoveryTimer);
    remoteServer?.close();
    server.close();
    store.close();
    void registry.disposeAll().finally(() => process.exit(0));
  });
}
