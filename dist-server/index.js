// Cumea server — the harness host. Clients hold no transports
// (upstream rule): the React app dispatches typed commands over HTTP and
// folds one SSE event stream; every provider process runs here.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, hostname } from "node:os";
import { basename, dirname, extname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileAtomic } from "./atomic.js";
import { ApprovalRuleStore, applySavedRuleDecision, approvalBoundary, deriveApprovalScope, rememberApprovalAfterSettlement } from "./approval-rules.js";
import { BACKUP_MAX_ARCHIVE_BYTES, BackupService } from "./backup.js";
import * as box from "./box.js";
import { BoxIdleSleepManager } from "./box-idle-sleep.js";
import { BotResourceGate, TurnEventFence, shouldCleanupStaleProvision, } from "./bot-resource-gate.js";
import * as composio from "./composio.js";
import { ComputerProviderLeases, computerProviderSupported } from "./computer-provider.js";
import { coordinatorSystemPrompt } from "./coordinator.js";
import { ATTACHMENTS_DIR, DATA_DIR, ensureDirs, instanceConfigs, loadConfig, persistedInstanceConfigs, saveConfig, EVENTS_DIR, NATIVE_DIR, } from "./config.js";
import { newId } from "./contracts.js";
import { purgeCommittedFileDeletions, stageFilesForDeletion } from "./delete-files.js";
import { FileCapabilityStore, botWorkspaceDirectory, publicFileCapability, readLocalBotFile, readStoredAttachmentFile, stageBotWorkspaceForDeletion, } from "./file-capabilities.js";
import { buildStructuredPreview } from "./document-preview.js";
import { HTML_ARTIFACT_CSP, HTML_ARTIFACT_PERMISSIONS_POLICY } from "./html-artifact-policy.js";
import { BUILT_IN_DRIVERS } from "./drivers/builtIn.js";
import { resetPathCache } from "./env-path.js";
import { CUSTOM_ACP_DRIVER_KIND, customAcpInstance, decodeCustomAcpProfileInput, publicCustomAcpProfile, } from "./drivers/acp/custom.js";
import { threadEventKey, threadEventPrefix } from "./event-key.js";
import { classifyOpaquePotentialEffect } from "./effect-ledger.js";
import { compactReplayContext, renderReplayMetadata, shouldCompactContext } from "./context-compaction.js";
import { EventBus } from "./harness/bus.js";
import { EventLogWriter } from "./harness/event-log.js";
import { ProviderRegistry } from "./harness/registry.js";
import { MOBILE_BOOTSTRAP_MESSAGE_LIMIT, MOBILE_MESSAGE_PAGE_LIMIT, MOBILE_MESSAGE_PAGE_LIMIT_MAX, decodeMobileComputerPreview, publicMobileBot, publicMobileMessage, publicMobileWorkspace, sanitizeRemoteSsePayload, } from "./mobile.js";
import { PairingStore } from "./pairing.js";
import { publicPersistenceIssues, resetPersistenceIssue } from "./persistence-health.js";
import { buildPrivacyInventory } from "./privacy-data-flow.js";
import { McpRegistry } from "./mcp-registry.js";
import { compareSkillVersions, SkillRegistry, SKILL_MAX_ASSIGNMENTS, validateSkillAssignment } from "./skill-registry.js";
import { AgentMemoryStore } from "./memory.js";
import { localVmAction, localVmMcp, localVmScreenshot, localVmSetupCommands, localVmStatus, } from "./local-vm.js";
import { ProviderFleetGate } from "./provider-fleet-gate.js";
import { scheduleExpoPushReceiptCheck, sendExpoPush } from "./push.js";
import { commitCaptureIfCurrent } from "./screen-capture.js";
import { mentionedBots, parseBotAvatar, Store } from "./store.js";
import { isTemporaryBotCleanupEligible, sweepTemporaryBots, temporaryBotLifecycle } from "./temporary-bots.js";
import { isComputerAction, isDelegation, parseTaskBudget } from "./task-budget.js";
import { decodeStaticRequestPath, readStaticFile } from "./static-files.js";
import { checkpointContinuationInput, planCheckpointResume } from "./run-checkpoint.js";
import { configSecretValues, SecretCatalog, sensitiveEnvironmentValues } from "./secret-egress.js";
import { ROUTINE_NAME_MAX_LENGTH, ROUTINE_PROMPT_MAX_LENGTH, WorkspaceStore, } from "./workspace.js";
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
const mcpRegistry = new McpRegistry();
const skillRegistry = new SkillRegistry();
const memory = new AgentMemoryStore();
const computerLeases = new ComputerProviderLeases();
let localVmLifecycleBusy = false;
const backupService = new BackupService({ dataDir: DATA_DIR });
let maintenanceMode = false;
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
const memoryProxyPath = (() => {
    const ts = join(dirname(fileURLToPath(import.meta.url)), "drivers", "memory-proxy.ts");
    return existsSync(ts) ? ts : ts.replace(/\.ts$/, ".js");
})();
const memoryCapabilities = new Map();
const memoryTokenByTurn = new Map();
function issueMemoryIntegration(bot, turnId, runId) {
    const token = randomBytes(32).toString("base64url");
    const turnKey = threadEventKey(bot.threadId, turnId);
    memoryCapabilities.set(token, { botId: bot.id, threadId: bot.threadId, runId, expiresAt: Date.now() + 4 * 60 * 60_000 });
    memoryTokenByTurn.set(turnKey, token);
    refreshSecretCatalog();
    return {
        token,
        descriptor: {
            command: process.execPath,
            args: [memoryProxyPath],
            env: {
                ...AGENTS_NODE_FLAG,
                CUMEA_HARNESS_URL: `http://127.0.0.1:${PORT}`,
                CUMEA_MEMORY_CAPABILITY: token,
            },
        },
    };
}
function revokeMemoryTurn(turnKey) {
    const token = memoryTokenByTurn.get(turnKey);
    if (token)
        memoryCapabilities.delete(token);
    memoryTokenByTurn.delete(turnKey);
    refreshSecretCatalog();
}
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
        }).catch((err) => finish(`(couldn't start that bot: ${secretCatalog.safeError(err)})`));
    });
}
// default selection for new bots: first available instance, claude preferred
async function defaultSelection() {
    const described = await registry.describe();
    const available = described.filter((d) => d.snapshot.state === "available" && d.snapshot.authenticated !== false);
    const pick = available.find((d) => d.driverKind === "claudeAgent") ?? available[0];
    return { instanceId: pick?.instanceId ?? "", model: pick?.models.default ?? "" };
}
let bootSelection = { instanceId: "", model: "" };
const secretCatalog = new SecretCatalog();
secretCatalog.replace([...configSecretValues(cfg), COMMS_TOKEN, process.env.EXPO_ACCESS_TOKEN]);
const store = new Store(() => bootSelection, (message) => secretCatalog.redactValue(message));
function assertBotSkillAssignments() {
    for (const bot of store.bots) {
        for (const assignment of bot.skillAssignments ?? []) {
            if (!skillRegistry.has(assignment.id, assignment.version, true))
                throw new Error(`Agent ${bot.id} references an unavailable or disabled local skill version`);
        }
    }
}
assertBotSkillAssignments();
const approvalRules = new ApprovalRuleStore(DATA_DIR);
const workspace = new WorkspaceStore();
const pairing = new PairingStore();
const fileCapabilities = new FileCapabilityStore(Date.now, refreshSecretCatalog);
let computerSecretValues = [];
function refreshSecretCatalog() {
    secretCatalog.replace([
        ...configSecretValues(cfg),
        ...mcpRegistry.secretValues(),
        ...pairing.secretValues(),
        ...fileCapabilities.secretValues(),
        ...memoryCapabilities.keys(),
        ...computerSecretValues,
        COMMS_TOKEN,
        process.env.EXPO_ACCESS_TOKEN,
    ]);
}
refreshSecretCatalog();
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
}), (event) => turnEventFence.accepts(event.threadId, event.type, event.turnId), (event) => secretCatalog.redactValue(event));
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
        case "thread": {
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
        const frame = `data: ${JSON.stringify(secretCatalog.redactValue(outgoing))}\n\n`;
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
    const result = {
        sections: snapshot.sections,
        attachments: snapshot.attachments.map(publicAttachment),
        tasks: snapshot.tasks.map((task) => ({
            ...task,
            verificationStatus: workspace.verificationStatus(task.id),
        })),
        runs: snapshot.runs,
        routines: snapshot.routines,
    };
    return secretCatalog.redactValue(result);
}
function publicRemoteWorkspace() {
    return publicMobileWorkspace(publicWorkspace(), visibleRemoteBotIds());
}
function publicRemoteRoutine(routineId) {
    const routines = publicRemoteWorkspace().routines;
    if (!Array.isArray(routines))
        return null;
    return routines.find((value) => {
        if (!value || typeof value !== "object")
            return false;
        return value.id === routineId;
    }) ?? null;
}
function broadcastWorkspace() {
    broadcast({ kind: "workspace", workspace: publicWorkspace() });
}
// ── server-side event folding (upstream's ingestion worker, miniature) ──
// The canonical stream is the source of truth; the persisted transcript
// and every client view are projections of it.
const toolMessageByItem = new Map(); // threadId + itemId -> messageId
const askMessageByRequest = new Map(); // threadId + requestId -> messageId
const memoryRevisionsByTurn = new Map();
const activeRunByThread = new Map();
const activeProviderTurnByThread = new Map();
const budgetDeadlineTimers = new Map();
const budgetStops = new Set();
/** Serializes manual and automatic deletion for the same bot. */
const deletingBotIds = new Set();
/** Threads whose current turn actually invoked a computer tool. */
const usedComputerByThread = new Set();
function clearBudgetTimer(runId) {
    if (!runId)
        return;
    const timer = budgetDeadlineTimers.get(runId);
    if (timer)
        clearTimeout(timer);
    budgetDeadlineTimers.delete(runId);
}
function exhaustRunBudget(bot, runId, reason) {
    if (budgetStops.has(runId) || activeRunByThread.get(bot.threadId) !== runId || !isCanonicalBotOperation(bot))
        return;
    if (!workspace.markBudgetExhausted(runId, reason))
        return;
    budgetStops.add(runId);
    clearBudgetTimer(runId);
    const providerTurn = activeProviderTurnByThread.get(bot.threadId);
    activeRunByThread.delete(bot.threadId);
    activeProviderTurnByThread.delete(bot.threadId);
    turnEventFence.invalidate(bot.threadId);
    stopScreenPoller(bot.id);
    computerLeases.release("vm", bot.threadId);
    clearThreadEventState(bot.threadId);
    store.patchBot(bot.id, { busy: false, unread: true });
    broadcastWorkspace();
    broadcast({ kind: "bot", bot: store.bot(bot.id) });
    const instanceId = providerTurn?.instanceId ?? bot.modelSelection.instanceId;
    void registry.get(instanceId)?.adapter.interruptTurn(bot.threadId, providerTurn?.turnId)
        .catch(() => { })
        .finally(() => {
        budgetStops.delete(runId);
        scheduleNextQueuedTurn(bot.id);
    });
}
function armBudgetDeadline(bot, runId) {
    const task = workspace.task(workspace.run(runId)?.taskId ?? "");
    const usage = workspace.run(runId)?.budgetUsage;
    const duration = task?.budget?.durationMs;
    if (!duration || !usage)
        return;
    const activeElapsed = usage.activeSince === undefined ? 0 : Math.max(0, Date.now() - usage.activeSince);
    const remaining = duration - (task?.budgetDurationUsedMs ?? 0) - activeElapsed;
    if (remaining <= 0)
        return exhaustRunBudget(bot, runId, "durationMs");
    const timer = setTimeout(() => exhaustRunBudget(bot, runId, "durationMs"), remaining);
    timer.unref?.();
    budgetDeadlineTimers.set(runId, timer);
}
function notifyPairedDevices(bot, kind, ok = true) {
    if (!bot.notifications || bot.hidden)
        return;
    const foregroundDevices = new Set([...sseClients.values()].flatMap((client) => client.surface === "remote" && client.deviceId ? [client.deviceId] : []));
    const targets = pairing.pushTargets()
        .filter((target) => !foregroundDevices.has(target.deviceId))
        .map((target) => ({ deviceId: target.deviceId, token: target.token }));
    if (!targets.length)
        return;
    const accessToken = process.env.EXPO_ACCESS_TOKEN;
    void sendExpoPush(targets, {
        title: bot.name,
        body: kind === "needs_attention"
            ? "Needs your attention"
            : ok ? "Finished working" : "Run finished with an error",
        data: { kind, botId: bot.id },
    }, { accessToken })
        .then(({ staleTokens, receipts }) => {
        staleTokens.forEach((token) => pairing.clearPushToken(token));
        if (staleTokens.length)
            refreshSecretCatalog();
        scheduleExpoPushReceiptCheck(receipts, (token) => {
            pairing.clearPushToken(token);
            refreshSecretCatalog();
        }, { accessToken });
    })
        .catch(() => {
        // Push is best-effort and must never affect the canonical task state.
        // Do not log capability-bearing device tokens or response bodies.
        console.warn("mobile push delivery failed");
    });
}
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
    for (const key of memoryRevisionsByTurn.keys())
        if (key.startsWith(prefix))
            memoryRevisionsByTurn.delete(key);
    for (const key of memoryTokenByTurn.keys())
        if (key.startsWith(prefix))
            revokeMemoryTurn(key);
    usedComputerByThread.delete(threadId);
}
bus.subscribe((event) => {
    const bot = store.botByThread(event.threadId);
    if (!bot ||
        !isCanonicalBotOperation(bot) ||
        !turnEventFence.accepts(event.threadId, event.type, event.turnId))
        return;
    if (bot.computer === "cloud")
        boxIdleSleep.touch(bot.id);
    // Provider callbacks may outlive an interrupted/deleted session. Resolve
    // canonical ownership before exposing diagnostics to any local SSE client.
    broadcast({ kind: "runtime", event });
    const pushMessage = (m) => {
        const message = store.appendMessage(event.threadId, m);
        broadcast({ kind: "message", threadId: event.threadId, message });
        return message;
    };
    const checkpointAt = (phase) => {
        const runId = activeRunByThread.get(event.threadId);
        const run = runId ? workspace.run(runId) : null;
        const checkpoint = run?.checkpoint;
        const activeLeafId = store.activeLeaf(event.threadId);
        if (!runId || !checkpoint || !activeLeafId)
            return;
        workspace.updateCheckpoint(runId, {
            phase,
            activeLeafId,
            instanceId: checkpoint.provider.instanceId,
            model: checkpoint.provider.model,
            cursor: bot.resumeCursors[checkpoint.provider.instanceId],
        });
    };
    try {
        switch (event.type) {
            case "session.started":
                if (event.sessionId && event.providerInstanceId) {
                    store.setResumeCursor(bot.id, event.providerInstanceId, event.sessionId);
                }
                checkpointAt("session");
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
                        checkpointAt("tool");
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
                        const step = workspace.addStep(runId, { kind: "tool", title: event.title ?? "Tool", itemId: event.itemId });
                        const title = event.title ?? "Tool";
                        const exhaustedReasons = [
                            workspace.chargeBudget(runId, "toolCalls"),
                            isComputerAction(title) ? workspace.chargeBudget(runId, "computerActions") : null,
                            isDelegation(title) ? workspace.chargeBudget(runId, "delegations") : null,
                        ];
                        const exhausted = exhaustedReasons.find((reason) => reason !== null) ?? null;
                        const descriptor = classifyOpaquePotentialEffect(event.title);
                        if (descriptor) {
                            try {
                                workspace.observeOpaqueExternalEffect(runId, {
                                    descriptor,
                                    itemId: event.itemId,
                                    stepId: step?.id,
                                });
                            }
                            catch {
                                // The provider already crossed this opaque boundary. Failure to
                                // persist its observation must not manufacture a retry signal.
                                console.warn("could not persist opaque external-effect observation");
                            }
                        }
                        checkpointAt("tool");
                        broadcastWorkspace();
                        if (exhausted)
                            exhaustRunBudget(bot, runId, exhausted);
                    }
                }
                break;
            case "thread.token-usage.updated": {
                const runId = activeRunByThread.get(event.threadId);
                const run = runId ? workspace.run(runId) : null;
                if (runId && run && (!event.turnId || !run.turnId || event.turnId === run.turnId)) {
                    const exhausted = workspace.observeTokenUsage(runId, event.providerInstanceId, run.checkpoint?.provider.model, event.input, event.output);
                    broadcastWorkspace();
                    if (exhausted)
                        exhaustRunBudget(bot, runId, exhausted);
                }
                break;
            }
            case "request.opened": {
                const permission = event.requestType === "permission";
                const runId = activeRunByThread.get(event.threadId);
                const scope = permission ? deriveApprovalScope(event.tool, event.summary) : null;
                const instance = registry.get(bot.modelSelection.instanceId);
                // Never write an audit row that claims the request was settled when the
                // owning provider cannot actually receive the decision.
                const automated = scope && instance ? approvalRules.decide(bot.id, scope) : null;
                if (permission && automated) {
                    const behavior = automated.behavior;
                    const boundary = approvalBoundary(automated.scope);
                    const applying = pushMessage({
                        role: "bot",
                        kind: "options",
                        card: {
                            title: behavior === "allow" ? "Applying saved allow rule" : "Applying saved deny rule",
                            subtitle: `Scoped to ${boundary}`,
                            options: [],
                            requestId: event.requestId,
                            requestType: event.requestType,
                            tool: event.tool,
                            dismissed: true,
                        },
                    });
                    checkpointAt("approval");
                    if (runId) {
                        workspace.addStep(runId, {
                            kind: "approval",
                            title: `Applying saved ${behavior} rule (${boundary})`,
                            itemId: event.requestId,
                            status: "running",
                        });
                        broadcastWorkspace();
                    }
                    const approvalOperation = botResourceGate.beginDetachedOperation(bot.id);
                    void applySavedRuleDecision(() => instance.adapter.respondToRequest(event.threadId, event.requestId ?? "", { behavior }), {
                        accepted: () => {
                            if (!isCanonicalBotOperation(bot, approvalOperation))
                                return;
                            try {
                                const current = store.messagesFor(event.threadId).find((message) => message.id === applying.id);
                                if (current?.card) {
                                    const patched = store.patchMessage(event.threadId, applying.id, {
                                        card: {
                                            ...current.card,
                                            title: behavior === "allow" ? "Allowed by saved rule" : "Denied by saved rule",
                                            answered: behavior,
                                            dismissed: true,
                                        },
                                    });
                                    if (patched)
                                        broadcast({ kind: "message.patch", threadId: event.threadId, message: patched });
                                }
                                if (runId) {
                                    workspace.completeStep(runId, event.requestId, behavior === "allow" ? "completed" : "denied");
                                    broadcastWorkspace();
                                }
                            }
                            catch {
                                // Provider settlement is authoritative even if the local audit
                                // cannot be updated. Never reopen and risk replaying it.
                            }
                        },
                        rejected: () => {
                            // A provider rejection can arrive after DELETE committed and the
                            // transcript was removed. Never let that callback recreate it.
                            if (!isCanonicalBotOperation(bot, approvalOperation))
                                return;
                            if (event.requestId)
                                askMessageByRequest.set(threadEventKey(event.threadId, event.requestId), applying.id);
                            try {
                                const current = store.messagesFor(event.threadId).find((message) => message.id === applying.id);
                                if (current?.card) {
                                    const patched = store.patchMessage(event.threadId, applying.id, {
                                        card: {
                                            ...current.card,
                                            title: "Approval needed",
                                            subtitle: event.summary,
                                            options: ["Always allow", "Allow once", "Never"],
                                            dismissed: false,
                                        },
                                    });
                                    if (patched)
                                        broadcast({ kind: "message.patch", threadId: event.threadId, message: patched });
                                }
                                if (runId) {
                                    workspace.completeStep(runId, event.requestId, "failed");
                                    workspace.pauseBudgetDuration(runId);
                                    clearBudgetTimer(runId);
                                    workspace.markNeedsAttention(runId, event.summary, event.requestId);
                                    broadcastWorkspace();
                                }
                                notifyPairedDevices(bot, "needs_attention");
                            }
                            catch {
                                // The request remains unsettled at the provider. Avoid any
                                // second automated response even if local persistence failed.
                            }
                        },
                    }).finally(approvalOperation.release);
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
                checkpointAt("approval");
                if (runId) {
                    workspace.pauseBudgetDuration(runId);
                    clearBudgetTimer(runId);
                }
                if (event.requestId)
                    askMessageByRequest.set(threadEventKey(event.threadId, event.requestId), message.id);
                if (runId) {
                    workspace.markNeedsAttention(runId, event.summary, event.requestId);
                    broadcastWorkspace();
                }
                notifyPairedDevices(bot, "needs_attention");
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
                    if (event.behavior !== "deny" && workspace.resumeBudgetDuration(runId))
                        armBudgetDeadline(bot, runId);
                    broadcastWorkspace();
                }
                break;
            }
            case "runtime.error": {
                checkpointAt("provider");
                pushMessage({ role: "bot", kind: "activity", tool: { name: `error: ${event.message.slice(0, 160)}`, ok: false } });
                const runId = activeRunByThread.get(event.threadId);
                if (runId) {
                    workspace.addStep(runId, { kind: "tool", title: event.message.slice(0, 160), status: "failed" });
                    broadcastWorkspace();
                }
                break;
            }
            case "turn.completed": {
                checkpointAt("provider");
                computerLeases.release("vm", event.threadId);
                const memoryKey = event.turnId ? threadEventKey(event.threadId, event.turnId) : null;
                const memoryUse = memoryKey ? memoryRevisionsByTurn.get(memoryKey) : null;
                if (memoryUse && event.ok) {
                    try {
                        memory.markUsedForAnswer(memoryUse.botId, memoryUse.revisionIds, event.turnId);
                    }
                    catch {
                        // Audit metadata is useful but must never prevent the canonical turn
                        // from settling. Content, paths and errors remain out of logs.
                        console.warn("could not update memory usage metadata");
                    }
                }
                if (memoryKey)
                    memoryRevisionsByTurn.delete(memoryKey);
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
                    clearBudgetTimer(runId);
                    workspace.completeRun(runId, event.ok, event.stopReason || (event.ok ? undefined : "Provider run failed"));
                    activeRunByThread.delete(event.threadId);
                    broadcastWorkspace();
                }
                // A rewound provider continuation becomes trustworthy only after the
                // replacement branch completes successfully. Spawn/handshake acceptance
                // alone is not enough: a later provider failure must keep replay mode on
                // for the next attempt.
                store.patchBot(bot.id, {
                    busy: false,
                    unread: true,
                    ...(event.ok && bot.rewound ? { rewound: false } : {}),
                });
                notifyPairedDevices(bot, "completed", event.ok);
                const providerTurn = activeProviderTurnByThread.get(event.threadId);
                if (providerTurn?.turnId === event.turnId)
                    activeProviderTurnByThread.delete(event.threadId);
                broadcast({ kind: "bot", bot: store.bot(bot.id) });
                clearThreadEventState(event.threadId);
                scheduleNextQueuedTurn(bot.id);
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
function startScreenPoller(botId, captureFrame = null) {
    if (screenPollers.has(botId) || (!captureFrame && !box.boxConfigured(cfg)))
        return;
    let inFlight = false;
    const capture = async () => {
        if (inFlight)
            return;
        inFlight = true;
        try {
            await commitCaptureIfCurrent(async () => {
                if (captureFrame)
                    return await captureFrame();
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
function boxAutoSleepMs() {
    if (!box.boxConfigured(cfg))
        return null;
    const configured = cfg.box?.autoSleepMinutes;
    return configured === false ? null : (configured ?? 10) * 60_000;
}
/** Every condition is re-read at the deadline; durable task/routine state is
 * authoritative, while transient maps close the provider and approval races. */
function cloudIdleSleepBlocker(botId, ignoreResourceLease = false) {
    const bot = store.bot(botId);
    if (!bot)
        return "bot-missing";
    if (deletingBotIds.has(botId) || botResourceGate.isDeleting(botId))
        return "deleting";
    if (bot.computer !== "cloud")
        return "not-cloud";
    if (bot.busy || activeRunByThread.has(bot.threadId) || activeProviderTurnByThread.has(bot.threadId))
        return "turn-active";
    const snapshot = workspace.snapshot();
    const botTasks = snapshot.tasks.filter((task) => task.botId === botId);
    if (botTasks.some((task) => task.status === "needs_attention") ||
        [...askMessageByRequest.keys()].some((key) => key.startsWith(threadEventPrefix(bot.threadId))))
        return "needs-attention";
    if (botTasks.some((task) => task.status === "queued" || task.status === "running") || queuedTurnTimers.has(botId))
        return "queue-active";
    if (snapshot.routines.some((routine) => routine.botId === botId && (routine.lastStatus === "queued" || routine.lastStatus === "running")))
        return "routine-active";
    if (screenPollers.has(botId))
        return "screen-active";
    if (!ignoreResourceLease && botResourceGate.hasActive(botId))
        return "resource-active";
    return null;
}
const boxIdleSleep = new BoxIdleSleepManager({
    idleMs: boxAutoSleepMs,
    blocker: (botId) => cloudIdleSleepBlocker(botId),
    sleep: async (botId, isCurrent) => botResourceGate.run(botId, async () => {
        if (!isCurrent() || cloudIdleSleepBlocker(botId, true))
            return false;
        await box.sleepBox(cfg, botId);
        return true;
    }),
});
// A restart has no trustworthy activity timestamp. Give existing explicit
// cloud selections a complete idle window instead of stopping immediately.
boxIdleSleep.reconcile(store.bots.filter((bot) => bot.computer === "cloud").map((bot) => bot.id));
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
            const environment = conn.mcpEnv ?? {};
            computerSecretValues = sensitiveEnvironmentValues(environment);
            refreshSecretCatalog();
            return { command: conn.mcpCommand, args: conn.mcpArgs ?? ["mcp"], env: environment };
        }
        catch {
            /* try the next location */
        }
    }
    computerSecretValues = [];
    refreshSecretCatalog();
    return null;
}
async function startTurn(botId, text, opts = {}) {
    text = secretCatalog.redactText(text);
    if (opts.track === false && opts.budget !== undefined)
        throw Object.assign(new Error("untracked turns cannot have a task budget"), { status: 400 });
    if (maintenanceMode)
        throw Object.assign(new Error("Cumea is in maintenance mode — retry in a moment"), { status: 409 });
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
                scheduledFor: opts.scheduledFor,
                attachmentIds: attachments.map((attachment) => attachment.id),
                budget: opts.budget,
            });
    if (opts.track !== false && !task)
        throw Object.assign(new Error("no such task"), { status: 404 });
    if (task && task.botId !== bot.id) {
        throw Object.assign(new Error("task belongs to another bot"), { status: 409 });
    }
    const retryingFailedTask = Boolean(opts.taskId && task?.status === "failed");
    const precreatedResume = opts.precreatedRunId ? workspace.run(opts.precreatedRunId) : null;
    if (opts.precreatedRunId && !precreatedResume) {
        throw Object.assign(new Error("resume attempt is unavailable"), { status: 409 });
    }
    const resumingInterruptedTask = Boolean(opts.resumeFrom && opts.taskId &&
        (task?.status === "interrupted" ||
            (task?.status === "running" && precreatedResume?.taskId === task.id && precreatedResume.status === "running")));
    if (task && task.status !== "queued" && !retryingFailedTask && !resumingInterruptedTask) {
        throw Object.assign(new Error("task is no longer queued"), { status: 409 });
    }
    const userMessage = opts.userMessage ?? store.appendMessage(bot.threadId, {
        role: "user",
        kind: "text",
        text,
        ...(attachments.length ? { attachments: attachments.map(publicAttachment) } : {}),
    });
    if (!opts.userMessage)
        broadcast({ kind: "message", threadId: bot.threadId, message: userMessage });
    if (task && !task.messageId && task.status === "queued")
        workspace.bindTaskMessage(task.id, userMessage.id);
    let runId;
    if (task) {
        const run = precreatedResume ?? workspace.createRun(task.id, opts.resumeFrom ? {
            resumeOfRunId: opts.resumeFrom.runId,
            resumedFromCheckpointId: opts.resumeFrom.checkpointId,
            omitAttachmentArtifacts: true,
        } : {});
        if (opts.precreatedRunId &&
            (run.id !== opts.precreatedRunId || run.botId !== bot.id || run.resumeOfRunId !== opts.resumeFrom?.runId ||
                run.resumedFromCheckpointId !== opts.resumeFrom?.checkpointId))
            throw Object.assign(new Error("resume attempt ownership changed"), { status: 409 });
        runId = run.id;
        armBudgetDeadline(bot, run.id);
        broadcastWorkspace();
    }
    const instance = registry.get(selection.instanceId);
    if (!instance) {
        const message = selection.instanceId
            ? `provider instance "${selection.instanceId}" is unavailable — choose a ready engine`
            : "provider unavailable — install or sign in to an AI engine, then check again";
        if (runId) {
            clearBudgetTimer(runId);
            workspace.completeRun(runId, false, message);
        }
        broadcastWorkspace();
        throw Object.assign(new Error(message), { status: 409 });
    }
    if (runId) {
        workspace.initializeCheckpoint(runId, {
            activeLeafId: userMessage.id,
            instanceId: selection.instanceId,
            model: selection.model,
            cursor: opts.resumeFrom?.forceFreshSession ? undefined : bot.resumeCursors[selection.instanceId],
        });
    }
    if (runId)
        activeRunByThread.set(bot.threadId, runId);
    // transcript for API-backed drivers: settled text turns only
    const canonicalTranscript = store
        .activePath(bot.threadId)
        .filter((m) => m.kind === "text" &&
        m.text &&
        m.delivery !== "queued" &&
        m.delivery !== "cancelled" &&
        m.delivery !== "failed" &&
        (opts.resumeFrom ? true : m.id !== userMessage.id) &&
        (!bot.context || m.at >= bot.context.startedAt))
        .map((m) => ({ id: m.id, role: m.role === "user" ? "user" : "assistant", text: secretCatalog.redactText(m.text), at: m.at }));
    const persona = [
        `You are ${bot.name}, a personal bot in Cumea.`,
        bot.title && `Role: ${bot.title}.`,
        bot.description && `About: ${bot.description}`,
    ]
        .filter(Boolean)
        .join(" ");
    const memoryContext = memory.context(bot.id, text);
    const skillContext = skillRegistry.systemPrompt(bot.skillAssignments);
    const rewound = bot.rewound === true;
    const replaySurvivingPath = (rewound && instance.driverKind !== "grok") || Boolean(opts.resumeFrom?.forceFreshSession);
    const nativeCursorResume = Boolean(opts.resumeFrom && !opts.resumeFrom.forceFreshSession);
    const shouldReplayTranscript = !nativeCursorResume && shouldCompactContext(instance.adapter.capabilities, replaySurvivingPath);
    const fallbackReplay = replaySurvivingPath && instance.adapter.capabilities.transcriptReplay !== true;
    const compacted = shouldReplayTranscript ? compactReplayContext(canonicalTranscript, fallbackReplay ? { maxBytes: 8 * 1024 } : {}) : null;
    const replayTranscript = (compacted?.messages ?? []).map(({ role, text: replayText }) => ({ role, text: replayText }));
    const continuation = opts.resumeFrom ? checkpointContinuationInput({
        survivingTranscript: replayTranscript,
        attachments,
        useProviderCursor: !opts.resumeFrom.forceFreshSession,
    }) : null;
    const providerText = opts.resumeFrom
        ? continuation.text
        : attachments.length
            ? `${text}\n\nAttached files available on this computer:\n${attachments
                .map((attachment) => `- ${attachment.name} (${attachment.mime}, ${attachment.size} bytes): ${attachment.storedPath}`)
                .join("\n")}`
            : text;
    const dispatchText = providerText;
    const replaySystemMetadata = replaySurvivingPath && compacted && instance.adapter.capabilities.transcriptReplay !== true
        ? renderReplayMetadata(compacted.messages, compacted.stats.omittedMessages)
        : "";
    if (runId && compacted) {
        const submittedBytes = fallbackReplay ? Buffer.byteLength(replaySystemMetadata, "utf8") : compacted.stats.submittedBytes;
        workspace.recordCompaction(runId, { ...compacted.stats, submittedBytes, estimatedSubmittedTokens: Math.ceil(submittedBytes / 4) });
    }
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
    let vmLeaseHeld = false;
    let turnComputer = null;
    const cleanupLateProvision = async () => {
        if (!cloudProvisionMayExist ||
            lateProvisionCleanupAttempted ||
            !shouldCleanupStaleProvision(store.bot(bot.id)))
            return;
        lateProvisionCleanupAttempted = true;
        if (provisionedBoxId) {
            const result = await box.archiveBoxByIdForDeletion(cfg, provisionedBoxId);
            if (result.outcome === "warning") {
                console.warn("cloud computer cleanup warning during late provisioning");
            }
        }
        else
            await archiveBotComputerForDeletion(bot.id, "late provisioning");
    };
    void (async () => {
        try {
            const integrations = {};
            if (instance.adapter.capabilities.customMcp === true && bot.mcpServerIds?.length) {
                integrations.mcpServers = mcpRegistry.resolve(bot.mcpServerIds);
            }
            if (bot.memoryWriteEnabled === true && instance.adapter.capabilities.memoryMcp === true) {
                integrations.memory = issueMemoryIntegration(bot, eventTurnId, runId).descriptor;
            }
            if (bot.appsEnabled !== false && instance.adapter.capabilities.composioMcp === true && cfg.composio?.key) {
                integrations.composio = { key: cfg.composio.key, url: cfg.composio.url };
            }
            const wants = bot.computer; // explicit destination, or undefined (auto)
            if (wants === "vm") {
                if (!computerProviderSupported("vm", instance.adapter.capabilities) || instance.driverKind === "boxAgent") {
                    throw new Error("this model engine cannot use the Local VM — choose Claude or an ACP engine, or select another computer destination");
                }
                const status = await localVmStatus();
                if (!isCurrentTurn())
                    return;
                if (!status.ready || !status.runtime) {
                    throw new Error(`${status.problem ?? "the Local VM is not ready"} (Cumea Settings → Integrations → Local VM)`);
                }
                if (!computerLeases.acquire("vm", bot.threadId)) {
                    throw new Error("the shared Local VM is already being used by another agent — wait for that turn to finish");
                }
                vmLeaseHeld = true;
                integrations.localComputer = localVmMcp(status.runtime);
                turnComputer = "vm";
            }
            if (wants === "cloud" && !computerProviderSupported("cloud", instance.adapter.capabilities)) {
                throw new Error("this model engine cannot use a cloud computer — choose another engine or computer destination");
            }
            if (wants === "local" && !computerProviderSupported("local", instance.adapter.capabilities)) {
                throw new Error("this model engine cannot control this computer — choose Claude or an ACP engine, or select another destination");
            }
            if (instance.adapter.capabilities.cloudComputerMcp === true && wants !== "off" && wants !== "local" && wants !== "vm" && box.boxConfigured(cfg)) {
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
                if (b) {
                    integrations.computer = { boxId: b.id, token: cfg.box.token };
                    turnComputer = "cloud";
                    if (bot.computer === "cloud")
                        boxIdleSleep.touch(bot.id);
                }
            }
            // local computer (this Mac) via the Electron-hosted cua-driver: the
            // Electron main process owns the daemon (TCC attribution) and writes
            // its spawn contract to cua-connection.json; the harness only reads it
            if (instance.adapter.capabilities.localComputerMcp === true && !integrations.computer && !integrations.localComputer && wants !== "off" && wants !== "cloud" && wants !== "vm") {
                const cua = readCuaConnection();
                if (cua) {
                    integrations.localComputer = cua;
                    turnComputer = "local";
                }
                else if (wants === "local") {
                    throw new Error("Cua Driver is not ready for this computer — check permissions and restart Cumea");
                }
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
                ? mentionedBots(text, store.bots.filter((b) => b.id !== bot.id))
                : [];
            // Last synchronous fence before invoking a provider. Deletion changes
            // the generation before its first await, so provisioning that resumes
            // late can never start a new turn for a removed bot.
            if (!isCurrentTurn())
                return;
            if (runId && workspace.checkDurationBudget(runId)) {
                exhaustRunBudget(bot, runId, "durationMs");
                return;
            }
            if (!eventAdmission.markDispatching())
                return;
            if (memoryContext.revisionIds.length) {
                memoryRevisionsByTurn.set(threadEventKey(bot.threadId, eventTurnId), {
                    botId: bot.id,
                    revisionIds: memoryContext.revisionIds,
                });
            }
            activeProviderTurnByThread.set(bot.threadId, { instanceId: selection.instanceId, turnId: eventTurnId });
            const started = await instance.adapter.sendTurn(secretCatalog.redactProviderInput({
                threadId: bot.threadId,
                turnId: eventTurnId,
                text: dispatchText,
                model: selection.model,
                resumeCursor: rewound || opts.resumeFrom?.forceFreshSession ? undefined : bot.resumeCursors[selection.instanceId],
                transcript: shouldReplayTranscript && instance.adapter.capabilities.transcriptReplay === true
                    ? (continuation?.transcript ?? replayTranscript)
                    : undefined,
                cwd: localWorkspace,
                system: persona + replaySystemMetadata + skillContext +
                    memoryContext.text +
                    " Keep private reasoning and routine tool chatter out of user-facing messages. For long work, send brief progress updates only at meaningful milestones so the user can steer or stop you without reading an execution log." +
                    " Put user-facing files you create locally in the current working directory and cite them as ./filename.ext so Cumea can open them safely. When you create a file through the cloud computer, put it under /workspace and cite its absolute /workspace/path. Never cite a private configuration or credential path as a deliverable." +
                    (integrations.computer && instance.driverKind !== "boxAgent"
                        ? " You have your own cloud computer — use the computer tools (screenshot, computer_exec, open_url) whenever browsing or acting on a desktop helps."
                        : integrations.localComputer && turnComputer === "vm"
                            ? " You can act inside an isolated Local VM through the computer tools. Read its desktop state first, prefer accessibility actions over raw coordinates, and keep generated files inside the VM unless the user asks to export them."
                            : integrations.localComputer
                                ? " You can act on the user's computer through the computer tools — take a screenshot or read the desktop state first, prefer accessibility actions over raw coordinates, and act carefully."
                                : "") +
                    (integrations.agents
                        ? " You can work with the user's other bots through the agents tools — list_bots shows who's available, ask_bot sends one of them a message and returns their reply. Delegate only when a specialist materially helps, ask each peer at most once for this task, and do not ask a peer to recruit another peer."
                        : "") +
                    (bot.coordinator ? coordinatorSystemPrompt(bot.id, store.bots, Boolean(integrations.agents)) : "") +
                    (integrations.composio
                        ? " The user's connected apps are available through the composio tools. Search for the right tool and use it before telling the user that a service is unavailable."
                        : "") +
                    (integrations.mcpServers?.length
                        ? " This agent has explicitly assigned local MCP tools. Use them only when relevant; requests remain subject to the agent's approval policy."
                        : "") +
                    (integrations.memory
                        ? " Durable memory tools are available. Search before claiming to remember a prior fact. Write only when the user explicitly requests memory or clearly confirms a durable preference; never store credentials or transient task chatter."
                        : "") +
                    (tagged.length
                        ? ` The user tagged ${tagged
                            .map((t) => `@${t.name} (ask_bot bot_id ${t.id})`)
                            .join(" and ")} in their message — bring them in with ask_bot and fold their reply into your answer.`
                        : ""),
                integrations,
            }));
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
                workspace.updateCheckpoint(runId, {
                    phase: "turn_accepted",
                    activeLeafId: userMessage.id,
                    instanceId: selection.instanceId,
                    model: selection.model,
                    cursor: opts.resumeFrom?.forceFreshSession ? undefined : store.bot(bot.id)?.resumeCursors[selection.instanceId],
                });
                broadcastWorkspace();
            }
            if (integrations.computer && turnStillActive)
                startScreenPoller(bot.id);
            if (turnComputer === "vm" && turnStillActive) {
                startScreenPoller(bot.id, async () => {
                    const image = await localVmScreenshot();
                    const matched = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(image);
                    if (!matched)
                        throw new Error("invalid Local VM screenshot");
                    return { png: matched[2], mime: matched[1], capturedAt: Date.now() };
                });
            }
        }
        catch (e) {
            memoryRevisionsByTurn.delete(threadEventKey(bot.threadId, eventTurnId));
            revokeMemoryTurn(threadEventKey(bot.threadId, eventTurnId));
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
            const message = secretCatalog.safeError(e, "Provider dispatch failed.");
            const failure = store.appendMessage(bot.threadId, {
                role: "bot",
                kind: "activity",
                tool: { name: `error: ${message.slice(0, 160)}`, ok: false },
            });
            broadcast({ kind: "message", threadId: bot.threadId, message: failure });
            if (runId) {
                clearBudgetTimer(runId);
                workspace.completeRun(runId, false, message);
                activeRunByThread.delete(bot.threadId);
                broadcastWorkspace();
            }
            store.patchBot(bot.id, { busy: false });
            broadcast({ kind: "bot", bot: store.bot(bot.id) });
            scheduleNextQueuedTurn(bot.id);
        }
        finally {
            // A normally running turn owns the fence until turn.completed. Failed or
            // cancelled dispatches must close it here so late callbacks stay stale.
            if (!providerTurnAccepted || !eventAdmission.isCurrent() || !isCurrentBot())
                eventAdmission.invalidate();
            if (vmLeaseHeld && !providerTurnAccepted)
                computerLeases.release("vm", bot.threadId);
            if (!providerTurnAccepted)
                revokeMemoryTurn(threadEventKey(bot.threadId, eventTurnId));
            turnOperation.release();
        }
    })();
}
const queuedTurnTimers = new Map();
function scheduleNextQueuedTurn(botId) {
    if (maintenanceMode)
        return;
    if (queuedTurnTimers.has(botId))
        return;
    const timer = setTimeout(() => {
        queuedTurnTimers.delete(botId);
        void dispatchNextQueuedTurn(botId);
    }, 0);
    timer.unref?.();
    queuedTurnTimers.set(botId, timer);
}
async function dispatchNextQueuedTurn(botId) {
    if (maintenanceMode)
        return;
    const bot = store.bot(botId);
    if (!bot || bot.busy || deletingBotIds.has(botId) || botResourceGate.isDeleting(botId))
        return;
    const task = workspace.queuedMessageTasks(botId)[0];
    if (!task)
        return;
    const message = task.messageId
        ? store.messagesFor(bot.threadId).find((candidate) => candidate.id === task.messageId)
        : undefined;
    if (!message || message.role !== "user" || message.kind !== "text") {
        workspace.settleQueuedTask(task.id, "failed");
        broadcastWorkspace();
        scheduleNextQueuedTurn(botId);
        return;
    }
    const attachments = workspace.attachmentsFor(botId, task.attachmentIds);
    const dispatched = store.patchMessage(bot.threadId, message.id, {
        parentId: store.activeLeaf(bot.threadId),
        delivery: "sent",
    });
    if (dispatched)
        store.setActiveLeaf(bot.threadId, dispatched.id);
    if (dispatched)
        broadcast({ kind: "message.patch", threadId: bot.threadId, message: dispatched });
    if (dispatched)
        broadcast({ kind: "thread", threadId: bot.threadId, activeLeafId: dispatched.id });
    try {
        await startTurn(botId, task.prompt, {
            taskId: task.id,
            attachments,
            userMessage: dispatched ?? message,
        });
    }
    catch (error) {
        workspace.settleQueuedTask(task.id, "failed");
        const failed = store.patchMessage(bot.threadId, message.id, { delivery: "failed" });
        if (failed)
            broadcast({ kind: "message.patch", threadId: bot.threadId, message: failed });
        broadcastWorkspace();
        scheduleNextQueuedTurn(botId);
    }
}
// ── config hot-reload ─────────────────────────────────────────────────
function configStatus() {
    const acpProfileCount = Object.values(persistedInstanceConfigs(cfg))
        .filter((instance) => instance.driver === CUSTOM_ACP_DRIVER_KIND).length;
    return {
        xai: { configured: Boolean(cfg.xai?.key) },
        composio: { configured: Boolean(cfg.composio?.key), apiKeyConfigured: Boolean(cfg.composio?.apiKey) },
        box: { configured: Boolean(cfg.box?.token) },
        // not a secret — the sidebar shows it
        profile: { name: cfg.profile?.name ?? "", email: cfg.profile?.email ?? "" },
        acpProfiles: { count: acpProfileCount },
    };
}
function listCustomAcpProfiles() {
    return Object.entries(persistedInstanceConfigs(cfg)).flatMap(([id, instance]) => {
        try {
            const profile = publicCustomAcpProfile(id, instance);
            return profile ? [profile] : [];
        }
        catch {
            // A forward-version or manually edited invalid entry remains preserved
            // in config and appears as an unavailable shadow in /api/instances; the
            // editor never receives a partially decoded command definition.
            return [];
        }
    });
}
async function persistCustomAcpInstances(instances) {
    if (store.bots.some((bot) => bot.busy)) {
        throw Object.assign(new Error("Wait for running agents to finish before changing ACP profiles."), { status: 409 });
    }
    saveConfig({ instances });
    Object.assign(cfg, loadConfig());
    refreshSecretCatalog();
    await reloadProviders();
    const status = configStatus();
    broadcast({ kind: "config", ...status });
    return status;
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
            scheduleNextQueuedTurn(bot.id);
        }
        broadcastWorkspace();
    });
    // reload() invalidated the fleet generation synchronously above. Retire all
    // accepted event ids in the same stack, before the queued reload can await.
    for (const bot of store.bots)
        turnEventFence.invalidate(bot.threadId);
    await reload;
}
async function runRoutine(routineId, options = {}) {
    const manual = options.manual === true;
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
                    scheduledFor: options.scheduledFor,
                    taskTitle: routine.name,
                });
            }
            catch (error) {
                const message = secretCatalog.safeError(error);
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
async function archiveBotComputerForDeletion(botId, _context) {
    const result = await box.archiveBoxForBotDeletion(cfg, botId);
    if (result.outcome === "warning") {
        // The helper deliberately redacts provider responses and credentials.
        console.warn("cloud computer cleanup warning");
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
    boxIdleSleep.cancel(bot.id);
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
        computerLeases.release("vm", bot.threadId);
        const runId = activeRunByThread.get(bot.threadId);
        if (runId) {
            clearBudgetTimer(runId);
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
                ...memory.botDeletionFiles(bot.id),
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
                    console.warn("cloud computer resume warning after deletion rollback");
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
        purgeCommittedFileDeletions([stagedFiles, stagedBotWorkspace], () => console.error("could not purge committed bot deletion quarantine"));
        // Capabilities are in-memory snapshots, so revoke them before clients can
        // observe bot.deleted. No preview remains usable after that event.
        fileCapabilities.revokeBot(bot.id);
        approvalRules.revokeBot(bot.id);
        broadcast({ kind: "bot.deleted", botId: bot.id, ...(options.operationId ? { operationId: options.operationId } : {}) }, { remoteDeletedBotWasVisible: !bot.hidden });
        broadcastWorkspace();
        return { deleted: true, removed: workspaceTransaction.removed, computerCleanup };
    }
    finally {
        deletingBotIds.delete(bot.id);
        resourceBarrier.release();
        const surviving = store.bot(bot.id);
        if (surviving?.computer === "cloud")
            boxIdleSleep.touch(surviving.id);
    }
}
let sweepingTemporaryBots = false;
async function dispatchTemporaryBotCleanup() {
    if (maintenanceMode || sweepingTemporaryBots)
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
        if (result.failed.length)
            console.error("temporary bot cleanup failed");
    }
    finally {
        sweepingTemporaryBots = false;
    }
}
let dispatchingRoutines = false;
async function dispatchDueRoutines() {
    if (maintenanceMode || dispatchingRoutines)
        return;
    dispatchingRoutines = true;
    try {
        for (const claim of workspace.claimDueRoutines()) {
            if (claim.outcome === "run") {
                try {
                    await runRoutine(claim.routineId, { scheduledFor: claim.scheduledFor });
                }
                catch (error) {
                    // A routine can be deleted after its durable scheduler claim. Timer
                    // callbacks must never turn that race into an unhandled rejection.
                    if (error?.status !== 404) {
                        console.error("scheduled routine dispatch failed");
                    }
                }
            }
        }
        broadcastWorkspace();
    }
    catch (error) {
        console.error("routine scheduler tick failed");
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
const initialQueuedTurnTimer = setTimeout(() => {
    for (const bot of store.bots)
        scheduleNextQueuedTurn(bot.id);
}, 1_000);
initialQueuedTurnTimer.unref();
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
function readBytes(req, maxBytes = ATTACHMENT_MAX_FILE_BYTES, label = "attachment") {
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
                fail(Object.assign(new Error(`${label} is larger than the ${Math.floor(maxBytes / (1024 * 1024))} MB limit`), { status: 413 }));
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
    if (method === "GET" && path === "/api/routines/occurrences")
        return true;
    if (method === "DELETE" && /^\/api\/attachments\/[\w-]+$/.test(path))
        return true;
    if (method === "DELETE" && /^\/api\/tasks\/[\w-]+\/queue$/.test(path))
        return true;
    if (method === "POST" && path === "/api/bots")
        return true;
    if (["GET", "POST", "DELETE"].includes(method) && path === "/api/mobile/push-token")
        return true;
    if (method === "POST" && /^\/api\/bots\/[\w-]+\/attachments$/.test(path))
        return true;
    if (method === "PATCH" && /^\/api\/bots\/[\w-]+$/.test(path))
        return true;
    if (method === "PATCH" && /^\/api\/routines\/[\w-]+$/.test(path))
        return true;
    if (method === "POST" && /^\/api\/routines\/[\w-]+\/run$/.test(path))
        return true;
    if (method === "POST" && /^\/api\/bots\/[\w-]+\/(messages|contexts|active-branch|respond|interrupt)$/.test(path))
        return true;
    if (method === "POST" && /^\/api\/bots\/[\w-]+\/messages\/[\w-]+\/edit$/.test(path))
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
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw Object.assign(new Error("schedule required"), { status: 400 });
    }
    const schedule = value;
    if (schedule.kind === "interval") {
        if (typeof schedule.everyMinutes !== "number") {
            throw Object.assign(new Error("interval minutes must be a number"), { status: 400 });
        }
        return { kind: "interval", everyMinutes: schedule.everyMinutes };
    }
    if (schedule.kind === "daily") {
        if (typeof schedule.time !== "string" || typeof schedule.timezone !== "string") {
            throw Object.assign(new Error("daily time and timezone must be strings"), { status: 400 });
        }
        return { kind: "daily", time: schedule.time, timezone: schedule.timezone };
    }
    if (schedule.kind === "weekly") {
        if (typeof schedule.time !== "string" ||
            typeof schedule.timezone !== "string" ||
            !Array.isArray(schedule.weekdays) ||
            schedule.weekdays.some((day) => typeof day !== "number")) {
            throw Object.assign(new Error("weekly time, timezone, and weekdays have invalid types"), { status: 400 });
        }
        return {
            kind: "weekly",
            time: schedule.time,
            timezone: schedule.timezone,
            weekdays: schedule.weekdays,
        };
    }
    throw Object.assign(new Error("unknown schedule kind"), { status: 400 });
}
function routineRequestBody(value, allowed) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw Object.assign(new Error("routine request body must be an object"), { status: 400 });
    }
    const body = value;
    if (Object.keys(body).some((key) => !allowed.includes(key))) {
        throw Object.assign(new Error("routine request contains unsupported fields"), { status: 400 });
    }
    return body;
}
function routineString(value, field, maxLength) {
    if (typeof value !== "string") {
        throw Object.assign(new Error(`${field} must be a string`), { status: 400 });
    }
    const clean = value.trim();
    if (!clean)
        throw Object.assign(new Error(`${field} is required`), { status: 400 });
    if (clean.length > maxLength)
        throw Object.assign(new Error(`${field} is too long`), { status: 400 });
    return secretCatalog.redactText(clean);
}
function routineBoolean(value, field) {
    if (typeof value !== "boolean") {
        throw Object.assign(new Error(`${field} must be a boolean`), { status: 400 });
    }
    return value;
}
function secretFreeMemoryInput(value) {
    const redacted = secretCatalog.redactValue(value);
    if (JSON.stringify(redacted) !== JSON.stringify(value)) {
        throw Object.assign(new Error("memory content must not contain credentials"), { status: 400 });
    }
    return value;
}
function integerQuery(url, name, fallback) {
    const raw = url.searchParams.get(name);
    if (raw === null)
        return fallback;
    if (!/^-?\d+$/.test(raw))
        throw Object.assign(new Error(`${name} must be an integer`), { status: 400 });
    const value = Number(raw);
    if (!Number.isSafeInteger(value))
        throw Object.assign(new Error(`${name} must be a safe integer`), { status: 400 });
    return value;
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
        if (maintenanceMode && path !== "/api/health") {
            return json(res, 503, { error: "Cumea is in maintenance mode — retry in a moment" });
        }
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
        if (path === "/api/mobile/push-token") {
            if (surface !== "remote" || !authenticatedDeviceId) {
                return json(res, 403, { error: "push registration is mobile-only" });
            }
            if (method === "GET") {
                const device = pairing.list().find((candidate) => candidate.id === authenticatedDeviceId);
                return json(res, 200, {
                    enabled: Boolean(device?.pushEnabled),
                    ...(device?.pushPlatform ? { platform: device.pushPlatform } : {}),
                });
            }
            if (method === "POST") {
                const body = await readBody(req);
                const platform = body.platform === "ios" || body.platform === "android" ? body.platform : null;
                if (!platform || typeof body.token !== "string") {
                    return json(res, 400, { error: "token and ios/android platform are required" });
                }
                const device = pairing.setPushRegistration(authenticatedDeviceId, { token: body.token, platform });
                if (!device)
                    return json(res, 404, { error: "no such device" });
                refreshSecretCatalog();
                return json(res, 200, { enabled: true, platform });
            }
            if (method === "DELETE") {
                const device = pairing.setPushRegistration(authenticatedDeviceId, null);
                if (!device)
                    return json(res, 404, { error: "no such device" });
                refreshSecretCatalog();
                return json(res, 200, { enabled: false });
            }
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
            refreshSecretCatalog();
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
                    .map((bot) => publicMobileBot(bot, store.messagesFor(bot.threadId), MOBILE_BOOTSTRAP_MESSAGE_LIMIT, visibleBotIds, store.activeLeaf(bot.threadId))),
                workspace: publicRemoteWorkspace(),
            });
        }
        // ── capability-scoped durable memory MCP ──────────────────────────
        if (path.startsWith("/api/internal/memory/")) {
            const authorization = String(req.headers.authorization ?? "");
            const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
            const capability = token ? memoryCapabilities.get(token) : undefined;
            if (!capability || capability.expiresAt <= Date.now()) {
                if (token) {
                    memoryCapabilities.delete(token);
                    refreshSecretCatalog();
                }
                return json(res, 401, { error: "unauthorized" });
            }
            const owner = store.bot(capability.botId);
            if (!owner || owner.threadId !== capability.threadId || owner.memoryWriteEnabled !== true) {
                memoryCapabilities.delete(token);
                refreshSecretCatalog();
                return json(res, 401, { error: "memory capability is no longer valid" });
            }
            if (method === "GET" && path === "/api/internal/memory/search") {
                const query = String(url.searchParams.get("q") ?? "").trim().slice(0, 500);
                if (!query)
                    return json(res, 400, { error: "query required" });
                return json(res, 200, secretCatalog.redactValue({
                    documents: memory.search(owner.id, query).map((document) => ({
                        path: document.path,
                        content: document.content,
                        revision: document.revision,
                    })),
                }));
            }
            if (method === "POST" && path === "/api/internal/memory/remember") {
                const document = memory.remember(owner.id, secretFreeMemoryInput(await readBody(req)), {
                    source: "agent",
                    threadId: capability.threadId,
                    ...(capability.runId ? { runId: capability.runId } : {}),
                });
                return json(res, 200, { document: { path: document.path, revision: document.revision } });
            }
            return json(res, 404, { error: "no route" });
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
        let effectMatch = path.match(/^\/api\/effects\/(effect-[\w-]+)\/resolve$/);
        if (effectMatch && method === "POST") {
            if (surface !== "local")
                return json(res, 403, { error: "external-effect resolution is local-only" });
            const effect = workspace.externalEffect(effectMatch[1]);
            if (!effect)
                return json(res, 404, { error: "no such external effect" });
            const body = await readBody(req);
            if (!body || typeof body !== "object" || Array.isArray(body) ||
                Object.keys(body).some((key) => key !== "resolution" && key !== "note") ||
                (body.resolution !== "applied" && body.resolution !== "failed"))
                return json(res, 400, { error: "resolution must be applied or failed" });
            return await botResourceGate.run(effect.botId, async () => {
                const current = workspace.externalEffect(effect.id);
                const bot = store.bot(effect.botId);
                if (!bot || current !== effect || current.botId !== effect.botId || !isCanonicalBotOperation(bot)) {
                    return json(res, 409, { error: "the effect owner changed" });
                }
                const resolved = workspace.resolveExternalEffect(effect.id, body.resolution, typeof body.note === "string" ? secretCatalog.redactText(body.note) : body.note);
                broadcastWorkspace();
                return json(res, 200, { effect: resolved });
            });
        }
        if (method === "GET" && path === "/api/routines/occurrences") {
            const now = Date.now();
            const from = integerQuery(url, "from", now);
            const to = integerQuery(url, "to", now + 7 * 24 * 60 * 60_000);
            const limit = integerQuery(url, "limit", 256);
            if (Number.isNaN(new Date(from).getTime()) ||
                Number.isNaN(new Date(to).getTime()) ||
                to < from ||
                to - from > 31 * 24 * 60 * 60_000) {
                return json(res, 400, { error: "occurrence window must be between 0 and 31 days" });
            }
            if (limit < 1 || limit > 512)
                return json(res, 400, { error: "limit must be between 1 and 512" });
            const visibleBotIds = surface === "remote" ? visibleRemoteBotIds() : undefined;
            const occurrences = workspace.projectRoutines(from, to, limit, visibleBotIds);
            return json(res, 200, { occurrences });
        }
        if (method === "POST" && path === "/api/sections") {
            const body = await readBody(req);
            const section = workspace.createSection(secretCatalog.redactText(String(body.name ?? "")));
            broadcastWorkspace();
            return json(res, 201, { section });
        }
        let m = path.match(/^\/api\/sections\/([\w-]+)$/);
        if (m && method === "PATCH") {
            const body = await readBody(req);
            const section = workspace.patchSection(m[1], secretCatalog.redactText(String(body.name ?? "")));
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
            const body = routineRequestBody(await readBody(req), ["botId", "name", "prompt", "schedule", "enabled"]);
            const botId = routineString(body.botId, "botId", 100);
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
                    name: secretCatalog.redactText(routineString(body.name, "routine name", ROUTINE_NAME_MAX_LENGTH)),
                    prompt: secretCatalog.redactText(routineString(body.prompt, "routine task", ROUTINE_PROMPT_MAX_LENGTH)),
                    schedule: parseRoutineSchedule(body.schedule),
                    enabled: body.enabled === undefined ? true : routineBoolean(body.enabled, "enabled"),
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
                let body;
                try {
                    body = routineRequestBody(await readBody(req), ["name", "prompt", "schedule", "enabled"]);
                }
                catch (error) {
                    if (surface === "remote" && error.message === "routine request contains unsupported fields") {
                        return json(res, 400, { error: "mobile may only edit the routine name, task, schedule, or enabled state" });
                    }
                    throw error;
                }
                if (!Object.keys(body).length)
                    return json(res, 400, { error: "routine patch is empty" });
                if (store.bot(bot.id) !== bot ||
                    workspace.snapshot().routines.find((candidate) => candidate.id === routineId) !== owner ||
                    !isCanonicalBotOperation(bot)) {
                    return json(res, 409, { error: "the bot is being deleted" });
                }
                const routine = workspace.patchRoutine(routineId, {
                    ...(body.name !== undefined ? { name: secretCatalog.redactText(routineString(body.name, "routine name", ROUTINE_NAME_MAX_LENGTH)) } : {}),
                    ...(body.prompt !== undefined ? { prompt: secretCatalog.redactText(routineString(body.prompt, "routine task", ROUTINE_PROMPT_MAX_LENGTH)) } : {}),
                    ...(body.schedule !== undefined ? { schedule: parseRoutineSchedule(body.schedule) } : {}),
                    ...(body.enabled !== undefined ? { enabled: routineBoolean(body.enabled, "enabled") } : {}),
                });
                if (!routine)
                    return json(res, 404, { error: "no such routine" });
                broadcastWorkspace();
                return json(res, 200, { routine: surface === "remote" ? publicRemoteRoutine(routine.id) : routine });
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
            const routine = workspace.snapshot().routines.find((candidate) => candidate.id === m[1]);
            const bot = routine ? store.bot(routine.botId) : null;
            if (!routine || !bot || (surface === "remote" && bot.hidden))
                return json(res, 404, { error: "no such routine" });
            await runRoutine(m[1], { manual: true });
            return json(res, 202, { ok: true });
        }
        m = path.match(/^\/api\/tasks\/([\w-]+)\/evidence-requirements$/);
        if (m && method === "POST") {
            if (surface !== "local")
                return json(res, 403, { error: "verification policy administration is local-only" });
            const taskId = m[1];
            const owner = workspace.task(taskId);
            if (!owner)
                return json(res, 404, { error: "no such task" });
            const body = await readBody(req);
            if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => key !== "label")) {
                return json(res, 400, { error: "evidence requirement accepts only a label" });
            }
            return await botResourceGate.run(owner.botId, async () => {
                const current = workspace.task(taskId);
                const bot = store.bot(owner.botId);
                if (!bot || current !== owner || current.botId !== owner.botId || !isCanonicalBotOperation(bot)) {
                    return json(res, 409, { error: "the task owner changed" });
                }
                const requirement = workspace.addEvidenceRequirement(taskId, typeof body.label === "string" ? secretCatalog.redactText(body.label) : body.label);
                broadcastWorkspace();
                return json(res, 201, { requirement, verificationStatus: workspace.verificationStatus(taskId) });
            });
        }
        m = path.match(/^\/api\/tasks\/([\w-]+)\/evidence-requirements\/([\w-]+)$/);
        if (m && method === "DELETE") {
            if (surface !== "local")
                return json(res, 403, { error: "verification policy administration is local-only" });
            const taskId = m[1];
            const owner = workspace.task(taskId);
            if (!owner)
                return json(res, 404, { error: "no such task" });
            return await botResourceGate.run(owner.botId, async () => {
                const current = workspace.task(taskId);
                const bot = store.bot(owner.botId);
                if (!bot || current !== owner || current.botId !== owner.botId || !isCanonicalBotOperation(bot)) {
                    return json(res, 409, { error: "the task owner changed" });
                }
                if (!workspace.removeEvidenceRequirement(taskId, m[2]))
                    return json(res, 404, { error: "no such evidence requirement" });
                broadcastWorkspace();
                return json(res, 200, { ok: true, verificationStatus: workspace.verificationStatus(taskId) });
            });
        }
        m = path.match(/^\/api\/tasks\/([\w-]+)\/evidence$/);
        if (m && method === "POST") {
            if (surface !== "local")
                return json(res, 403, { error: "evidence recording is local-only" });
            const taskId = m[1];
            const owner = workspace.task(taskId);
            if (!owner)
                return json(res, 404, { error: "no such task" });
            const body = await readBody(req);
            if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !["requirementId", "runId", "reference"].includes(key))) {
                return json(res, 400, { error: "invalid evidence record" });
            }
            const reference = body.reference;
            if (typeof body.requirementId !== "string" || body.requirementId.length > 100 ||
                typeof body.runId !== "string" || body.runId.length > 100 ||
                !reference || typeof reference !== "object" || Array.isArray(reference) ||
                Object.keys(reference).some((key) => !["kind", "id"].includes(key)) ||
                (reference.kind !== "step" && reference.kind !== "artifact") ||
                typeof reference.id !== "string" || reference.id.length > 100)
                return json(res, 400, { error: "evidence must reference one canonical run step or artifact" });
            return await botResourceGate.run(owner.botId, async () => {
                const current = workspace.task(taskId);
                const bot = store.bot(owner.botId);
                if (!bot || current !== owner || current.botId !== owner.botId || !isCanonicalBotOperation(bot)) {
                    return json(res, 409, { error: "the task owner changed" });
                }
                const evidence = workspace.recordEvidence({
                    taskId,
                    requirementId: body.requirementId,
                    runId: body.runId,
                    reference: { kind: reference.kind, id: reference.id },
                });
                broadcastWorkspace();
                return json(res, 201, { evidence, verificationStatus: workspace.verificationStatus(taskId) });
            });
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
                const body = routineRequestBody(await readBody(req), ["timezone", "name", "schedule", "enabled"]);
                if (store.bot(bot.id) !== bot || workspace.task(taskId) !== task || !isCanonicalBotOperation(bot)) {
                    return json(res, 409, { error: "the bot is being deleted" });
                }
                const timezone = body.timezone === undefined
                    ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
                    : routineString(body.timezone, "timezone", 100);
                const routine = workspace.createRoutine({
                    botId: task.botId,
                    name: secretCatalog.redactText(body.name === undefined ? task.title : routineString(body.name, "routine name", ROUTINE_NAME_MAX_LENGTH)),
                    prompt: secretCatalog.redactText(task.prompt),
                    schedule: body.schedule !== undefined
                        ? parseRoutineSchedule(body.schedule)
                        : { kind: "daily", time: "09:00", timezone },
                    enabled: body.enabled === undefined ? false : routineBoolean(body.enabled, "enabled"),
                });
                broadcastWorkspace();
                return json(res, 201, { routine });
            });
        }
        m = path.match(/^\/api\/tasks\/([\w-]+)\/queue$/);
        if (m && method === "DELETE") {
            const task = workspace.task(m[1]);
            if (!task || task.source !== "message" || task.status !== "queued") {
                return json(res, 404, { error: "no such queued message" });
            }
            return await botResourceGate.run(task.botId, async () => {
                const bot = store.bot(task.botId);
                const current = workspace.task(task.id);
                if (!bot || !current || current !== task || !isCanonicalBotOperation(bot)) {
                    return json(res, 409, { error: "the bot is being deleted" });
                }
                const cancelled = workspace.settleQueuedTask(task.id, "cancelled");
                if (!cancelled)
                    return json(res, 409, { error: "that message has already started" });
                if (task.messageId) {
                    const message = store.patchMessage(bot.threadId, task.messageId, { delivery: "cancelled" });
                    if (message)
                        broadcast({ kind: "message.patch", threadId: bot.threadId, message });
                }
                broadcastWorkspace();
                return json(res, 200, { task: cancelled });
            });
        }
        m = path.match(/^\/api\/tasks\/([\w-]+)\/retry$/);
        if (m && method === "POST") {
            const task = workspace.task(m[1]);
            if (!task)
                return json(res, 404, { error: "no such task" });
            if (task.status !== "failed")
                return json(res, 409, { error: "only failed tasks can be retried" });
            const attachments = workspace.attachmentsFor(task.botId, task.attachmentIds);
            if (attachments.some((attachment) => !existsSync(attachment.storedPath))) {
                return json(res, 409, { error: "one or more task attachments are missing from disk" });
            }
            await startTurn(task.botId, task.prompt, { taskId: task.id, attachments });
            return json(res, 202, { ok: true });
        }
        m = path.match(/^\/api\/runs\/([\w-]+)\/resume$/);
        if (m && method === "POST") {
            if (surface !== "local")
                return json(res, 403, { error: "checkpoint resume is local-only" });
            const requestedRun = workspace.run(m[1]);
            if (!requestedRun)
                return json(res, 404, { error: "no such run" });
            const body = await readBody(req);
            if (!body || typeof body !== "object" || Array.isArray(body) ||
                Object.keys(body).some((key) => key !== "checkpointId") ||
                typeof body.checkpointId !== "string" || !/^[\w-]{1,100}$/.test(body.checkpointId))
                return json(res, 400, { error: "an exact checkpointId is required" });
            return await botResourceGate.run(requestedRun.botId, async () => {
                const run = workspace.run(requestedRun.id);
                const task = run ? workspace.task(run.taskId) : null;
                const bot = run ? store.bot(run.botId) : null;
                if (run !== requestedRun || !task || !bot || task.botId !== bot.id ||
                    !isCanonicalBotOperation(bot) || bot.busy || run.status !== "interrupted" ||
                    task.status !== "interrupted" || task.latestRunId !== run.id)
                    return json(res, 409, { error: "checkpoint owner or run state changed" });
                const checkpoint = run.checkpoint;
                if (!checkpoint || checkpoint.id !== body.checkpointId) {
                    return json(res, 409, { error: "checkpoint no longer matches this run" });
                }
                if (!task.messageId)
                    return json(res, 409, { error: "canonical task message is unavailable" });
                const userMessage = store.messagesFor(bot.threadId).find((message) => message.id === task.messageId);
                if (!userMessage || userMessage.role !== "user" || userMessage.kind !== "text" || userMessage.text !== task.prompt) {
                    return json(res, 409, { error: "canonical task transcript is unavailable" });
                }
                const instance = registry.get(bot.modelSelection.instanceId);
                const plan = planCheckpointResume({
                    checkpoint,
                    activeLeafId: store.activeLeaf(bot.threadId),
                    providerAvailable: Boolean(instance),
                    currentInstanceId: bot.modelSelection.instanceId,
                    currentModel: bot.modelSelection.model,
                    currentCursor: bot.resumeCursors[bot.modelSelection.instanceId],
                    sessionResumeCapable: instance?.adapter.capabilities.sessionResume === true,
                    unsafeEffects: workspace.hasUnsafeEffects(run.id),
                });
                if (!plan.allowed) {
                    return json(res, 409, { error: `checkpoint resume blocked: ${plan.reason ?? "unsafe"}` });
                }
                const attachments = workspace.attachmentsFor(task.botId, task.attachmentIds);
                if (attachments.length !== task.attachmentIds.length || attachments.some((attachment) => !existsSync(attachment.storedPath))) {
                    return json(res, 409, { error: "one or more task attachments are missing from disk" });
                }
                const next = workspace.createResumeRun(run.id);
                broadcastWorkspace();
                try {
                    await startTurn(bot.id, task.prompt, {
                        taskId: task.id,
                        attachments,
                        userMessage,
                        resumeFrom: { runId: run.id, checkpointId: checkpoint.id, forceFreshSession: !plan.useProviderCursor },
                        precreatedRunId: next.id,
                    });
                }
                catch (error) {
                    workspace.completeRun(next.id, false, secretCatalog.safeError(error));
                    broadcastWorkspace();
                    throw error;
                }
                return json(res, 202, {
                    ok: true,
                    runId: next.id,
                    resumeOfRunId: run.id,
                    providerSession: plan.useProviderCursor ? "verified_cursor" : "fresh",
                });
            });
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
                const capability = fileCapabilities.issue(bot.id, file, { allowHtml: true });
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
                    "content-type": capability.kind === "html" ? "application/octet-stream" : capability.mime,
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
            if (capability.kind === "html") {
                res.writeHead(200, {
                    ...SECURITY_HEADERS,
                    "cache-control": "no-store",
                    "content-type": capability.mime,
                    "content-length": String(capability.bytes.length),
                    "content-disposition": `inline; filename*=UTF-8''${encodedName}`,
                    "content-security-policy": HTML_ARTIFACT_CSP,
                    "permissions-policy": HTML_ARTIFACT_PERMISSIONS_POLICY,
                    // The application embeds this exact same-origin capability into an
                    // iframe whose empty sandbox makes the document's origin opaque.
                    "x-frame-options": "SAMEORIGIN",
                });
                return res.end(capability.bytes);
            }
            res.setHeader("cache-control", "no-store");
            return json(res, 200, { preview: await buildStructuredPreview(capability.kind, capability.bytes) });
        }
        // ── local, instruction-only skill packages ──
        if (path === "/api/skills" && method === "GET") {
            if (surface !== "local")
                return json(res, 403, { error: "local skill management is desktop-local" });
            return json(res, 200, { skills: skillRegistry.list() });
        }
        if (path === "/api/skills" && method === "POST") {
            if (surface !== "local")
                return json(res, 403, { error: "local skill management is desktop-local" });
            return json(res, 201, { skill: skillRegistry.create(await readBody(req)) });
        }
        if (path === "/api/skills/import" && method === "POST") {
            if (surface !== "local")
                return json(res, 403, { error: "local skill import is desktop-local" });
            return json(res, 201, { skill: skillRegistry.import(await readBody(req)) });
        }
        m = path.match(/^\/api\/skills\/([a-z0-9][a-z0-9-]{0,63})\/versions$/);
        if (m && method === "POST") {
            if (surface !== "local")
                return json(res, 403, { error: "local skill updates are desktop-local" });
            const body = await readBody(req);
            if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).sort().join("\0") !== ["description", "displayName", "enabled", "id", "instructions", "label", "version"].join("\0")) {
                return json(res, 400, { error: "skill update body has unknown or missing fields" });
            }
            if (body.id !== m[1])
                return json(res, 400, { error: "skill update id does not match its route" });
            return json(res, 201, { skill: skillRegistry.create(body, { requireNewer: true }) });
        }
        m = path.match(/^\/api\/skills\/([a-z0-9][a-z0-9-]{0,63})\/([0-9A-Za-z.+-]+)$/);
        if (m && method === "GET") {
            if (surface !== "local")
                return json(res, 403, { error: "local skill content is desktop-local" });
            return json(res, 200, { skill: skillRegistry.package(m[1], m[2]) });
        }
        if (m && method === "PATCH") {
            if (surface !== "local")
                return json(res, 403, { error: "local skill updates are desktop-local" });
            const body = await readBody(req);
            if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || typeof body.enabled !== "boolean")
                return json(res, 400, { error: "only the enabled flag can be changed in place" });
            if (!body.enabled && store.bots.some((bot) => bot.skillAssignments?.some((assignment) => assignment.id === m[1] && assignment.version === m[2]))) {
                return json(res, 409, { error: "unassign this exact skill version before disabling it" });
            }
            return json(res, 200, { manifest: skillRegistry.setEnabled(m[1], m[2], body.enabled) });
        }
        if (m && method === "DELETE") {
            if (surface !== "local")
                return json(res, 403, { error: "local skill deletion is desktop-local" });
            if (store.bots.some((bot) => bot.skillAssignments?.some((assignment) => assignment.id === m[1] && assignment.version === m[2]))) {
                return json(res, 409, { error: "unassign this exact skill version before deleting it" });
            }
            skillRegistry.delete(m[1], m[2]);
            return json(res, 200, { ok: true });
        }
        m = path.match(/^\/api\/bots\/([\w-]+)\/skills\/([a-z0-9][a-z0-9-]{0,63})(?:\/(rollback))?$/);
        if (m && ((!m[3] && method === "PUT") || (m[3] === "rollback" && method === "POST"))) {
            if (surface !== "local")
                return json(res, 403, { error: "agent skill assignment is desktop-local" });
            return await botResourceGate.run(m[1], async () => {
                const bot = store.bot(m[1]);
                if (!bot)
                    return json(res, 404, { error: "no such bot" });
                if (bot.busy)
                    return json(res, 409, { error: "wait for the active turn before changing assigned skills" });
                const body = await readBody(req);
                if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || typeof body.version !== "string")
                    return json(res, 400, { error: "skill assignment body must contain exactly one version" });
                const assignment = validateSkillAssignment({ id: m[2], version: body.version });
                if (!skillRegistry.has(assignment.id, assignment.version, true))
                    return json(res, 409, { error: "that exact enabled skill version is unavailable" });
                const current = bot.skillAssignments ?? [];
                const previous = current.find((candidate) => candidate.id === assignment.id);
                if (m[3] === "rollback" && (!previous || compareSkillVersions(assignment.version, previous.version) >= 0))
                    return json(res, 409, { error: "rollback requires an older available SemVer version" });
                const next = [...current.filter((candidate) => candidate.id !== assignment.id), assignment];
                if (next.length > SKILL_MAX_ASSIGNMENTS)
                    return json(res, 409, { error: "agent skill assignment limit reached" });
                const patched = store.patchBot(bot.id, { skillAssignments: next });
                if (!patched)
                    return json(res, 409, { error: "the bot is being deleted" });
                broadcast({ kind: "bot", bot: patched });
                return json(res, 200, { bot: patched });
            });
        }
        if (m && method === "DELETE" && !m[3]) {
            if (surface !== "local")
                return json(res, 403, { error: "agent skill assignment is desktop-local" });
            return await botResourceGate.run(m[1], async () => {
                const bot = store.bot(m[1]);
                if (!bot)
                    return json(res, 404, { error: "no such bot" });
                if (bot.busy)
                    return json(res, 409, { error: "wait for the active turn before changing assigned skills" });
                if (!bot.skillAssignments?.some((assignment) => assignment.id === m[2]))
                    return json(res, 404, { error: "that skill is not assigned" });
                const patched = store.patchBot(bot.id, { skillAssignments: bot.skillAssignments.filter((assignment) => assignment.id !== m[2]) });
                if (!patched)
                    return json(res, 409, { error: "the bot is being deleted" });
                broadcast({ kind: "bot", bot: patched });
                return json(res, 200, { bot: patched });
            });
        }
        // ── bots ──
        if (method === "GET" && path === "/api/bots") {
            const visibleBotIds = visibleRemoteBotIds();
            return json(res, 200, secretCatalog.redactValue({
                bots: surface === "remote"
                    ? store.bots
                        .filter((bot) => !bot.hidden)
                        .map((bot) => publicMobileBot(bot, store.messagesFor(bot.threadId), MOBILE_BOOTSTRAP_MESSAGE_LIMIT, visibleBotIds, store.activeLeaf(bot.threadId)))
                    : store.bots.map((b) => ({ ...b, messages: store.messagesFor(b.threadId), activeLeafId: store.activeLeaf(b.threadId) })),
            }));
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
                : secretCatalog.redactText(String(body.name).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80));
            if (requestedName !== undefined && !requestedName)
                return json(res, 400, { error: "name cannot be empty" });
            const requestedTitle = body.title === undefined
                ? undefined
                : secretCatalog.redactText(String(body.title).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 120));
            const bot = store.createBot({ lifecycle });
            const patch = { modelSelection: await defaultSelection() };
            if (requestedName !== undefined)
                patch.name = requestedName;
            if (requestedTitle !== undefined)
                patch.title = requestedTitle;
            store.patchBot(bot.id, patch);
            const created = store.bot(bot.id);
            broadcast({ kind: "bot", bot: created });
            return json(res, 201, secretCatalog.redactValue({
                bot: surface === "remote"
                    ? publicMobileBot(created, store.messagesFor(created.threadId), MOBILE_BOOTSTRAP_MESSAGE_LIMIT, visibleRemoteBotIds(), store.activeLeaf(created.threadId))
                    : { ...created, messages: store.messagesFor(bot.threadId), activeLeafId: store.activeLeaf(bot.threadId) },
            }));
        }
        m = path.match(/^\/api\/bots\/([\w-]+)\/memories$/);
        if (m && method === "GET") {
            if (surface !== "local")
                return json(res, 403, { error: "agent memory management is local-only" });
            const bot = store.bot(m[1]);
            if (!bot)
                return json(res, 404, { error: "no such bot" });
            return json(res, 200, secretCatalog.redactValue({
                documents: memory.list(bot.id),
                retention: { maxDocuments: 100, maxRevisionsPerDocument: 50, maxContentBytes: 16 * 1024 },
            }));
        }
        if (m && method === "POST") {
            if (surface !== "local")
                return json(res, 403, { error: "agent memory management is local-only" });
            const bot = store.bot(m[1]);
            if (!bot)
                return json(res, 404, { error: "no such bot" });
            const document = memory.create(bot.id, secretFreeMemoryInput(await readBody(req)), { source: "user", threadId: bot.threadId });
            return json(res, 201, { document });
        }
        m = path.match(/^\/api\/bots\/([\w-]+)\/memories\/(mem-[a-f0-9]{20})\/revisions$/);
        if (m && method === "GET") {
            if (surface !== "local")
                return json(res, 403, { error: "agent memory management is local-only" });
            if (!store.bot(m[1]))
                return json(res, 404, { error: "no such bot" });
            return json(res, 200, secretCatalog.redactValue({ revisions: memory.revisions(m[1], m[2]) }));
        }
        m = path.match(/^\/api\/bots\/([\w-]+)\/memories\/(mem-[a-f0-9]{20})$/);
        if (m && method === "PUT") {
            if (surface !== "local")
                return json(res, 403, { error: "agent memory management is local-only" });
            const bot = store.bot(m[1]);
            if (!bot)
                return json(res, 404, { error: "no such bot" });
            const document = memory.update(bot.id, m[2], secretFreeMemoryInput(await readBody(req)), { source: "user", threadId: bot.threadId });
            return json(res, 200, { document });
        }
        if (m && method === "DELETE") {
            if (surface !== "local")
                return json(res, 403, { error: "agent memory management is local-only" });
            const bot = store.bot(m[1]);
            if (!bot)
                return json(res, 404, { error: "no such bot" });
            const body = await readBody(req);
            return memory.delete(bot.id, m[2], body.expectedRevision)
                ? json(res, 200, { ok: true })
                : json(res, 404, { error: "no such memory document" });
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
                if (body.computer !== undefined && !["cloud", "vm", "local", "off"].includes(body.computer)) {
                    return json(res, 400, { error: "unknown computer destination" });
                }
                if (body.memoryWriteEnabled !== undefined && typeof body.memoryWriteEnabled !== "boolean") {
                    return json(res, 400, { error: "memoryWriteEnabled must be a boolean" });
                }
                if (body.coordinator !== undefined && typeof body.coordinator !== "boolean") {
                    return json(res, 400, { error: "coordinator must be a boolean" });
                }
                const willCoordinate = body.coordinator === true || (owner.coordinator === true && body.coordinator !== false);
                if (willCoordinate && (body.temporary === true || owner.lifecycle && body.temporary !== false)) {
                    return json(res, 400, { error: "a temporary bot cannot be the workspace Coordinator" });
                }
                if (willCoordinate && body.hidden === true) {
                    return json(res, 400, { error: "the workspace Coordinator must remain visible" });
                }
                if (willCoordinate && body.collaborationEnabled === false) {
                    return json(res, 400, { error: "the workspace Coordinator requires bot collaboration" });
                }
                if (willCoordinate) {
                    const selectedInstanceId = body.modelSelection?.instanceId ?? owner.modelSelection.instanceId;
                    const selectedInstance = typeof selectedInstanceId === "string" ? registry.get(selectedInstanceId) : null;
                    if (selectedInstance?.adapter.capabilities.agentsMcp !== true) {
                        return json(res, 400, { error: "the selected provider does not support Coordinator peer tools" });
                    }
                }
                const lifecycleMutation = body.temporary !== undefined;
                if (body.temporary === true)
                    patch.lifecycle = temporaryBotLifecycle(body.ttlMinutes);
                for (const key of [
                    "name", "title", "description", "notifications", "modelSelection", "unread", "computer", "color",
                    "mascotExpression", "pinned", "hidden", "appsEnabled", "collaborationEnabled", "memoryWriteEnabled",
                ]) {
                    if (body[key] !== undefined) {
                        patch[key] = ["name", "title", "description"].includes(key)
                            ? secretCatalog.redactText(String(body[key]))
                            : body[key];
                    }
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
                    return json(res, 400, { error: "global approval policies are no longer supported" });
                }
                if (body.mcpServerIds !== undefined) {
                    if (!Array.isArray(body.mcpServerIds) ||
                        body.mcpServerIds.length > 16 ||
                        body.mcpServerIds.some((id) => typeof id !== "string" || !mcpRegistry.has(id)) ||
                        new Set(body.mcpServerIds).size !== body.mcpServerIds.length) {
                        return json(res, 400, { error: "mcpServerIds must contain up to 16 unique configured server ids" });
                    }
                    patch.mcpServerIds = body.mcpServerIds;
                }
                if (body.coordinator !== undefined) {
                    patch.coordinator = body.coordinator;
                    if (body.coordinator)
                        patch.collaborationEnabled = true;
                }
                const displacedCoordinator = body.coordinator === true
                    ? store.bots.find((candidate) => candidate.id !== botId && candidate.coordinator === true)
                    : undefined;
                const bot = store.patchBot(botId, patch, { clearLifecycle: lifecycleMutation && body.temporary === false });
                if (!bot)
                    return json(res, 409, { error: "the bot is being deleted" });
                if (body.computer !== undefined) {
                    if (bot.computer === "cloud")
                        boxIdleSleep.touch(bot.id);
                    else
                        boxIdleSleep.cancel(bot.id);
                }
                const botEvent = lifecycleMutation && body.temporary === false ? { ...bot, lifecycle: null } : bot;
                if (remoteWasVisible && bot.hidden) {
                    broadcast({ kind: "bot", bot: botEvent }, { remoteOverride: { kind: "bot.deleted", botId: bot.id }, remoteDeletedBotWasVisible: true });
                }
                else
                    broadcast({ kind: "bot", bot: botEvent });
                if (displacedCoordinator) {
                    const displaced = store.bot(displacedCoordinator.id);
                    if (displaced)
                        broadcast({ kind: "bot", bot: displaced });
                }
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
        m = path.match(/^\/api\/bots\/([\w-]+)\/approval-rules$/);
        if (m && method === "GET") {
            if (surface !== "local")
                return json(res, 403, { error: "approval rule administration is local-only" });
            const bot = store.bot(m[1]);
            if (!bot)
                return json(res, 404, { error: "no such bot" });
            return json(res, 200, { rules: approvalRules.list(bot.id) });
        }
        m = path.match(/^\/api\/bots\/([\w-]+)\/approval-rules\/([\w-]+)$/);
        if (m && method === "DELETE") {
            if (surface !== "local")
                return json(res, 403, { error: "approval rule administration is local-only" });
            const bot = store.bot(m[1]);
            if (!bot)
                return json(res, 404, { error: "no such bot" });
            return approvalRules.revoke(bot.id, m[2])
                ? json(res, 200, { ok: true })
                : json(res, 404, { error: "no such approval rule" });
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
            return json(res, 200, secretCatalog.redactValue({
                messages: surface === "remote"
                    ? page.map((message) => publicMobileMessage(message, visibleRemoteBotIds()))
                    : page,
                nextCursor: nextBefore,
                page: {
                    limit,
                    hasMore: start > 0,
                    nextBefore,
                },
                activeLeafId: store.activeLeaf(bot.threadId),
            }));
        }
        m = path.match(/^\/api\/bots\/([\w-]+)\/contexts$/);
        if (m && method === "POST") {
            const botId = m[1];
            return await botResourceGate.run(botId, async () => {
                const bot = store.bot(botId);
                if (!bot || (surface === "remote" && bot.hidden))
                    return json(res, 404, { error: "no such bot" });
                const body = await readBody(req);
                if (store.bot(botId) !== bot || !isCanonicalBotOperation(bot)) {
                    return json(res, 409, { error: "the bot is being deleted" });
                }
                if (bot.busy)
                    return json(res, 409, { error: "wait for or stop the active task before starting a new context" });
                if (workspace.queuedMessageTasks(botId).length) {
                    return json(res, 409, { error: "send or cancel queued messages before starting a new context" });
                }
                const startedAt = Date.now();
                const label = secretCatalog.redactText(String(body.label ?? "New task")
                    .replace(/[\u0000-\u001f\u007f]/g, "")
                    .trim()
                    .slice(0, 80)) || "New task";
                const context = { id: newId(), label, startedAt };
                const marker = store.appendMessage(bot.threadId, { role: "bot", kind: "context", context });
                const patched = store.patchBot(bot.id, { context, resumeCursors: {}, rewound: false, unread: false });
                broadcast({ kind: "message", threadId: bot.threadId, message: marker });
                broadcast({ kind: "bot", bot: patched });
                return json(res, 201, { context, message: surface === "remote" ? publicMobileMessage(marker, visibleRemoteBotIds()) : marker });
            });
        }
        m = path.match(/^\/api\/bots\/([\w-]+)\/messages$/);
        if (m && method === "POST") {
            const botId = m[1];
            return await botResourceGate.run(botId, async () => {
                const bot = store.bot(botId);
                if (!bot || (surface === "remote" && bot.hidden))
                    return json(res, 404, { error: "no such bot" });
                const body = await readBody(req);
                if (store.bot(botId) !== bot || !isCanonicalBotOperation(bot)) {
                    return json(res, 409, { error: "the bot is being deleted" });
                }
                const text = secretCatalog.redactText(String(body.text ?? "").trim());
                if (!text)
                    return json(res, 400, { error: "text required" });
                if (surface === "remote" && body.budget !== undefined)
                    return json(res, 403, { error: "task budgets can only be configured locally" });
                if (body.track === false && body.budget !== undefined)
                    return json(res, 400, { error: "untracked messages cannot have a task budget" });
                const budget = parseTaskBudget(body.budget);
                const attachmentIds = Array.isArray(body.attachmentIds) ? body.attachmentIds.map(String).slice(0, 10) : [];
                const attachments = workspace.attachmentsFor(botId, attachmentIds);
                if (bot.busy && body.track !== false) {
                    const queued = workspace.queuedMessageTasks(botId);
                    if (queued.length >= 25)
                        return json(res, 429, { error: "this bot already has 25 queued messages" });
                    const task = workspace.createTask({
                        botId,
                        prompt: text,
                        source: "message",
                        attachmentIds: attachments.map((attachment) => attachment.id),
                        budget,
                    });
                    try {
                        const message = store.appendDetachedMessage(bot.threadId, {
                            role: "user",
                            kind: "text",
                            text,
                            delivery: "queued",
                            ...(attachments.length ? { attachments: attachments.map(publicAttachment) } : {}),
                        });
                        workspace.bindQueuedMessage(task.id, message.id);
                        broadcast({ kind: "message", threadId: bot.threadId, message });
                        broadcastWorkspace();
                        return json(res, 202, { ok: true, queued: true, taskId: task.id, message });
                    }
                    catch (error) {
                        workspace.settleQueuedTask(task.id, "failed");
                        throw error;
                    }
                }
                await startTurn(botId, text, { attachments, track: body.track !== false, budget });
                return json(res, 202, { ok: true, queued: false });
            });
        }
        m = path.match(/^\/api\/bots\/([\w-]+)\/messages\/([\w-]+)\/edit$/);
        if (m && method === "POST") {
            const botId = m[1];
            const messageId = m[2];
            return await botResourceGate.run(botId, async () => {
                const bot = store.bot(botId);
                if (!bot || (surface === "remote" && bot.hidden))
                    return json(res, 404, { error: "no such bot" });
                const body = await readBody(req);
                if (store.bot(botId) !== bot || !isCanonicalBotOperation(bot)) {
                    return json(res, 409, { error: "the bot is being deleted" });
                }
                if (bot.busy)
                    return json(res, 409, { error: "stop the bot before editing a message" });
                const text = String(body.text ?? "").trim();
                if (!text)
                    return json(res, 400, { error: "text required" });
                const source = store.messagesFor(bot.threadId).find((message) => message.id === messageId);
                if (!source || source.role !== "user" || source.kind !== "text") {
                    return json(res, 404, { error: "only user text messages can be edited" });
                }
                if (!registry.get(bot.modelSelection.instanceId)) {
                    return json(res, 409, { error: "provider unavailable" });
                }
                // Mark old provider sessions unusable before changing the transcript.
                // If the thread write fails, a harmless replay remains safer than
                // resuming a session whose branch is uncertain.
                store.patchBot(bot.id, { rewound: true, resumeCursors: {} });
                const message = store.branchMessage(bot.threadId, messageId, text);
                if (!message)
                    return json(res, 404, { error: "no such message" });
                const attachmentIds = message.attachments?.map((attachment) => attachment.id) ?? [];
                const attachments = workspace.attachmentsFor(bot.id, attachmentIds);
                broadcast({ kind: "message", threadId: bot.threadId, message });
                await startTurn(bot.id, text, { attachments, userMessage: message });
                return json(res, 202, { ok: true, message, activeLeafId: message.id });
            });
        }
        m = path.match(/^\/api\/bots\/([\w-]+)\/active-branch$/);
        if (m && method === "POST") {
            const botId = m[1];
            return await botResourceGate.run(botId, async () => {
                const bot = store.bot(botId);
                if (!bot || (surface === "remote" && bot.hidden))
                    return json(res, 404, { error: "no such bot" });
                const body = await readBody(req);
                if (store.bot(botId) !== bot || !isCanonicalBotOperation(bot)) {
                    return json(res, 409, { error: "the bot is being deleted" });
                }
                if (bot.busy)
                    return json(res, 409, { error: "stop the bot before switching message versions" });
                const messageId = String(body.messageId ?? "");
                if (!store.messagesFor(bot.threadId).some((message) => message.id === messageId)) {
                    return json(res, 404, { error: "no such message" });
                }
                store.patchBot(bot.id, { rewound: true, resumeCursors: {} });
                const activeLeafId = store.setActiveLeaf(bot.threadId, messageId);
                if (!activeLeafId)
                    return json(res, 404, { error: "no such message" });
                broadcast({ kind: "thread", threadId: bot.threadId, activeLeafId });
                return json(res, 200, { activeLeafId });
            });
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
                if (surface !== "local") {
                    return json(res, 403, { error: "durable approval rules can only be managed locally" });
                }
                if (!["allow", "deny"].includes(body.rememberPolicy)) {
                    return json(res, 400, { error: "unknown approval policy" });
                }
                if (body.rememberPolicy !== body.behavior) {
                    return json(res, 400, { error: "remembered policy must match the current decision" });
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
                let rememberedPolicy;
                let rememberWarning;
                if (body.rememberPolicy !== undefined) {
                    const scope = deriveApprovalScope(requestMessage.card.tool ?? "", requestMessage.card.subtitle);
                    const result = rememberApprovalAfterSettlement(approvalRules, bot.id, scope, body.rememberPolicy);
                    const remembered = result.rule;
                    rememberedPolicy = result.remembered;
                    rememberWarning = result.warning;
                    try {
                        const boundary = remembered ? approvalBoundary(remembered) : null;
                        const note = store.appendMessage(bot.threadId, {
                            role: "bot",
                            kind: "activity",
                            tool: {
                                name: remembered
                                    ? `Saved ${remembered.decision} rule for ${boundary}.`
                                    : rememberWarning,
                                ok: Boolean(remembered),
                            },
                        });
                        broadcast({ kind: "message", threadId: bot.threadId, message: note });
                    }
                    catch {
                        rememberWarning = rememberWarning ?? "The action was settled, but its local approval audit could not be saved.";
                    }
                }
                return json(res, 200, {
                    ok: true,
                    ...(rememberedPolicy !== undefined ? { remembered: rememberedPolicy } : {}),
                    ...(rememberWarning ? { warning: rememberWarning } : {}),
                });
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
            resetPathCache();
            return json(res, 200, { instances: await registry.describe() });
        }
        // ── privacy and data-flow inventory (same-host UI only) ──
        // The response is assembled exclusively from fixed copy and booleans. It
        // never serializes provider configuration, paths, prompts or identities.
        if (method === "GET" && path === "/api/privacy/data-flows") {
            if (surface !== "local")
                return json(res, 403, { error: "privacy inventory is local-only" });
            res.setHeader("cache-control", "no-store");
            resetPathCache();
            const [providerSnapshots, vm] = await Promise.all([registry.describe(), localVmStatus()]);
            const devices = pairing.list();
            return json(res, 200, buildPrivacyInventory({
                providerConfigs: persistedInstanceConfigs(cfg),
                providerSnapshots,
                boxConfigured: Boolean(cfg.box?.token),
                composioConfigured: Boolean(cfg.composio?.key || cfg.composio?.apiKey),
                expoPushEnabled: devices.some((device) => !device.revokedAt && device.pushEnabled),
                pairedMobileEnabled: devices.some((device) => !device.revokedAt),
                pairedMobileAvailable: Boolean(REMOTE),
                remoteScreenPreviewEnabled: REMOTE_SCREEN_PREVIEW,
                localMcpAvailable: mcpRegistry.list().length > 0,
                localMcpEnabled: mcpRegistry.list().some((server) => server.enabled),
                localVmAvailable: vm.daemonUp,
                localVmEnabled: vm.ready,
            }));
        }
        // ── optional Cua Local VM (local host only) ──
        if (method === "GET" && path === "/api/local-vm") {
            if (surface !== "local")
                return json(res, 403, { error: "Local VM management is local-only" });
            const status = await localVmStatus();
            return json(res, 200, { ...status, commands: localVmSetupCommands(status.runtime) });
        }
        m = path.match(/^\/api\/local-vm\/(pull|run|start|stop|remove)$/);
        if (m && method === "POST") {
            if (surface !== "local")
                return json(res, 403, { error: "Local VM management is local-only" });
            if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
                return json(res, 415, { error: "content-type must be application/json" });
            }
            const action = m[1];
            if (localVmLifecycleBusy)
                return json(res, 409, { error: "another Local VM setup action is still running" });
            if (computerLeases.owner("vm") && ["run", "stop", "remove"].includes(action)) {
                return json(res, 409, { error: "the Local VM is being used by an agent — stop that turn first" });
            }
            localVmLifecycleBusy = true;
            try {
                const status = await localVmAction(action);
                return json(res, 200, { ...status, commands: localVmSetupCommands(status.runtime) });
            }
            finally {
                localVmLifecycleBusy = false;
            }
        }
        if (method === "POST" && path === "/api/local-vm/screenshot") {
            if (surface !== "local")
                return json(res, 403, { error: "Local VM management is local-only" });
            return json(res, 200, { image: await localVmScreenshot() });
        }
        // ── fail-closed persistence diagnostics (same-host UI only) ─────
        if (path === "/api/persistence/issues" && method === "GET") {
            if (surface !== "local")
                return json(res, 403, { error: "persistence diagnostics are local-only" });
            return json(res, 200, { issues: publicPersistenceIssues() });
        }
        m = path.match(/^\/api\/persistence\/issues\/(persistence-[a-f0-9]{20})\/reset$/);
        if (m && method === "POST") {
            if (surface !== "local")
                return json(res, 403, { error: "persistence recovery is local-only" });
            const body = await readBody(req);
            if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => key !== "confirmation") || typeof body.confirmation !== "string") {
                return json(res, 400, { error: "exact filename confirmation is required" });
            }
            if (maintenanceMode || store.bots.some((bot) => bot.busy) || activeRunByThread.size || activeProviderTurnByThread.size || dispatchingRoutines || sweepingTemporaryBots) {
                return json(res, 409, { error: "stop active agents before recovering persistence" });
            }
            maintenanceMode = true;
            try {
                const recovered = resetPersistenceIssue(m[1], body.confirmation);
                return json(res, 200, { ...recovered, restartRequired: true });
            }
            finally {
                maintenanceMode = false;
            }
        }
        // ── portable backup + atomic restore (same-host UI only) ─────────
        // Credential registries, paired devices and provider/browser sessions are
        // deliberately outside this archive. The paired-mobile allowlist never
        // exposes these administrative endpoints.
        if (method === "GET" && path === "/api/backup/export") {
            if (surface !== "local")
                return json(res, 403, { error: "backup export is local-only" });
            if (maintenanceMode || store.bots.some((bot) => bot.busy) || activeRunByThread.size || dispatchingRoutines || sweepingTemporaryBots) {
                return json(res, 409, { error: "wait for active agents and maintenance work to finish before exporting" });
            }
            const botId = url.searchParams.get("botId")?.trim();
            maintenanceMode = true;
            try {
                const exported = await backupService.export(botId ? { kind: "agent", botId } : { kind: "full" });
                const stamp = exported.manifest.createdAt.replace(/[:.]/g, "-");
                res.writeHead(200, {
                    ...SECURITY_HEADERS,
                    "content-type": "application/zip",
                    "content-length": String(exported.bytes.length),
                    "content-disposition": `attachment; filename="cumea-${botId ? `agent-${botId}-` : ""}${stamp}.zip"`,
                    "cache-control": "no-store",
                });
                return res.end(exported.bytes);
            }
            finally {
                maintenanceMode = false;
                for (const bot of store.bots)
                    scheduleNextQueuedTurn(bot.id);
            }
        }
        if (method === "POST" && (path === "/api/backup/inspect" || path === "/api/backup/restore")) {
            if (surface !== "local")
                return json(res, 403, { error: "backup restore is local-only" });
            if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/zip")) {
                return json(res, 415, { error: "content-type must be application/zip" });
            }
            const archive = await readBytes(req, BACKUP_MAX_ARCHIVE_BYTES, "backup archive");
            const dryRun = path === "/api/backup/inspect" || url.searchParams.get("dryRun") === "1";
            if (dryRun) {
                const inspected = await backupService.restore(archive, { dryRun: true });
                return json(res, 200, inspected);
            }
            if (req.headers["x-cumea-restore-confirm"] !== "replace") {
                return json(res, 400, { error: "restore confirmation header is required" });
            }
            if (maintenanceMode || store.bots.some((bot) => bot.busy) || activeRunByThread.size || activeProviderTurnByThread.size ||
                dispatchingRoutines || sweepingTemporaryBots || localVmLifecycleBusy)
                return json(res, 409, { error: "stop active agents and maintenance work before restoring" });
            maintenanceMode = true;
            const oldBots = store.bots.map((bot) => ({ id: bot.id, threadId: bot.threadId }));
            for (const timer of queuedTurnTimers.values())
                clearTimeout(timer);
            queuedTurnTimers.clear();
            for (const bot of oldBots)
                stopScreenPoller(bot.id);
            fileCapabilities.clear();
            try {
                // No provider turn is active; flush the last bounded diagnostics now
                // so no pending write can recreate excluded event history after swap.
                bus.flushLog();
                const restored = await backupService.restore(archive, {
                    reload: () => {
                        store.reloadFromDisk();
                        workspace.reloadFromDisk();
                        skillRegistry.reload();
                        assertBotSkillAssignments();
                        // Approval rules are intentionally excluded from portable
                        // backups. Reload the host-local file copied into staging; rules
                        // for restored identities are revoked immediately after swap.
                        approvalRules.reload();
                        Object.assign(cfg, loadConfig());
                        refreshSecretCatalog();
                    },
                });
                for (const restoredBotId of restored.manifest.scope.botIds)
                    approvalRules.revokeBot(restoredBotId);
                for (const bot of oldBots)
                    if (!store.bot(bot.id))
                        broadcast({ kind: "bot.deleted", botId: bot.id }, { remoteDeletedBotWasVisible: true });
                for (const bot of store.bots)
                    broadcast({ kind: "bot", bot });
                broadcastWorkspace();
                broadcast({ kind: "config", ...configStatus() });
                return json(res, 200, {
                    ...restored,
                    // The host path is intentionally not exposed through HTTP.
                    preRestoreBackup: restored.preRestoreBackup ? basename(restored.preRestoreBackup) : undefined,
                });
            }
            finally {
                maintenanceMode = false;
                for (const bot of store.bots)
                    scheduleNextQueuedTurn(bot.id);
            }
        }
        // ── assigned local MCP servers (stdio only, secrets write-only) ──
        if (path === "/api/mcp-servers" && method === "GET") {
            if (surface !== "local")
                return json(res, 403, { error: "MCP server management is local-only" });
            return json(res, 200, { servers: mcpRegistry.list() });
        }
        if (path === "/api/mcp-servers" && method === "POST") {
            if (surface !== "local")
                return json(res, 403, { error: "MCP server management is local-only" });
            const server = mcpRegistry.create(await readBody(req));
            refreshSecretCatalog();
            return json(res, 201, { server });
        }
        m = path.match(/^\/api\/mcp-servers\/(mcp-[a-f0-9]{20})$/);
        if (m && method === "PUT") {
            if (surface !== "local")
                return json(res, 403, { error: "MCP server management is local-only" });
            const server = mcpRegistry.update(m[1], await readBody(req));
            if (server)
                refreshSecretCatalog();
            return server ? json(res, 200, { server }) : json(res, 404, { error: "no such MCP server" });
        }
        if (m && method === "DELETE") {
            if (surface !== "local")
                return json(res, 403, { error: "MCP server management is local-only" });
            if (store.bots.some((bot) => bot.mcpServerIds?.includes(m[1]))) {
                return json(res, 409, { error: "Unassign this MCP server from every agent before deleting it." });
            }
            const deleted = mcpRegistry.delete(m[1]);
            if (deleted)
                refreshSecretCatalog();
            return deleted ? json(res, 200, { ok: true }) : json(res, 404, { error: "no such MCP server" });
        }
        // ── local subscription/CLI harness profiles (ACP over stdio) ──
        // This is intentionally absent from the paired-mobile allowlist. A profile
        // can execute a local binary, so only the same-origin host UI may manage it.
        if (method === "GET" && path === "/api/acp-profiles") {
            if (surface !== "local")
                return json(res, 403, { error: "ACP profiles are local-only" });
            return json(res, 200, { profiles: listCustomAcpProfiles() });
        }
        if (method === "POST" && path === "/api/acp-profiles") {
            if (surface !== "local")
                return json(res, 403, { error: "ACP profiles are local-only" });
            const profile = decodeCustomAcpProfileInput(await readBody(req));
            const instances = persistedInstanceConfigs(cfg);
            let id;
            do
                id = `acp-${randomBytes(10).toString("hex")}`;
            while (instances[id]);
            instances[id] = customAcpInstance(profile);
            await persistCustomAcpInstances(instances);
            return json(res, 201, { profile: publicCustomAcpProfile(id, instances[id]) });
        }
        m = path.match(/^\/api\/acp-profiles\/([\w-]+)$/);
        if (m && method === "PUT") {
            if (surface !== "local")
                return json(res, 403, { error: "ACP profiles are local-only" });
            const instances = persistedInstanceConfigs(cfg);
            const current = instances[m[1]];
            if (!current || current.driver !== CUSTOM_ACP_DRIVER_KIND)
                return json(res, 404, { error: "no such ACP profile" });
            const profile = decodeCustomAcpProfileInput(await readBody(req));
            instances[m[1]] = customAcpInstance(profile);
            await persistCustomAcpInstances(instances);
            return json(res, 200, { profile: publicCustomAcpProfile(m[1], instances[m[1]]) });
        }
        if (m && method === "DELETE") {
            if (surface !== "local")
                return json(res, 403, { error: "ACP profiles are local-only" });
            const instances = persistedInstanceConfigs(cfg);
            const current = instances[m[1]];
            if (!current || current.driver !== CUSTOM_ACP_DRIVER_KIND)
                return json(res, 404, { error: "no such ACP profile" });
            if (store.bots.some((bot) => bot.modelSelection.instanceId === m[1])) {
                return json(res, 409, { error: "Move bots to another model before deleting this ACP profile." });
            }
            delete instances[m[1]];
            await persistCustomAcpInstances(instances);
            return json(res, 200, { ok: true });
        }
        // ── app config (API keys — never echoed back, booleans only) ──
        if (method === "GET" && path === "/api/config") {
            return json(res, 200, configStatus());
        }
        if ((method === "PUT" || method === "PATCH") && path === "/api/config") {
            if (surface !== "local")
                return json(res, 403, { error: "App configuration is local-only" });
            const body = await readBody(req);
            const patch = {};
            for (const key of ["xai", "composio", "box", "profile"]) {
                if (body[key] && typeof body[key] === "object")
                    patch[key] = body[key];
            }
            if (patch.profile)
                patch.profile = secretCatalog.redactValue(patch.profile);
            if (!Object.keys(patch).length)
                return json(res, 400, { error: "nothing to save" });
            if (Object.prototype.hasOwnProperty.call(patch, "box")) {
                const requested = patch.box;
                const nextBox = {};
                if (Object.prototype.hasOwnProperty.call(requested, "token")) {
                    if (typeof requested.token !== "string")
                        return json(res, 400, { error: "A Box API token is required" });
                    const verification = await box.verifyBoxToken(requested.token);
                    if (!verification.ok) {
                        return json(res, verification.status, { error: verification.message, code: verification.code });
                    }
                    nextBox.token = requested.token.trim();
                }
                if (Object.prototype.hasOwnProperty.call(requested, "autoSleepMinutes")) {
                    const minutes = requested.autoSleepMinutes;
                    if (minutes !== false && (!Number.isInteger(minutes) || Number(minutes) < 1 || Number(minutes) > 1_440)) {
                        return json(res, 400, { error: "Box auto-sleep must be off or between 1 and 1440 minutes" });
                    }
                    nextBox.autoSleepMinutes = minutes;
                }
                if (!Object.keys(nextBox).length)
                    return json(res, 400, { error: "A Box token or auto-sleep setting is required" });
                patch.box = nextBox;
            }
            saveConfig(patch);
            Object.assign(cfg, loadConfig());
            if (Object.prototype.hasOwnProperty.call(patch, "box")) {
                boxIdleSleep.reconcile(store.bots.filter((bot) => bot.computer === "cloud").map((bot) => bot.id));
            }
            refreshSecretCatalog();
            // provider keys change the fleet; a profile edit must not kill
            // in-flight turns with a pointless reload
            const providerConfigChanged = Object.prototype.hasOwnProperty.call(patch, "xai") ||
                Object.prototype.hasOwnProperty.call(patch, "composio") ||
                (Object.prototype.hasOwnProperty.call(patch, "box") && Object.prototype.hasOwnProperty.call(patch.box, "token"));
            if (providerConfigChanged)
                await reloadProviders();
            const status = configStatus();
            broadcast({ kind: "config", ...status });
            return json(res, 200, status);
        }
        // ── connectors (Composio) ──
        if (method === "GET" && path === "/api/connectors/catalog") {
            const { cards, source } = await composio.listToolkits(cfg);
            return json(res, 200, secretCatalog.redactValue({ configured: Boolean(cfg.composio?.key), source, cards }));
        }
        if (method === "GET" && path === "/api/connectors") {
            const services = (url.searchParams.get("services") ?? "").split(",").filter(Boolean);
            if (!cfg.composio?.key)
                return json(res, 200, { configured: false, services: {} });
            const status = await composio.connectionStatus(cfg, services.length ? services : composio.CURATED_SLUGS);
            return json(res, 200, secretCatalog.redactValue({ configured: true, services: status }));
        }
        m = path.match(/^\/api\/connectors\/([\w-]+)\/authorize$/);
        if (m && method === "POST")
            return json(res, 200, secretCatalog.redactValue(await composio.authorizeService(cfg, m[1])));
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
                return json(res, 200, {
                    ...status,
                    ...(surface === "local" ? { autoSleep: boxIdleSleep.status(bot.id) } : {}),
                });
            });
        }
        m = path.match(/^\/api\/bots\/([\w-]+)\/computer\/(provision|join|sleep|exec|screenshot)$/);
        if (m && method === "POST") {
            const botId = m[1];
            const bot = store.bot(botId);
            if (!bot)
                return json(res, 404, { error: "no such bot" });
            if (m[2] === "provision") {
                if (bot.computer === "cloud")
                    boxIdleSleep.touch(bot.id);
                await boxIdleSleep.waitForPendingSleep(bot.id);
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
                            console.warn("cloud computer cleanup warning during late provisioning");
                        }
                    }
                    else
                        await archiveBotComputerForDeletion(bot.id, "late provisioning");
                };
                try {
                    if (!isCanonicalBotOperation(bot, operation))
                        throw Object.assign(new Error("the bot is being deleted"), { status: 409 });
                    const result = await box.provisionBox(cfg, bot.id, bot.name);
                    if (bot.computer === "cloud")
                        boxIdleSleep.touch(bot.id);
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
            if (m[2] === "sleep") {
                boxIdleSleep.beginManualSleep(bot.id);
                try {
                    const result = await botResourceGate.run(bot.id, async () => {
                        if (store.bot(bot.id) !== bot || !isCanonicalBotOperation(bot)) {
                            throw Object.assign(new Error("the bot is being deleted"), { status: 409 });
                        }
                        return await box.sleepBox(cfg, bot.id);
                    });
                    if (store.bot(bot.id) !== bot || !isCanonicalBotOperation(bot)) {
                        boxIdleSleep.cancel(bot.id);
                        throw Object.assign(new Error("the bot is being deleted"), { status: 409 });
                    }
                    boxIdleSleep.markManualSleepResult(bot.id, true);
                    return json(res, 200, { ...result, autoSleep: boxIdleSleep.status(bot.id) });
                }
                catch (error) {
                    if (store.bot(bot.id) === bot && isCanonicalBotOperation(bot))
                        boxIdleSleep.markManualSleepResult(bot.id, false);
                    else
                        boxIdleSleep.cancel(bot.id);
                    throw error;
                }
            }
            if (bot.computer === "cloud")
                boxIdleSleep.touch(bot.id);
            await boxIdleSleep.waitForPendingSleep(bot.id);
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
                    : m[2] === "exec"
                        ? await box.execOnBox(cfg, bot.id, String(body?.command ?? ""))
                        : await box.screenshotBox(cfg, bot.id);
                // DELETE cannot enter while this active lease is held. Still resolve
                // ownership after the provider await before returning URLs/output/png.
                if (store.bot(bot.id) !== bot || !isCanonicalBotOperation(bot)) {
                    return json(res, 409, { error: "the bot is being deleted" });
                }
                if (bot.computer === "cloud")
                    boxIdleSleep.touch(bot.id);
                return json(res, 200, { ...result, autoSleep: boxIdleSleep.status(bot.id) });
            });
        }
        // packaged app: the server serves the built UI too (window → :8799 for
        // everything, no dev proxy to die). CUMEA_STATIC_DIR is set by Electron.
        if (method === "GET" && !path.startsWith("/api/") && STATIC_DIR) {
            const candidate = decodeStaticRequestPath(req.url ?? "");
            if (!candidate)
                return json(res, 404, { error: "not found" });
            const file = readStaticFile(STATIC_DIR, candidate);
            if (file) {
                const headers = {
                    ...SECURITY_HEADERS,
                    "content-type": MIME[extname(file.canonicalPath)] ?? "application/octet-stream",
                };
                if (extname(file.canonicalPath) === ".html")
                    headers["content-security-policy"] = DOCUMENT_CSP;
                res.writeHead(200, headers);
                return res.end(file.bytes);
            }
            // A valid client-side route may fall back to the SPA. Invalid encodings
            // and traversal forms returned above never receive even index bytes.
            const fallback = readStaticFile(STATIC_DIR, "/index.html");
            if (fallback) {
                res.writeHead(200, { ...SECURITY_HEADERS, "content-type": "text/html", "content-security-policy": DOCUMENT_CSP });
                return res.end(fallback.bytes);
            }
        }
        return json(res, 404, { error: `no route: ${method} ${path}` });
    }
    catch (e) {
        const status = e?.status ?? 500;
        const message = secretCatalog.safeError(e);
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
        boxIdleSleep.shutdown();
        clearInterval(routineTimer);
        clearTimeout(initialRoutineTimer);
        clearInterval(temporaryBotTimer);
        clearTimeout(initialTemporaryBotTimer);
        clearTimeout(initialQueuedTurnTimer);
        for (const timer of queuedTurnTimers.values())
            clearTimeout(timer);
        queuedTurnTimers.clear();
        try {
            bus.flushLog();
        }
        catch (error) {
            console.error("event log shutdown flush failed");
        }
        finally {
            remoteServer?.close();
            server.close();
            void registry.disposeAll().finally(() => process.exit(0));
        }
    });
}
