// Cumea server — the harness host. Clients hold no transports
// (upstream rule): the React app dispatches typed commands over HTTP and
// folds one SSE event stream; every provider process runs here.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, hostname } from "node:os";
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileAtomic } from "./atomic.js";
import * as box from "./box.js";
import { BotResourceGate, TurnEventFence, shouldCleanupStaleProvision, } from "./bot-resource-gate.js";
import * as composio from "./composio.js";
import { ATTACHMENTS_DIR, ensureDirs, instanceConfigs, loadConfig, saveConfig, EVENTS_DIR, NATIVE_DIR } from "./config.js";
import { newId } from "./contracts.js";
import { purgeCommittedFileDeletions, stageFilesForDeletion } from "./delete-files.js";
import { FileCapabilityStore, botWorkspaceDirectory, publicFileCapability, readLocalBotFile, readStoredAttachmentFile, stageBotWorkspaceForDeletion, } from "./file-capabilities.js";
import { buildStructuredPreview } from "./document-preview.js";
import { BUILT_IN_DRIVERS } from "./drivers/builtIn.js";
import { threadEventKey, threadEventPrefix } from "./event-key.js";
import { EventBus } from "./harness/bus.js";
import { EventLogWriter } from "./harness/event-log.js";
import { ProviderRegistry } from "./harness/registry.js";
import { MOBILE_BOOTSTRAP_MESSAGE_LIMIT, MOBILE_MESSAGE_PAGE_LIMIT, MOBILE_MESSAGE_PAGE_LIMIT_MAX, decodeMobileComputerPreview, publicMobileBot, publicMobileMessage, publicMobileWorkspace, sanitizeRemoteSsePayload, } from "./mobile.js";
import { PairingStore } from "./pairing.js";
import { ProviderFleetGate } from "./provider-fleet-gate.js";
import { commitCaptureIfCurrent } from "./screen-capture.js";
import { mentionedBots, parseBotAvatar, Store } from "./store.js";
import { isTemporaryBotCleanupEligible, sweepTemporaryBots, temporaryBotLifecycle } from "./temporary-bots.js";
import { WorkspaceStore } from "./workspace.js";
const PORT = Number(process.env.CUMEA_PORT || 8799);
const STATIC_DIR = process.env.CUMEA_STATIC_DIR || null;
function remoteListenerConfig() {
    if (process.env.CUMEA_REMOTE_ACCESS !== "1")
        return null;
    const port = Number(process.env.CUMEA_REMOTE_PORT || PORT + 1);
    if (!Number.isInteger(port) || port < 1 || port > 65_535 || port === PORT) {
        throw new Error("CUMEA_REMOTE_PORT must be a valid port different from CUMEA_PORT");
    }
    const bind = String(process.env.CUMEA_REMOTE_BIND || "127.0.0.1").trim();
    if (!bind)
        throw new Error("CUMEA_REMOTE_BIND cannot be empty");
    const loopbackBind = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(bind);
    if (!loopbackBind && process.env.CUMEA_REMOTE_ALLOW_DIRECT_BIND !== "1") {
        throw new Error("non-loopback CUMEA_REMOTE_BIND requires CUMEA_REMOTE_ALLOW_DIRECT_BIND=1");
    }
    const rawPublicUrl = String(process.env.CUMEA_REMOTE_PUBLIC_URL || "").trim();
    if (!rawPublicUrl)
        throw new Error("CUMEA_REMOTE_PUBLIC_URL is required when remote access is enabled");
    let publicUrl;
    try {
        publicUrl = new URL(rawPublicUrl);
    }
    catch {
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
const MIME = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
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
function agentsIntegration(botId, depth) {
    return {
        command: process.execPath,
        args: [agentsProxyPath],
        env: {
            ...AGENTS_NODE_FLAG,
            CUMEA_HARNESS_URL: `http://127.0.0.1:${PORT}`,
            CUMEA_BOT_ID: botId,
            CUMEA_COMMS_TOKEN: COMMS_TOKEN,
            CUMEA_TURN_DEPTH: String(depth),
        },
    };
}
/** Run a turn on `targetBotId` and resolve with its assistant text — the
 * synchronous half of ask_bot. Subscribes to the bus, folds assistant_text
 * for that thread, resolves on turn.completed (or a 4-min ceiling). */
function askBotAndWait(targetBotId, message, depth, sourceBotId) {
    const target = store.bot(targetBotId);
    if (!target)
        return Promise.resolve("(no such bot)");
    const threadId = target.threadId;
    const turnId = newId();
    return new Promise((resolve) => {
        let text = "";
        let done = false;
        const finish = (out) => {
            if (done)
                return;
            done = true;
            clearTimeout(timer);
            unsub();
            resolve(out);
        };
        const unsub = bus.subscribe((e) => {
            // EventBus rejects stale generations before fanout. Keep this listener
            // correlated by the harness-issued ids only: the primary folder
            // subscriber runs first and retires the accepted fence on completion.
            if (e.threadId !== threadId || e.turnId !== turnId)
                return;
            if (e.type === "item.completed" && e.itemType === "assistant_text") {
                text += (text ? "\n" : "") + e.text;
            }
            else if (e.type === "turn.completed") {
                finish(text || "(the bot finished without a text reply)");
            }
        });
        const timer = setTimeout(() => finish(text || "(timed out waiting for the bot to reply)"), 4 * 60_000);
        startTurn(targetBotId, message, {
            commsDepth: depth + 1,
            source: "handoff",
            sourceBotId,
            taskTitle: `Handoff from ${store.bot(sourceBotId ?? "")?.name ?? "another bot"}`,
            turnId,
        }).catch((err) => finish(`(couldn't start that bot: ${err instanceof Error ? err.message : String(err)})`));
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
const store = new Store(() => bootSelection);
const workspace = new WorkspaceStore();
const pairing = new PairingStore();
const fileCapabilities = new FileCapabilityStore();
const botResourceGate = new BotResourceGate();
const turnEventFence = new TurnEventFence();
const providerFleetGate = new ProviderFleetGate();
bootSelection = await defaultSelection();
store.seedIfEmpty();
// Event persistence follows the canonical bot roster instead of accumulating
// per-process deletion tombstones. Once a bot transaction commits, callbacks
// from its interrupted provider session can no longer recreate its log.
const bus = new EventBus(new EventLogWriter({
    isThreadActive: (threadId) => Boolean(store.botByThread(threadId)),
}), (event) => turnEventFence.accepts(event.threadId, event.type, event.turnId));
bus.attach(registry.instances());
const sseClients = new Map();
function visibleRemoteBotIds() {
    return new Set(store.bots.filter((bot) => !bot.hidden).map((bot) => bot.id));
}
/** Visibility is resolved against the canonical store immediately before
 * every remote write. Unknown/malformed bot-scoped event families fail closed. */
function visibleRemoteSsePayload(payload, allowDeletedBot) {
    if (!payload || typeof payload !== "object")
        return null;
    const envelope = payload;
    switch (envelope.kind) {
        case "bot": {
            const eventBot = envelope.bot;
            if (typeof eventBot?.id !== "string")
                return null;
            const current = store.bot(eventBot.id);
            return current && !current.hidden ? payload : null;
        }
        case "message":
        case "message.patch": {
            if (typeof envelope.threadId !== "string")
                return null;
            return store.bots.some((bot) => bot.threadId === envelope.threadId && !bot.hidden) ? payload : null;
        }
        case "runtime": {
            const event = envelope.event;
            if (typeof event?.threadId !== "string")
                return null;
            return store.bots.some((bot) => bot.threadId === event.threadId && !bot.hidden) ? payload : null;
        }
        case "bot.deleted":
            return allowDeletedBot && typeof envelope.botId === "string" && envelope.botId ? payload : null;
        default:
            return payload;
    }
}
function broadcast(payload, options = {}) {
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
        if (outgoing === null)
            continue;
        const frame = `data: ${JSON.stringify(outgoing)}\n\n`;
        try {
            res.write(frame);
        }
        catch {
            sseClients.delete(res);
        }
    }
}
function publicAttachment(attachment) {
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
// ── server-side event folding (upstream's ingestion worker, miniature) ──
// The canonical stream is the source of truth; the persisted transcript
// and every client view are projections of it.
const toolMessageByItem = new Map(); // threadId + itemId -> messageId
const askMessageByRequest = new Map(); // threadId + requestId -> messageId
const activeRunByThread = new Map();
const activeProviderTurnByThread = new Map();
/** Serializes manual and automatic deletion for the same bot. */
const deletingBotIds = new Set();
/** Threads whose current turn actually invoked a computer tool. */
const usedComputerByThread = new Set();
/** Detached provider callbacks must prove both generation and canonical store
 * ownership. The object-identity check prevents an ABA-style replacement with
 * the same public ids; the gate generation stays invalid after delete rollback. */
function isCanonicalBotOperation(bot, operation) {
    return ((operation?.isCurrent() ?? true) &&
        !deletingBotIds.has(bot.id) &&
        !botResourceGate.isDeleting(bot.id) &&
        store.bot(bot.id) === bot &&
        store.botByThread(bot.threadId) === bot);
}
function clearThreadEventState(threadId) {
    const prefix = threadEventPrefix(threadId);
    for (const key of toolMessageByItem.keys())
        if (key.startsWith(prefix))
            toolMessageByItem.delete(key);
    for (const key of askMessageByRequest.keys())
        if (key.startsWith(prefix))
            askMessageByRequest.delete(key);
    usedComputerByThread.delete(threadId);
}
bus.subscribe((event) => {
    const bot = store.botByThread(event.threadId);
    if (!bot ||
        !isCanonicalBotOperation(bot) ||
        !turnEventFence.accepts(event.threadId, event.type, event.turnId))
        return;
    // Provider callbacks may outlive an interrupted/deleted session. Resolve
    // canonical ownership before exposing diagnostics to any local SSE client.
    broadcast({ kind: "runtime", event });
    const pushMessage = (m) => {
        const message = store.appendMessage(event.threadId, m);
        broadcast({ kind: "message", threadId: event.threadId, message });
        return message;
    };
    try {
        switch (event.type) {
            case "session.started":
                if (event.sessionId && event.providerInstanceId) {
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
                }
                else if (event.itemType === "tool" && event.itemId) {
                    const key = threadEventKey(event.threadId, event.itemId);
                    const messageId = toolMessageByItem.get(key);
                    if (messageId) {
                        const patched = store.patchMessage(event.threadId, messageId, {
                            tool: { name: store.messagesFor(event.threadId).find((m) => m.id === messageId)?.tool?.name ?? "tool", ok: event.ok },
                        });
                        if (patched)
                            broadcast({ kind: "message.patch", threadId: event.threadId, message: patched });
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
                    if (event.itemId)
                        toolMessageByItem.set(threadEventKey(event.threadId, event.itemId), message.id);
                    if ((event.title ?? "").startsWith("mcp__computer__"))
                        usedComputerByThread.add(event.threadId);
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
                    if (instance) {
                        const approvalOperation = botResourceGate.beginDetachedOperation(bot.id);
                        void instance.adapter.respondToRequest(event.threadId, event.requestId ?? "", { behavior })
                            .catch((error) => {
                            // A provider rejection can arrive after DELETE committed and the
                            // transcript was removed. Never let that callback recreate it.
                            if (!isCanonicalBotOperation(bot, approvalOperation))
                                return;
                            const message = error instanceof Error ? error.message : String(error);
                            pushMessage({ role: "bot", kind: "activity", tool: { name: `approval policy failed: ${message.slice(0, 120)}`, ok: false } });
                        })
                            .finally(approvalOperation.release);
                    }
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
                if (event.requestId)
                    askMessageByRequest.set(threadEventKey(event.threadId, event.requestId), message.id);
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
                        if (patched)
                            broadcast({ kind: "message.patch", threadId: event.threadId, message: patched });
                    }
                    if (key)
                        askMessageByRequest.delete(key);
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
                // the last live frame becomes a settled inline screen message —
                // the screenshot-in-chat moment
                const frame = stopScreenPoller(bot.id);
                if (frame && usedComputerByThread.has(event.threadId)) {
                    const message = pushMessage({ role: "bot", kind: "screen", png: frame.png, mime: frame.mime });
                    const runId = activeRunByThread.get(event.threadId);
                    if (runId)
                        workspace.addArtifact(runId, { kind: "screen", label: "Final screen", messageId: message.id, mime: frame.mime });
                }
                const runId = activeRunByThread.get(event.threadId);
                if (runId) {
                    workspace.completeRun(runId, event.ok, event.stopReason || (event.ok ? undefined : "Provider run failed"));
                    activeRunByThread.delete(event.threadId);
                    broadcastWorkspace();
                }
                store.patchBot(bot.id, { busy: false, unread: true });
                const providerTurn = activeProviderTurnByThread.get(event.threadId);
                if (providerTurn?.turnId === event.turnId)
                    activeProviderTurnByThread.delete(event.threadId);
                broadcast({ kind: "bot", bot: store.bot(bot.id) });
                clearThreadEventState(event.threadId);
                break;
            }
        }
    }
    finally {
        if (event.type === "turn.completed")
            turnEventFence.complete(event.threadId, event.turnId);
    }
});
const screenPollers = new Map();
function startScreenPoller(botId) {
    if (screenPollers.has(botId) || !box.boxConfigured(cfg))
        return;
    let inFlight = false;
    const capture = async () => {
        if (inFlight)
            return;
        inFlight = true;
        try {
            await commitCaptureIfCurrent(async () => {
                const { png, format } = await box.screenshotBox(cfg, botId);
                return { png, mime: format === "jpeg" ? "image/jpeg" : "image/png", capturedAt: Date.now() };
            }, () => screenPollers.get(botId) === entry && Boolean(store.bot(botId)) && !deletingBotIds.has(botId), (frame) => {
                entry.last = frame;
                broadcast({ kind: "screen", botId, png: frame.png, mime: frame.mime });
            });
        }
        catch {
            /* box asleep or mid-command — try again next tick */
        }
        finally {
            inFlight = false;
        }
    };
    const entry = {
        timer: setInterval(capture, 4000),
        capture,
        last: null,
    };
    screenPollers.set(botId, entry);
}
/** Event-driven refresh: capture NOW (the bot just acted on its screen)
 * instead of waiting for the next interval tick. */
function pokeScreenPoller(botId) {
    void screenPollers.get(botId)?.capture();
}
function stopScreenPoller(botId) {
    const entry = screenPollers.get(botId);
    if (!entry)
        return null;
    clearInterval(entry.timer);
    screenPollers.delete(botId);
    return entry.last;
}
// Local computer-use contract written by Electron main on startup
// (~/Library/Application Support/Cumea/cua-connection.json). Read
// fresh each turn — Electron may restart or permissions may change.
function readCuaConnection() {
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
            if (!conn || conn.mode === "unavailable" || !conn.mcpCommand)
                continue;
            return { command: conn.mcpCommand, args: conn.mcpArgs ?? ["mcp"], env: conn.mcpEnv ?? {} };
        }
        catch {
            /* try the next location */
        }
    }
    return null;
}
async function startTurn(botId, text, opts = {}) {
    const providerFleet = providerFleetGate.snapshot();
    const bot = store.bot(botId);
    if (!bot)
        throw Object.assign(new Error("no such bot"), { status: 404 });
    if (!providerFleet.isCurrent()) {
        throw Object.assign(new Error("providers are reloading — retry in a moment"), { status: 409 });
    }
    if (deletingBotIds.has(bot.id) || botResourceGate.isDeleting(bot.id)) {
        throw Object.assign(new Error("the bot is being deleted"), { status: 409 });
    }
    if (bot.busy)
        throw Object.assign(new Error("the bot is already working — interrupt it first"), { status: 409 });
    const commsDepth = opts.commsDepth ?? 0;
    const eventTurnId = opts.turnId ?? newId();
    const attachments = opts.attachments ?? [];
    const localWorkspace = botWorkspaceDirectory(bot.id);
    // Provider ownership is immutable for this dispatch even if unrelated bot
    // settings are edited while provisioning is in flight.
    const selection = { ...bot.modelSelection };
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
    if (opts.track !== false && !task)
        throw Object.assign(new Error("no such task"), { status: 404 });
    if (task && task.botId !== bot.id) {
        throw Object.assign(new Error("task belongs to another bot"), { status: 409 });
    }
    const userMessage = store.appendMessage(bot.threadId, {
        role: "user",
        kind: "text",
        text,
        ...(attachments.length ? { attachments: attachments.map(publicAttachment) } : {}),
    });
    broadcast({ kind: "message", threadId: bot.threadId, message: userMessage });
    let runId;
    if (task) {
        const run = workspace.createRun(task.id);
        runId = run.id;
        broadcastWorkspace();
    }
    const instance = registry.get(selection.instanceId);
    if (!instance) {
        const message = `provider instance "${selection.instanceId}" is unavailable — pick another model in settings`;
        if (runId)
            workspace.completeRun(runId, false, message);
        broadcastWorkspace();
        throw Object.assign(new Error(message), { status: 409 });
    }
    if (runId)
        activeRunByThread.set(bot.threadId, runId);
    // transcript for API-backed drivers: settled text turns only
    const transcript = store
        .messagesFor(bot.threadId)
        .filter((m) => m.kind === "text" && m.text && m.id !== userMessage.id)
        .slice(-40)
        .map((m) => ({ role: m.role === "user" ? "user" : "assistant", text: m.text }));
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
    const turnOperation = botResourceGate.beginDetachedOperation(bot.id);
    const eventAdmission = turnEventFence.begin(bot.threadId, eventTurnId);
    const isCurrentBot = () => isCanonicalBotOperation(bot, turnOperation);
    const isCurrentTurn = () => isCurrentBot() &&
        providerFleet.isCurrent() &&
        (!runId || activeRunByThread.get(bot.threadId) === runId);
    let cloudProvisionMayExist = false;
    let provisionedBoxId;
    let lateProvisionCleanupAttempted = false;
    let providerTurnAccepted = false;
    const cleanupLateProvision = async () => {
        if (!cloudProvisionMayExist ||
            lateProvisionCleanupAttempted ||
            !shouldCleanupStaleProvision(store.bot(bot.id)))
            return;
        lateProvisionCleanupAttempted = true;
        if (provisionedBoxId) {
            const result = await box.archiveBoxByIdForDeletion(cfg, provisionedBoxId);
            if (result.outcome === "warning") {
                console.warn(`cloud computer cleanup warning during late provisioning for bot ${bot.id}: ${result.warning}`);
            }
        }
        else
            await archiveBotComputerForDeletion(bot.id, "late provisioning");
    };
    void (async () => {
        try {
            const integrations = {};
            if (bot.appsEnabled !== false && instance.adapter.capabilities.composioMcp === true && cfg.composio?.key) {
                integrations.composio = { key: cfg.composio.key, url: cfg.composio.url };
            }
            const wants = bot.computer; // 'cloud' | 'local' | 'off' | undefined(auto)
            if (instance.adapter.capabilities.cloudComputerMcp === true && wants !== "off" && wants !== "local" && box.boxConfigured(cfg)) {
                let b = await box.findBox(cfg, bot.id).catch(() => null);
                if (!isCurrentTurn())
                    return;
                // the Computer driver runs ON the box — provision it on first use
                if (!b && instance.driverKind === "boxAgent") {
                    if (!isCurrentTurn())
                        return;
                    broadcast({ kind: "computer", botId: bot.id, state: "provisioning" });
                    // provisionBox may create the substrate before its promise settles.
                    // If DELETE closes the generation during that await, the stale turn
                    // must archive the late Box because the canonical delete may already
                    // have completed its initial owner lookup.
                    cloudProvisionMayExist = true;
                    const provisioned = await box.provisionBox(cfg, bot.id, bot.name);
                    provisionedBoxId = provisioned.boxId;
                    if (!isCurrentTurn()) {
                        if (!isCurrentBot())
                            await cleanupLateProvision();
                        return;
                    }
                    b = await box.findBox(cfg, bot.id).catch(() => null);
                    if (!isCurrentTurn())
                        return;
                }
                if (b)
                    integrations.computer = { boxId: b.id, token: cfg.box.token };
            }
            // local computer (this Mac) via the Electron-hosted cua-driver: the
            // Electron main process owns the daemon (TCC attribution) and writes
            // its spawn contract to cua-connection.json; the harness only reads it
            if (instance.adapter.capabilities.localComputerMcp === true && !integrations.computer && wants !== "off" && wants !== "cloud") {
                const cua = readCuaConnection();
                if (cua)
                    integrations.localComputer = cua;
            }
            // peer-agent comms: give a user-initiated turn the list_bots/ask_bot
            // tools. A comms-invoked turn (depth ≥ cap) gets none — hard recursion
            // stop, so the user's tokens can't be burned by a bot-to-bot loop.
            // Only drivers that mount the tools get the integration (and, via the
            // integrations.agents gate below, the prompt hint) — a bot on a driver
            // without it must not be told about tools it cannot call. Any bot can
            // still be the TARGET of ask_bot regardless of its driver.
            if (commsDepth < MAX_COMMS_DEPTH &&
                bot.collaborationEnabled !== false &&
                instance.adapter.capabilities.agentsMcp === true &&
                store.bots.filter((b) => b.id !== bot.id && !b.hidden).length > 0) {
                integrations.agents = agentsIntegration(bot.id, commsDepth);
            }
            // @mentions in the user's message (the composer's tagging UI) become
            // an explicit delegation nudge — the agent still does the ask_bot call
            // itself, so the harness stays the single owner of turns/permissions
            const tagged = integrations.agents
                ? mentionedBots(providerText, store.bots.filter((b) => b.id !== bot.id))
                : [];
            // Last synchronous fence before invoking a provider. Deletion changes
            // the generation before its first await, so provisioning that resumes
            // late can never start a new turn for a removed bot.
            if (!isCurrentTurn())
                return;
            if (!eventAdmission.markDispatching())
                return;
            activeProviderTurnByThread.set(bot.threadId, { instanceId: selection.instanceId, turnId: eventTurnId });
            const started = await instance.adapter.sendTurn({
                threadId: bot.threadId,
                turnId: eventTurnId,
                text: providerText,
                model: selection.model,
                resumeCursor: bot.resumeCursors[selection.instanceId],
                transcript,
                cwd: localWorkspace,
                system: persona +
                    " Put user-facing files you create locally in the current working directory and cite them as ./filename.ext so Cumea can open them safely. When you create a file through the cloud computer, put it under /workspace and cite its absolute /workspace/path. Never cite a private configuration or credential path as a deliverable." +
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
            if (!isCurrentBot() || !providerFleet.isCurrent()) {
                // DELETE may have raced with the provider's own asynchronous session
                // setup after its first interrupt saw no live turn. Stop it again once
                // sendTurn settles, but never persist anything for the stale bot.
                await instance.adapter.interruptTurn(bot.threadId).catch(() => { });
                const providerTurn = activeProviderTurnByThread.get(bot.threadId);
                if (providerTurn?.turnId === eventTurnId)
                    activeProviderTurnByThread.delete(bot.threadId);
                return;
            }
            if (!eventAdmission.bindReturnedTurnId(started.turnId)) {
                await instance.adapter.interruptTurn(bot.threadId, started.turnId).catch(() => { });
                return;
            }
            providerTurnAccepted = true;
            // A very fast provider can legitimately emit turn.completed before its
            // sendTurn promise continuation runs. In that case the run is already
            // settled; do not mistake it for deletion or re-bind/restart polling.
            const turnStillActive = runId
                ? activeRunByThread.get(bot.threadId) === runId
                : store.bot(bot.id)?.busy === true;
            if (runId && turnStillActive) {
                workspace.bindTurn(runId, started.turnId);
                broadcastWorkspace();
            }
            if (integrations.computer && turnStillActive)
                startScreenPoller(bot.id);
        }
        catch (e) {
            const providerTurn = activeProviderTurnByThread.get(bot.threadId);
            if (providerTurn?.turnId === eventTurnId)
                activeProviderTurnByThread.delete(bot.threadId);
            if (!isCurrentBot()) {
                await cleanupLateProvision();
                return;
            }
            if (!isCurrentTurn()) {
                return;
            }
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
                broadcastWorkspace();
            }
            store.patchBot(bot.id, { busy: false });
            broadcast({ kind: "bot", bot: store.bot(bot.id) });
        }
        finally {
            // A normally running turn owns the fence until turn.completed. Failed or
            // cancelled dispatches must close it here so late callbacks stay stale.
            if (!providerTurnAccepted || !eventAdmission.isCurrent() || !isCurrentBot())
                eventAdmission.invalidate();
            turnOperation.release();
        }
    })();
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
    const configs = instanceConfigs(cfg);
    const reload = providerFleetGate.reload(async (fleet) => {
        // A superseded queued reload must not detach the newer fleet.
        if (!fleet.isLatest())
            return;
        bus.detachAll();
        await registry.disposeAll();
        if (!fleet.isLatest())
            return;
        await registry.load(configs);
        if (!fleet.isLatest()) {
            // A later reload was admitted while this fleet was being created.
            await registry.disposeAll();
            return;
        }
        bus.attach(registry.instances());
        // disposeAll terminates old turns after the bus is detached, so their
        // completion events cannot clear persisted UI state for us.
        for (const bot of store.bots) {
            if (!bot.busy)
                continue;
            store.patchBot(bot.id, { busy: false });
            const runId = activeRunByThread.get(bot.threadId);
            if (runId) {
                workspace.completeRun(runId, false, "Providers reloaded while the task was running.");
                activeRunByThread.delete(bot.threadId);
            }
            activeProviderTurnByThread.delete(bot.threadId);
            clearThreadEventState(bot.threadId);
            broadcast({ kind: "bot", bot: store.bot(bot.id) });
        }
        broadcastWorkspace();
    });
    // reload() invalidated the fleet generation synchronously above. Retire all
    // accepted event ids in the same stack, before the queued reload can await.
    for (const bot of store.bots)
        turnEventFence.invalidate(bot.threadId);
    await reload;
}
async function runRoutine(routineId, manual = false) {
    try {
        const owner = workspace.snapshot().routines.find((candidate) => candidate.id === routineId);
        if (!owner)
            throw Object.assign(new Error("no such routine"), { status: 404 });
        await botResourceGate.run(owner.botId, async () => {
            const routine = workspace.snapshot().routines.find((candidate) => candidate.id === routineId);
            const bot = store.bot(owner.botId);
            if (!routine || routine !== owner || routine.botId !== owner.botId) {
                throw Object.assign(new Error("no such routine"), { status: 404 });
            }
            if (!bot) {
                workspace.markRoutineFailure(routine.id, "The routine's bot no longer exists.");
                broadcastWorkspace();
                if (manual)
                    throw Object.assign(new Error("the routine's bot no longer exists"), { status: 409 });
                return;
            }
            if (!isCanonicalBotOperation(bot)) {
                throw Object.assign(new Error("the bot is being deleted"), { status: 409 });
            }
            workspace.advanceRoutine(routine.id);
            if (bot.busy) {
                workspace.markRoutineFailure(routine.id, "The bot was already working when this routine became due.");
                broadcastWorkspace();
                if (manual)
                    throw Object.assign(new Error("the bot is already working"), { status: 409 });
                return;
            }
            broadcastWorkspace();
            try {
                await startTurn(bot.id, routine.prompt, {
                    source: "routine",
                    routineId: routine.id,
                    taskTitle: routine.name,
                });
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                workspace.markRoutineFailure(routine.id, message);
                broadcastWorkspace();
                if (manual)
                    throw error;
            }
        });
    }
    catch (error) {
        // A scheduled run racing a manual delete is simply obsolete: the delete
        // transaction owns removal of that routine. Manual callers receive the
        // bounded conflict so they never observe an acknowledged lost mutation.
        if (!manual && error?.status === 409)
            return;
        if (manual)
            throw error;
        throw error;
    }
}
/** Archive a bot-owned Box without turning provider downtime into a durable
 * deletion blocker. Both manual DELETE and temporary expiry call the same
 * canonical transaction below; the late-provision fence above reuses this
 * observer for the one substrate race that can finish after metadata commit. */
async function archiveBotComputerForDeletion(botId, context) {
    const result = await box.archiveBoxForBotDeletion(cfg, botId);
    if (result.outcome === "warning") {
        // The helper deliberately redacts provider responses and credentials.
        console.warn(`cloud computer cleanup warning during ${context} for bot ${botId}: ${result.warning}`);
    }
    return result;
}
function automaticDeletionStillEligible(bot) {
    return store.bot(bot.id) === bot && isTemporaryBotCleanupEligible({
        bot,
        workspace: workspace.snapshot(),
        messages: store.messagesFor(bot.threadId),
        hasActiveTurn: activeRunByThread.has(bot.threadId),
        isPendingRequest: (requestId) => askMessageByRequest.has(threadEventKey(bot.threadId, requestId)),
    });
}
/** The one canonical bot deletion transaction, shared by explicit DELETE and
 * temporary-bot expiry. Files are quarantined before either metadata store is
 * committed. Irreversible purge is post-commit garbage collection: a purge
 * failure may leave private quarantine bytes behind, but can never restore a
 * bot whose transcript was already partly destroyed. */
async function deleteBotTransactionally(botId, options = {}) {
    const bot = store.bot(botId);
    if (!bot)
        throw Object.assign(new Error("no such bot"), { status: 404 });
    if (deletingBotIds.has(bot.id))
        throw Object.assign(new Error("the bot is already being deleted"), { status: 409 });
    // The sweeper's candidate snapshot is advisory. A Keep permanently PATCH or
    // newly durable work may commit before this transaction closes admission.
    if (options.automatic && !automaticDeletionStillEligible(bot))
        return { deleted: false };
    // Close admission synchronously before the first await. Operations already
    // inside the gate finish first, so their bytes/capabilities are included in
    // this delete; anything arriving later receives a bounded conflict.
    const resourceBarrier = botResourceGate.beginDeletion(bot.id);
    deletingBotIds.add(bot.id);
    turnEventFence.invalidate(bot.threadId);
    try {
        await resourceBarrier.idle;
        if (options.automatic && !automaticDeletionStillEligible(bot))
            return { deleted: false };
        // Manual deletion is allowed to stop current work. Automatic cleanup gets
        // here only after the sweeper proves there is no active turn/work state.
        if (!options.automatic) {
            const activeProviderTurn = activeProviderTurnByThread.get(bot.threadId);
            const activeInstanceId = activeProviderTurn?.instanceId ?? bot.modelSelection.instanceId;
            await registry.get(activeInstanceId)?.adapter
                .interruptTurn(bot.threadId, activeProviderTurn?.turnId)
                .catch(() => { });
        }
        stopScreenPoller(bot.id);
        const runId = activeRunByThread.get(bot.threadId);
        if (runId) {
            workspace.completeRun(runId, false, "interrupted");
            activeRunByThread.delete(bot.threadId);
        }
        // Invalidate before any provider or filesystem await. A failed deletion
        // reopens the bot gate, never the callbacks from its pre-delete turn.
        activeProviderTurnByThread.delete(bot.threadId);
        clearThreadEventState(bot.threadId);
        // Preserve the durable owner identity until the bounded stop attempt has
        // resolved. Provider downtime only produces an observable warning; every
        // created Box retains its provider-side TTL as the final billing backstop.
        const computerCleanup = await archiveBotComputerForDeletion(bot.id, "bot deletion");
        let stagedFiles = null;
        let stagedBotWorkspace = null;
        let eventLogTransaction = null;
        let workspaceTransaction = null;
        let botTransaction = null;
        try {
            eventLogTransaction = bus.prepareThreadDeletion(bot.threadId);
            // Same-volume rename is the prepare phase: no bytes are destroyed until
            // both metadata stores commit, and every path can still be restored.
            stagedFiles = stageFilesForDeletion([
                ...store.botDeletionFiles(bot.id),
                { path: join(EVENTS_DIR, `${bot.threadId}.ndjson`), label: "event log" },
                { path: join(NATIVE_DIR, `${bot.threadId}.ndjson`), label: "native log" },
                ...workspace.botDeletionFiles(bot.id),
            ]);
            stagedBotWorkspace = stageBotWorkspaceForDeletion(bot.id);
            workspaceTransaction = workspace.removeBotDataTransaction(bot.id);
            botTransaction = store.deleteBotRecordTransaction(bot.id);
            if (!botTransaction)
                throw Object.assign(new Error("bot disappeared during deletion"), { status: 500 });
            botTransaction.finalize();
            eventLogTransaction.finalize();
        }
        catch (error) {
            const rollbackErrors = [];
            for (const rollback of [
                botTransaction?.rollback,
                workspaceTransaction?.rollback,
                stagedBotWorkspace?.rollback,
                stagedFiles?.rollback,
                eventLogTransaction?.rollback,
            ]) {
                if (!rollback)
                    continue;
                try {
                    rollback();
                }
                catch (rollbackError) {
                    rollbackErrors.push(rollbackError);
                }
            }
            // The bot remains the durable retry anchor when cleanup cannot finish.
            try {
                const patched = store.patchBot(bot.id, { busy: false });
                if (patched)
                    broadcast({ kind: "bot", bot: patched });
            }
            catch { }
            if (computerCleanup.outcome === "stop-requested") {
                const resumed = await box.resumeBoxAfterDeletionRollback(cfg, bot.id);
                if (resumed.outcome === "warning") {
                    console.warn(`cloud computer resume warning after deletion rollback for bot ${bot.id}: ${resumed.warning}`);
                }
            }
            broadcastWorkspace();
            if (rollbackErrors.length) {
                throw Object.assign(new Error("bot deletion failed and could not be fully rolled back"), {
                    status: 500,
                    cause: new AggregateError([error, ...rollbackErrors]),
                });
            }
            throw error;
        }
        // Metadata deletion and the event-log liveness gate are now committed. Purge
        // each quarantine independently and never attempt an impossible rollback
        // after an unlink/recursive removal has begun.
        purgeCommittedFileDeletions([stagedFiles, stagedBotWorkspace], (error) => console.error("could not purge committed bot deletion quarantine", error));
        // Capabilities are in-memory snapshots, so revoke them before clients can
        // observe bot.deleted. No preview remains usable after that event.
        fileCapabilities.revokeBot(bot.id);
        broadcast({ kind: "bot.deleted", botId: bot.id, ...(options.operationId ? { operationId: options.operationId } : {}) }, { remoteDeletedBotWasVisible: !bot.hidden });
        broadcastWorkspace();
        return { deleted: true, removed: workspaceTransaction.removed, computerCleanup };
    }
    finally {
        deletingBotIds.delete(bot.id);
        resourceBarrier.release();
    }
}
let sweepingTemporaryBots = false;
async function dispatchTemporaryBotCleanup() {
    if (sweepingTemporaryBots)
        return;
    sweepingTemporaryBots = true;
    try {
        const result = await sweepTemporaryBots({
            bots: () => store.bots,
            workspace: () => workspace.snapshot(),
            messagesFor: (threadId) => store.messagesFor(threadId),
            hasActiveTurn: (threadId) => activeRunByThread.has(threadId),
            isPendingRequest: (threadId, requestId) => askMessageByRequest.has(threadEventKey(threadId, requestId)),
            deleteBot: (botId) => deleteBotTransactionally(botId, { automatic: true }).then((result) => result.deleted),
        });
        for (const failed of result.failed) {
            const message = failed.error instanceof Error ? failed.error.message : String(failed.error);
            console.error(`temporary bot cleanup failed for ${failed.botId}: ${message}`);
        }
    }
    finally {
        sweepingTemporaryBots = false;
    }
}
let dispatchingRoutines = false;
async function dispatchDueRoutines() {
    if (dispatchingRoutines)
        return;
    dispatchingRoutines = true;
    try {
        for (const routine of workspace.dueRoutines())
            await runRoutine(routine.id);
    }
    finally {
        dispatchingRoutines = false;
    }
}
const routineTimer = setInterval(() => void dispatchDueRoutines(), 30_000);
routineTimer.unref();
const initialRoutineTimer = setTimeout(() => void dispatchDueRoutines(), 1_000);
initialRoutineTimer.unref();
const temporaryBotTimer = setInterval(() => void dispatchTemporaryBotCleanup(), 30_000);
temporaryBotTimer.unref();
const initialTemporaryBotTimer = setTimeout(() => void dispatchTemporaryBotCleanup(), 1_000);
initialTemporaryBotTimer.unref();
// ── HTTP plumbing ─────────────────────────────────────────────────────
function json(res, status, body) {
    const data = JSON.stringify(body);
    res.writeHead(status, { ...SECURITY_HEADERS, "content-type": "application/json" });
    res.end(data);
}
function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = "";
        let done = false;
        const fail = (error) => {
            if (done)
                return;
            done = true;
            reject(error);
        };
        req.on("data", (c) => {
            if (done)
                return;
            data += c;
            if (Buffer.byteLength(data, "utf8") > 1_000_000)
                fail(Object.assign(new Error("body too large"), { status: 413 }));
        });
        req.on("end", () => {
            if (done)
                return;
            try {
                const body = data ? JSON.parse(data) : {};
                done = true;
                resolve(body);
            }
            catch {
                fail(Object.assign(new Error("invalid JSON body"), { status: 400 }));
            }
        });
        req.on("aborted", () => fail(Object.assign(new Error("request body was aborted"), { status: 400 })));
        req.on("error", (error) => fail(error));
    });
}
const ATTACHMENT_MAX_FILE_BYTES = 25 * 1024 * 1024;
function readBytes(req, maxBytes = ATTACHMENT_MAX_FILE_BYTES) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;
        let done = false;
        const fail = (error) => {
            if (done)
                return;
            done = true;
            reject(error);
        };
        req.on("data", (chunk) => {
            if (done)
                return;
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            total += bytes.length;
            if (total > maxBytes) {
                fail(Object.assign(new Error("attachment is larger than 25 MB"), { status: 413 }));
                return;
            }
            chunks.push(bytes);
        });
        req.on("end", () => {
            if (done)
                return;
            done = true;
            resolve(Buffer.concat(chunks));
        });
        req.on("aborted", () => fail(Object.assign(new Error("attachment upload was aborted"), { status: 400 })));
        req.on("error", fail);
    });
}
async function uploadAttachment(req, res, botId) {
    return botResourceGate.run(botId, async () => {
        const bot = store.bot(botId);
        if (!bot)
            return json(res, 404, { error: "no such bot" });
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
        }
        catch {
            throw Object.assign(new Error("invalid attachment name"), { status: 400 });
        }
        const safeName = basename(requestedName)
            .replace(/[\u0000-\u001f\u007f]/g, "")
            .trim()
            .slice(0, 180) || "attachment";
        const bytes = await readBytes(req);
        if (!bytes.length)
            return json(res, 400, { error: "attachment is empty" });
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
    });
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
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "connect-src 'self' http://127.0.0.1:8799 http://127.0.0.1:5199 http://localhost:8799 http://localhost:5199 ws://127.0.0.1:5199 ws://localhost:5199",
    "font-src 'self' data:",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
].join("; ");
function requestOriginAllowed(req, method) {
    if (["GET", "HEAD", "OPTIONS"].includes(method))
        return true;
    const origin = req.headers.origin;
    if (!origin)
        return true; // native app, CLI, and internal agent helpers
    try {
        const url = new URL(origin);
        const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
        return url.protocol === "http:" && loopback && [String(PORT), "5199"].includes(url.port);
    }
    catch {
        return false;
    }
}
function bearerToken(req) {
    const header = req.headers.authorization;
    if (!header || Array.isArray(header))
        return null;
    const match = header.match(/^Bearer ([^\s]+)$/);
    return match?.[1] ?? null;
}
/** Least-privilege mobile surface. Provider credentials, connector setup,
 * instance metadata, and raw computer execution remain local-only. */
function remoteRouteAllowed(method, path) {
    if (method === "GET" && ["/api/health", "/api/mobile/bootstrap", "/api/events", "/api/work", "/api/bots"].includes(path)) {
        return true;
    }
    if (method === "GET" && /^\/api\/bots\/[\w-]+\/messages$/.test(path))
        return true;
    if (method === "GET" && /^\/api\/bots\/[\w-]+\/computer-preview$/.test(path))
        return true;
    if (method === "DELETE" && /^\/api\/attachments\/[\w-]+$/.test(path))
        return true;
    if (method === "POST" && path === "/api/bots")
        return true;
    if (method === "POST" && /^\/api\/bots\/[\w-]+\/attachments$/.test(path))
        return true;
    if (method === "PATCH" && /^\/api\/bots\/[\w-]+$/.test(path))
        return true;
    if (method === "POST" && /^\/api\/bots\/[\w-]+\/(messages|respond|interrupt)$/.test(path))
        return true;
    return false;
}
function publicRemoteError(status, message) {
    if (/provider|adapter|instance/i.test(message))
        return "provider unavailable";
    if (status >= 500)
        return "request failed";
    return message.slice(0, 240);
}
function parseRoutineSchedule(value) {
    if (!value || typeof value !== "object") {
        throw Object.assign(new Error("schedule required"), { status: 400 });
    }
    const schedule = value;
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
async function handleRequest(req, res, surface) {
    let url;
    try {
        url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    }
    catch {
        return json(res, 400, { error: "invalid request URL" });
    }
    const path = url.pathname;
    const method = req.method ?? "GET";
    try {
        const pairingClaim = method === "POST" && path === "/api/pairing/claim";
        let authenticatedDeviceId;
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
        if (!requestOriginAllowed(req, method))
            return json(res, 403, { error: "origin not allowed" });
        // ── self-hosted mobile pairing ────────────────────────────────────
        // Pairing sessions and device revocation are deliberately local-only.
        if (method === "POST" && path === "/api/pairing/sessions") {
            if (surface !== "local")
                return json(res, 403, { error: "pairing sessions can only be created locally" });
            if (!REMOTE)
                return json(res, 409, { error: "remote access is disabled" });
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
            if (surface !== "remote")
                return json(res, 403, { error: "pairing claims must use the remote listener" });
            if (!REMOTE)
                return json(res, 409, { error: "remote access is disabled" });
            const body = await readBody(req);
            const claimed = pairing.claim(String(body.sessionId ?? ""), String(body.secret ?? ""), body.deviceName);
            res.setHeader("cache-control", "no-store");
            return json(res, 201, { ...claimed, hostUrl: REMOTE.publicUrl });
        }
        if (method === "GET" && path === "/api/devices") {
            if (surface !== "local")
                return json(res, 403, { error: "device management is local-only" });
            return json(res, 200, { devices: pairing.list() });
        }
        let deviceMatch = path.match(/^\/api\/devices\/([\w-]+)$/);
        if (method === "DELETE" && deviceMatch) {
            if (surface !== "local")
                return json(res, 403, { error: "device management is local-only" });
            const device = pairing.revoke(deviceMatch[1]);
            if (!device)
                return json(res, 404, { error: "no such device" });
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
                if (!toBotId || !message)
                    return json(res, 400, { error: "toBotId and message required" });
                if (toBotId === fromBotId)
                    return json(res, 400, { error: "a bot cannot message itself" });
                if (depth >= MAX_COMMS_DEPTH)
                    return json(res, 200, { error: "message chains are limited to one hop" });
                const target = store.bot(toBotId);
                if (!target)
                    return json(res, 404, { error: "no such bot" });
                if (target.busy)
                    return json(res, 200, { busy: true });
                // visibility: surface the cross-talk on the caller's own thread so
                // bot-to-bot turns are never invisible (they cost the user tokens)
                const from = store.bot(fromBotId);
                const fromName = from?.name ?? "another bot";
                let handoffMessageId;
                let handoffStepId;
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
                        if (patched)
                            broadcast({ kind: "message.patch", threadId: from.threadId, message: patched });
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
            res.write(`data: ${JSON.stringify({ kind: "hello" })}\n\n`);
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
                }
                catch { }
            }, 25_000);
            req.on("close", () => {
                clearInterval(keepalive);
                sseClients.delete(res);
            });
            return;
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
            if (!section)
                return json(res, 404, { error: "no such section" });
            broadcastWorkspace();
            return json(res, 200, { section });
        }
        m = path.match(/^\/api\/sections\/([\w-]+)$/);
        if (m && method === "DELETE") {
            if (!workspace.deleteSection(m[1]))
                return json(res, 404, { error: "no such section" });
            for (const bot of store.bots) {
                if (bot.sectionId !== m[1])
                    continue;
                const patched = store.patchBot(bot.id, { sectionId: null });
                if (patched)
                    broadcast({ kind: "bot", bot: patched });
            }
            broadcastWorkspace();
            return json(res, 200, { ok: true });
        }
        if (method === "POST" && path === "/api/routines") {
            const body = await readBody(req);
            const botId = String(body.botId ?? "");
            return await botResourceGate.run(botId, async () => {
                const bot = store.bot(botId);
                if (!bot || (surface === "remote" && bot.hidden))
                    return json(res, 404, { error: "no such bot" });
                // Body parsing happened before admission because the owner id lives in
                // the payload. Re-resolve both canonical identities immediately before
                // the durable write; DELETE cannot start while this lease is held.
                if (store.bot(botId) !== bot || !isCanonicalBotOperation(bot)) {
                    return json(res, 409, { error: "the bot is being deleted" });
                }
                const routine = workspace.createRoutine({
                    botId,
                    name: String(body.name ?? ""),
                    prompt: String(body.prompt ?? ""),
                    schedule: parseRoutineSchedule(body.schedule),
                    enabled: body.enabled === undefined ? true : Boolean(body.enabled),
                });
                broadcastWorkspace();
                return json(res, 201, { routine });
            });
        }
        m = path.match(/^\/api\/routines\/([\w-]+)$/);
        if (m && method === "PATCH") {
            const routineId = m[1];
            const owner = workspace.snapshot().routines.find((candidate) => candidate.id === routineId);
            if (!owner)
                return json(res, 404, { error: "no such routine" });
            return await botResourceGate.run(owner.botId, async () => {
                const bot = store.bot(owner.botId);
                const current = workspace.snapshot().routines.find((candidate) => candidate.id === routineId);
                if (!bot || !current || current !== owner || current.botId !== owner.botId) {
                    return json(res, 404, { error: "no such routine" });
                }
                if (surface === "remote" && bot.hidden)
                    return json(res, 404, { error: "no such routine" });
                const body = await readBody(req);
                if (store.bot(bot.id) !== bot ||
                    workspace.snapshot().routines.find((candidate) => candidate.id === routineId) !== owner ||
                    !isCanonicalBotOperation(bot)) {
                    return json(res, 409, { error: "the bot is being deleted" });
                }
                const routine = workspace.patchRoutine(routineId, {
                    ...(body.name !== undefined ? { name: String(body.name) } : {}),
                    ...(body.prompt !== undefined ? { prompt: String(body.prompt) } : {}),
                    ...(body.schedule !== undefined ? { schedule: parseRoutineSchedule(body.schedule) } : {}),
                    ...(body.enabled !== undefined ? { enabled: Boolean(body.enabled) } : {}),
                });
                if (!routine)
                    return json(res, 404, { error: "no such routine" });
                broadcastWorkspace();
                return json(res, 200, { routine });
            });
        }
        m = path.match(/^\/api\/routines\/([\w-]+)$/);
        if (m && method === "DELETE") {
            const routineId = m[1];
            const owner = workspace.snapshot().routines.find((candidate) => candidate.id === routineId);
            if (!owner)
                return json(res, 404, { error: "no such routine" });
            return await botResourceGate.run(owner.botId, async () => {
                const bot = store.bot(owner.botId);
                const current = workspace.snapshot().routines.find((candidate) => candidate.id === routineId);
                if (!bot || !current || current !== owner || current.botId !== owner.botId) {
                    return json(res, 404, { error: "no such routine" });
                }
                if (surface === "remote" && bot.hidden)
                    return json(res, 404, { error: "no such routine" });
                if (!isCanonicalBotOperation(bot))
                    return json(res, 409, { error: "the bot is being deleted" });
                if (!workspace.deleteRoutine(routineId))
                    return json(res, 404, { error: "no such routine" });
                broadcastWorkspace();
                return json(res, 200, { ok: true });
            });
        }
        m = path.match(/^\/api\/routines\/([\w-]+)\/run$/);
        if (m && method === "POST") {
            await runRoutine(m[1], true);
            return json(res, 202, { ok: true });
        }
        m = path.match(/^\/api\/tasks\/([\w-]+)\/teach$/);
        if (m && method === "POST") {
            const taskId = m[1];
            const task = workspace.task(taskId);
            if (!task)
                return json(res, 404, { error: "no such task" });
            return await botResourceGate.run(task.botId, async () => {
                const bot = store.bot(task.botId);
                const current = workspace.task(taskId);
                if (!bot || !current || current !== task || current.botId !== task.botId) {
                    return json(res, 404, { error: "no such task" });
                }
                if (surface === "remote" && bot.hidden)
                    return json(res, 404, { error: "no such task" });
                const body = await readBody(req);
                if (store.bot(bot.id) !== bot || workspace.task(taskId) !== task || !isCanonicalBotOperation(bot)) {
                    return json(res, 409, { error: "the bot is being deleted" });
                }
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
            });
        }
        m = path.match(/^\/api\/tasks\/([\w-]+)\/retry$/);
        if (m && method === "POST") {
            const task = workspace.task(m[1]);
            if (!task)
                return json(res, 404, { error: "no such task" });
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
            if (!attachment)
                return json(res, 404, { error: "no such attachment" });
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
            }
            catch {
                return json(res, 410, { error: "attachment file is missing" });
            }
        }
        if (m && method === "DELETE") {
            const attachment = workspace.attachment(m[1]);
            if (!attachment)
                return json(res, 404, { error: "no such attachment" });
            if (surface === "remote" && attachment && store.bot(attachment.botId)?.hidden) {
                return json(res, 404, { error: "no such attachment" });
            }
            return await botResourceGate.run(attachment.botId, async () => {
                const bot = store.bot(attachment.botId);
                const current = workspace.attachment(attachment.id);
                if (!bot || !current || current !== attachment || current.botId !== attachment.botId) {
                    return json(res, 404, { error: "no such attachment" });
                }
                if (!isCanonicalBotOperation(bot))
                    return json(res, 409, { error: "the bot is being deleted" });
                if (!workspace.deleteAttachment(attachment.id))
                    return json(res, 404, { error: "no such attachment" });
                broadcastWorkspace();
                return json(res, 200, { ok: true });
            });
        }
        // ── bounded, opaque file capabilities (desktop/web host only) ──
        m = path.match(/^\/api\/bots\/([\w-]+)\/files\/resolve$/);
        if (m && method === "POST") {
            if (surface !== "local")
                return json(res, 403, { error: "file previews are local-only" });
            return await botResourceGate.run(m[1], async () => {
                const bot = store.bot(m[1]);
                if (!bot)
                    return json(res, 404, { error: "no such bot" });
                const body = await readBody(req);
                const requested = body.path;
                const file = typeof requested === "string" && requested.trim().startsWith("/workspace/")
                    ? await box.readWorkspaceFile(cfg, bot.id, requested)
                    : readLocalBotFile(bot.id, requested);
                const capability = fileCapabilities.issue(bot.id, file);
                res.setHeader("cache-control", "no-store");
                return json(res, 201, { file: publicFileCapability(capability, file.source) });
            });
        }
        m = path.match(/^\/api\/attachments\/([\w-]+)\/files\/resolve$/);
        if (m && method === "POST") {
            if (surface !== "local")
                return json(res, 403, { error: "file previews are local-only" });
            const attachment = workspace.attachment(m[1]);
            if (!attachment)
                return json(res, 404, { error: "no such attachment" });
            return await botResourceGate.run(attachment.botId, async () => {
                const current = workspace.attachment(m[1]);
                if (!current || current.botId !== attachment.botId || !store.bot(current.botId)) {
                    return json(res, 404, { error: "no such attachment" });
                }
                const file = readStoredAttachmentFile(current.storedPath, current.name);
                const capability = fileCapabilities.issue(current.botId, file);
                res.setHeader("cache-control", "no-store");
                return json(res, 201, { file: publicFileCapability(capability, file.source) });
            });
        }
        m = path.match(/^\/api\/files\/([A-Za-z0-9_-]{43})\/(preview|download)$/);
        if (m && method === "GET") {
            if (surface !== "local")
                return json(res, 403, { error: "file previews are local-only" });
            const capability = fileCapabilities.get(m[1]);
            if (!capability)
                return json(res, 404, { error: "file preview expired or does not exist" });
            const encodedName = encodeURIComponent(capability.name);
            if (m[2] === "download") {
                res.writeHead(200, {
                    ...SECURITY_HEADERS,
                    "cache-control": "no-store",
                    "content-type": capability.mime,
                    "content-length": String(capability.bytes.length),
                    "content-disposition": `attachment; filename*=UTF-8''${encodedName}`,
                });
                return res.end(capability.bytes);
            }
            if (capability.kind === "pdf") {
                res.writeHead(200, {
                    ...SECURITY_HEADERS,
                    "cache-control": "no-store",
                    "content-type": capability.mime,
                    "content-length": String(capability.bytes.length),
                    // The app fetches these bytes into the bundled PDF.js worker. Marking
                    // direct navigation as a download avoids entering a browser plugin.
                    "content-disposition": `attachment; filename*=UTF-8''${encodedName}`,
                });
                return res.end(capability.bytes);
            }
            res.setHeader("cache-control", "no-store");
            return json(res, 200, { preview: await buildStructuredPreview(capability.kind, capability.bytes) });
        }
        // ── bots ──
        if (method === "GET" && path === "/api/bots") {
            const visibleBotIds = visibleRemoteBotIds();
            return json(res, 200, {
                bots: surface === "remote"
                    ? store.bots
                        .filter((bot) => !bot.hidden)
                        .map((bot) => publicMobileBot(bot, store.messagesFor(bot.threadId), MOBILE_BOOTSTRAP_MESSAGE_LIMIT, visibleBotIds))
                    : store.bots.map((b) => ({ ...b, messages: store.messagesFor(b.threadId) })),
            });
        }
        if (method === "POST" && path === "/api/bots") {
            const body = await readBody(req);
            if (surface === "remote" && Object.keys(body).some((key) => !["name", "title", "temporary", "ttlMinutes"].includes(key))) {
                return json(res, 403, { error: "mobile bot creation only accepts name, title, and temporary lifetime" });
            }
            if (body.temporary !== undefined && typeof body.temporary !== "boolean") {
                return json(res, 400, { error: "temporary must be a boolean" });
            }
            if (body.ttlMinutes !== undefined && body.temporary !== true) {
                return json(res, 400, { error: "ttlMinutes requires temporary: true" });
            }
            const lifecycle = body.temporary === true ? temporaryBotLifecycle(body.ttlMinutes) : undefined;
            const requestedName = body.name === undefined
                ? undefined
                : String(body.name).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80);
            if (requestedName !== undefined && !requestedName)
                return json(res, 400, { error: "name cannot be empty" });
            const requestedTitle = body.title === undefined
                ? undefined
                : String(body.title).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 120);
            const bot = store.createBot({ lifecycle });
            const patch = { modelSelection: await defaultSelection() };
            if (requestedName !== undefined)
                patch.name = requestedName;
            if (requestedTitle !== undefined)
                patch.title = requestedTitle;
            store.patchBot(bot.id, patch);
            const created = store.bot(bot.id);
            broadcast({ kind: "bot", bot: created });
            return json(res, 201, {
                bot: surface === "remote"
                    ? publicMobileBot(created, store.messagesFor(created.threadId), MOBILE_BOOTSTRAP_MESSAGE_LIMIT, visibleRemoteBotIds())
                    : { ...created, messages: store.messagesFor(bot.threadId) },
            });
        }
        m = path.match(/^\/api\/bots\/([\w-]+)$/);
        if (m && method === "PATCH") {
            const botId = m[1];
            return await botResourceGate.run(botId, async () => {
                const owner = store.bot(botId);
                if (!owner)
                    return json(res, 404, { error: "no such bot" });
                const body = await readBody(req);
                // The active gate makes DELETE wait, but re-resolve canonical ownership
                // after body parsing before mutating the record or lifecycle.
                if (store.bot(botId) !== owner || !isCanonicalBotOperation(owner)) {
                    return json(res, 409, { error: "the bot is being deleted" });
                }
                if (surface === "remote") {
                    const keys = Object.keys(body);
                    const marksRead = keys.length === 1 && typeof body.unread === "boolean";
                    const makesPermanent = keys.length === 1 && body.temporary === false;
                    if (!marksRead && !makesPermanent) {
                        return json(res, 403, { error: "mobile bot updates only accept unread or conversion to permanent" });
                    }
                    if (owner.hidden)
                        return json(res, 404, { error: "no such bot" });
                    const bot = makesPermanent
                        ? store.setBotLifecycle(botId, null)
                        : store.patchBot(botId, { unread: body.unread });
                    if (!bot)
                        return json(res, 409, { error: "the bot is being deleted" });
                    broadcast({ kind: "bot", bot: makesPermanent ? { ...bot, lifecycle: null } : bot });
                    return json(res, 200, { bot: publicMobileBot(bot, undefined, MOBILE_BOOTSTRAP_MESSAGE_LIMIT, visibleRemoteBotIds()) });
                }
                const remoteWasVisible = !owner.hidden;
                const patch = {};
                if (body.temporary !== undefined && typeof body.temporary !== "boolean") {
                    return json(res, 400, { error: "temporary must be a boolean" });
                }
                if (body.ttlMinutes !== undefined && body.temporary !== true) {
                    return json(res, 400, { error: "ttlMinutes requires temporary: true" });
                }
                if (body.modelSelection !== undefined && owner.busy) {
                    return json(res, 409, { error: "interrupt the active turn before changing its provider" });
                }
                const lifecycleMutation = body.temporary !== undefined;
                if (body.temporary === true)
                    patch.lifecycle = temporaryBotLifecycle(body.ttlMinutes);
                for (const key of [
                    "name", "title", "description", "notifications", "modelSelection", "unread", "computer", "color",
                    "mascotExpression", "pinned", "hidden", "appsEnabled", "collaborationEnabled",
                ]) {
                    if (body[key] !== undefined)
                        patch[key] = body[key];
                }
                if (body.avatar !== undefined) {
                    const avatar = parseBotAvatar(body.avatar);
                    if (!avatar)
                        return json(res, 400, { error: "invalid avatar" });
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
                const bot = store.patchBot(botId, patch, { clearLifecycle: lifecycleMutation && body.temporary === false });
                if (!bot)
                    return json(res, 409, { error: "the bot is being deleted" });
                const botEvent = lifecycleMutation && body.temporary === false ? { ...bot, lifecycle: null } : bot;
                if (remoteWasVisible && bot.hidden) {
                    broadcast({ kind: "bot", bot: botEvent }, { remoteOverride: { kind: "bot.deleted", botId: bot.id }, remoteDeletedBotWasVisible: true });
                }
                else
                    broadcast({ kind: "bot", bot: botEvent });
                return json(res, 200, { bot });
            });
        }
        m = path.match(/^\/api\/bots\/([\w-]+)$/);
        if (m && method === "DELETE") {
            const bot = store.bot(m[1]);
            if (!bot)
                return json(res, 404, { error: "no such bot" });
            const rawOperationId = String(req.headers["x-cumea-operation-id"] ?? "");
            const operationId = /^[\w-]{1,100}$/.test(rawOperationId) ? rawOperationId : undefined;
            const result = await deleteBotTransactionally(bot.id, { operationId });
            return json(res, 200, { ok: true, removed: result.removed, computerCleanup: result.computerCleanup });
        }
        m = path.match(/^\/api\/bots\/([\w-]+)\/attachments$/);
        if (m && method === "POST") {
            if (surface === "remote" && store.bot(m[1])?.hidden)
                return json(res, 404, { error: "no such bot" });
            // Await so quota/body/filesystem rejections are handled by this
            // request's bounded error response instead of becoming unhandled.
            return await uploadAttachment(req, res, m[1]);
        }
        // onboarding/ask cards persist their answered/dismissed state
        m = path.match(/^\/api\/bots\/([\w-]+)\/cards\/([\w-]+)$/);
        if (m && method === "PATCH") {
            const botId = m[1];
            const messageId = m[2];
            return await botResourceGate.run(botId, async () => {
                const bot = store.bot(botId);
                if (!bot)
                    return json(res, 404, { error: "no such bot" });
                const existing = store.messagesFor(bot.threadId).find((msg) => msg.id === messageId);
                if (!existing?.card)
                    return json(res, 404, { error: "no such card" });
                const body = await readBody(req);
                if (store.bot(bot.id) !== bot || !isCanonicalBotOperation(bot)) {
                    return json(res, 409, { error: "the bot is being deleted" });
                }
                const patched = store.patchMessage(bot.threadId, messageId, {
                    card: {
                        ...existing.card,
                        ...(body.answered !== undefined ? { answered: body.answered } : {}),
                        ...(body.dismissed !== undefined ? { dismissed: body.dismissed } : {}),
                    },
                });
                broadcast({ kind: "message.patch", threadId: bot.threadId, message: patched });
                return json(res, 200, { message: patched });
            });
        }
        m = path.match(/^\/api\/bots\/([\w-]+)\/messages$/);
        if (m) {
            const bot = store.bot(m[1]);
            if (!bot || (surface === "remote" && bot.hidden))
                return json(res, 404, { error: "no such bot" });
        }
        if (m && method === "GET") {
            const bot = store.bot(m[1]);
            const requestedLimit = url.searchParams.get("limit");
            const parsedLimit = requestedLimit === null ? MOBILE_MESSAGE_PAGE_LIMIT : Number(requestedLimit);
            if (!Number.isInteger(parsedLimit) || parsedLimit < 1)
                return json(res, 400, { error: "limit must be a positive integer" });
            const limit = Math.min(parsedLimit, MOBILE_MESSAGE_PAGE_LIMIT_MAX);
            const all = store.messagesFor(bot.threadId);
            const before = url.searchParams.get("before") ?? url.searchParams.get("cursor");
            const end = before ? all.findIndex((message) => message.id === before) : all.length;
            if (before && end < 0)
                return json(res, 400, { error: "unknown before message" });
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
            const body = await readBody(req);
            const text = String(body.text ?? "").trim();
            if (!text)
                return json(res, 400, { error: "text required" });
            const attachmentIds = Array.isArray(body.attachmentIds) ? body.attachmentIds.map(String).slice(0, 10) : [];
            const attachments = workspace.attachmentsFor(m[1], attachmentIds);
            await startTurn(m[1], text, { attachments, track: body.track !== false });
            return json(res, 202, { ok: true });
        }
        m = path.match(/^\/api\/bots\/([\w-]+)\/computer-preview$/);
        if (m && method === "GET") {
            if (surface !== "remote")
                return json(res, 404, { error: "no route" });
            res.setHeader("cache-control", "no-store");
            if (!REMOTE_SCREEN_PREVIEW)
                return json(res, 403, { error: "computer preview is disabled" });
            const bot = store.bot(m[1]);
            if (!bot || bot.hidden)
                return json(res, 404, { error: "no such bot" });
            const cached = screenPollers.get(bot.id)?.last;
            const transcript = [...store.messagesFor(bot.threadId)]
                .reverse()
                .find((message) => message.kind === "screen" && message.png);
            const source = cached ?? (transcript?.png ? { png: transcript.png, mime: transcript.mime ?? "image/png", capturedAt: transcript.at } : null);
            const preview = source ? decodeMobileComputerPreview(source.png, source.mime) : null;
            if (!preview)
                return json(res, 200, { available: false });
            return json(res, 200, {
                available: true,
                mime: preview.mime,
                png: preview.bytes.toString("base64"),
                capturedAt: source.capturedAt,
            });
        }
        m = path.match(/^\/api\/bots\/([\w-]+)\/respond$/);
        if (m && method === "POST") {
            const bot = store.bot(m[1]);
            if (!bot || (surface === "remote" && bot.hidden))
                return json(res, 404, { error: "no such bot" });
            const body = await readBody(req);
            if (!isCanonicalBotOperation(bot))
                return json(res, 409, { error: "the bot is being deleted" });
            const requestId = typeof body.requestId === "string" ? body.requestId.trim() : "";
            if (!requestId)
                return json(res, 400, { error: "requestId required" });
            const requestKey = threadEventKey(bot.threadId, requestId);
            const requestMessageId = askMessageByRequest.get(requestKey);
            const requestMessage = requestMessageId
                ? store.messagesFor(bot.threadId).find((message) => message.id === requestMessageId)
                : undefined;
            if (!requestMessage?.card || requestMessage.card.answered) {
                return json(res, 409, { error: "no such pending request" });
            }
            if (!["allow", "deny", "answer"].includes(body.behavior)) {
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
            if (!instance)
                return json(res, 409, { error: "provider unavailable" });
            if (body.rememberPolicy !== undefined) {
                if (!["allow", "deny", "ask"].includes(body.rememberPolicy)) {
                    return json(res, 400, { error: "unknown approval policy" });
                }
                if (requestMessage.card.requestType !== "permission") {
                    return json(res, 400, { error: "approval policy applies only to permission requests" });
                }
            }
            const approvalOperation = botResourceGate.beginDetachedOperation(bot.id);
            try {
                if (!isCanonicalBotOperation(bot, approvalOperation)) {
                    return json(res, 409, { error: "the bot is being deleted" });
                }
                await instance.adapter.respondToRequest(bot.threadId, requestId, {
                    behavior: body.behavior,
                    message: body.message,
                });
                if (!isCanonicalBotOperation(bot, approvalOperation)) {
                    return json(res, 409, { error: "the bot was deleted while the response was pending" });
                }
                // Persist a remembered policy only after the owning provider accepted
                // this exact pending request. A stale or forged request must never be
                // able to mutate future approval behavior.
                if (body.rememberPolicy !== undefined) {
                    const patched = store.patchBot(bot.id, { approvalPolicy: body.rememberPolicy });
                    if (patched)
                        broadcast({ kind: "bot", bot: patched });
                }
                return json(res, 200, { ok: true });
            }
            finally {
                approvalOperation.release();
            }
        }
        m = path.match(/^\/api\/bots\/([\w-]+)\/interrupt$/);
        if (m && method === "POST") {
            const botId = m[1];
            return await botResourceGate.run(botId, async () => {
                const bot = store.bot(botId);
                if (!bot || (surface === "remote" && bot.hidden))
                    return json(res, 404, { error: "no such bot" });
                const instance = registry.get(bot.modelSelection.instanceId);
                await instance?.adapter.interruptTurn(bot.threadId);
                if (store.bot(bot.id) !== bot || !isCanonicalBotOperation(bot)) {
                    return json(res, 409, { error: "the bot is being deleted" });
                }
                return json(res, 200, { ok: true });
            });
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
            const patch = {};
            for (const key of ["xai", "composio", "box", "profile"]) {
                if (body[key] && typeof body[key] === "object")
                    patch[key] = body[key];
            }
            if (!Object.keys(patch).length)
                return json(res, 400, { error: "nothing to save" });
            saveConfig(patch);
            Object.assign(cfg, loadConfig());
            // provider keys change the fleet; a profile edit must not kill
            // in-flight turns with a pointless reload
            if (Object.keys(patch).some((k) => k !== "profile"))
                await reloadProviders();
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
            if (!cfg.composio?.key)
                return json(res, 200, { configured: false, services: {} });
            const status = await composio.connectionStatus(cfg, services.length ? services : composio.CURATED_SLUGS);
            return json(res, 200, { configured: true, services: status });
        }
        m = path.match(/^\/api\/connectors\/([\w-]+)\/authorize$/);
        if (m && method === "POST")
            return json(res, 200, await composio.authorizeService(cfg, m[1]));
        m = path.match(/^\/api\/connectors\/([\w-]+)$/);
        if (m && method === "DELETE")
            return json(res, 200, await composio.removeService(cfg, m[1]));
        // ── the bot's cloud computer (Box) ──
        m = path.match(/^\/api\/bots\/([\w-]+)\/computer$/);
        if (m && method === "GET") {
            const botId = m[1];
            return await botResourceGate.run(botId, async () => {
                const bot = store.bot(botId);
                if (!bot)
                    return json(res, 404, { error: "no such bot" });
                const status = await box.boxStatus(cfg, bot.id);
                if (store.bot(bot.id) !== bot || !isCanonicalBotOperation(bot)) {
                    return json(res, 409, { error: "the bot is being deleted" });
                }
                return json(res, 200, status);
            });
        }
        m = path.match(/^\/api\/bots\/([\w-]+)\/computer\/(provision|join|sleep|exec|screenshot)$/);
        if (m && method === "POST") {
            const botId = m[1];
            const bot = store.bot(botId);
            if (!bot)
                return json(res, 404, { error: "no such bot" });
            if (m[2] === "provision") {
                const operation = botResourceGate.beginDetachedOperation(bot.id);
                let provisionedBoxId;
                let cleanupAttempted = false;
                const cleanupStaleProvision = async () => {
                    if (cleanupAttempted || !shouldCleanupStaleProvision(store.bot(bot.id)))
                        return;
                    cleanupAttempted = true;
                    if (provisionedBoxId) {
                        const cleanup = await box.archiveBoxByIdForDeletion(cfg, provisionedBoxId);
                        if (cleanup.outcome === "warning") {
                            console.warn(`cloud computer cleanup warning during late provisioning for bot ${bot.id}: ${cleanup.warning}`);
                        }
                    }
                    else
                        await archiveBotComputerForDeletion(bot.id, "late provisioning");
                };
                try {
                    if (!isCanonicalBotOperation(bot, operation))
                        throw Object.assign(new Error("the bot is being deleted"), { status: 409 });
                    const result = await box.provisionBox(cfg, bot.id, bot.name);
                    provisionedBoxId = result.boxId;
                    if (!isCanonicalBotOperation(bot, operation)) {
                        await cleanupStaleProvision();
                        throw Object.assign(new Error("the bot was deleted while its computer was provisioning"), { status: 409 });
                    }
                    return json(res, 200, result);
                }
                catch (error) {
                    if (!isCanonicalBotOperation(bot, operation)) {
                        await cleanupStaleProvision();
                        throw Object.assign(new Error("the bot was deleted while its computer was provisioning"), { status: 409 });
                    }
                    throw error;
                }
                finally {
                    operation.release();
                }
            }
            return await botResourceGate.run(bot.id, async () => {
                if (store.bot(bot.id) !== bot || !isCanonicalBotOperation(bot)) {
                    return json(res, 409, { error: "the bot is being deleted" });
                }
                const body = m[2] === "exec" ? await readBody(req) : null;
                if (store.bot(bot.id) !== bot || !isCanonicalBotOperation(bot)) {
                    return json(res, 409, { error: "the bot is being deleted" });
                }
                const result = m[2] === "join"
                    ? await box.joinBox(cfg, bot.id)
                    : m[2] === "sleep"
                        ? await box.sleepBox(cfg, bot.id)
                        : m[2] === "exec"
                            ? await box.execOnBox(cfg, bot.id, String(body?.command ?? ""))
                            : await box.screenshotBox(cfg, bot.id);
                // DELETE cannot enter while this active lease is held. Still resolve
                // ownership after the provider await before returning URLs/output/png.
                if (store.bot(bot.id) !== bot || !isCanonicalBotOperation(bot)) {
                    return json(res, 409, { error: "the bot is being deleted" });
                }
                return json(res, 200, result);
            });
        }
        // packaged app: the server serves the built UI too (window → :8799 for
        // everything, no dev proxy to die). CUMEA_STATIC_DIR is set by Electron.
        if (method === "GET" && !path.startsWith("/api/") && STATIC_DIR) {
            const root = resolve(STATIC_DIR);
            const candidate = path === "/" ? "/index.html" : path;
            const file = resolve(root, `.${candidate}`);
            if (file !== root && !file.startsWith(`${root}${sep}`))
                return json(res, 404, { error: "not found" });
            try {
                const data = readFileSync(file);
                const headers = {
                    ...SECURITY_HEADERS,
                    "content-type": MIME[extname(file)] ?? "application/octet-stream",
                };
                if (extname(file) === ".html")
                    headers["content-security-policy"] = DOCUMENT_CSP;
                res.writeHead(200, headers);
                return res.end(data);
            }
            catch {
                // SPA fallback
                try {
                    const data = readFileSync(join(STATIC_DIR, "index.html"));
                    res.writeHead(200, { ...SECURITY_HEADERS, "content-type": "text/html", "content-security-policy": DOCUMENT_CSP });
                    return res.end(data);
                }
                catch {
                    /* fall through to 404 */
                }
            }
        }
        return json(res, 404, { error: `no route: ${method} ${path}` });
    }
    catch (e) {
        const status = e?.status ?? 500;
        const message = e instanceof Error ? e.message : String(e);
        return json(res, status, { error: surface === "remote" ? publicRemoteError(status, message) : message });
    }
}
const server = createServer((req, res) => void handleRequest(req, res, "local"));
server.listen(PORT, "127.0.0.1", () => {
    console.log(`cumea server on http://127.0.0.1:${PORT}`);
});
const remoteServer = REMOTE ? createServer((req, res) => void handleRequest(req, res, "remote")) : null;
remoteServer?.listen(REMOTE.port, REMOTE.bind, () => {
    console.log(`cumea authenticated mobile listener on http://${REMOTE.bind}:${REMOTE.port}`);
});
for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
        clearInterval(routineTimer);
        clearTimeout(initialRoutineTimer);
        clearInterval(temporaryBotTimer);
        clearTimeout(initialTemporaryBotTimer);
        try {
            bus.flushLog();
        }
        catch (error) {
            console.error("event log shutdown flush failed", error);
        }
        finally {
            remoteServer?.close();
            server.close();
            void registry.disposeAll().finally(() => process.exit(0));
        }
    });
}
