// Bot + thread persistence. bots.json holds bot records (including the
// thread→instance binding and per-instance resume cursors — upstream's
// ProviderSessionDirectory, recipe step 6: persist the binding from day
// one). messages-<threadId>.json holds the folded transcript.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./config.js";
import { purgeCommittedFileDeletions, stageFilesForDeletion, } from "./delete-files.js";
import { writeFileAtomic } from "./atomic.js";
import { newId } from "./contracts.js";
import { assertPersistenceWritable, loadPersistentJson } from "./persistence-health.js";
import { SKILL_MAX_ASSIGNMENTS, validateSkillAssignment } from "./skill-registry.js";
export const MOTE_SHAPE_IDS = ["orb", "soft", "tile", "capsule", "peak", "gem", "ripple", "drop"];
const MOTE_MOTION_LEVELS = new Set(["calm", "playful", "kinetic"]);
const MOTE_SHAPE_SET = new Set(MOTE_SHAPE_IDS);
const RASTER_DATA_URL = /^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/]+={0,2}$/;
/** Strict public boundary for avatar JSON received over HTTP or read from disk. */
export function parseBotAvatar(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
    const candidate = value;
    if (candidate.kind !== "mote" && candidate.kind !== "upload")
        return null;
    if (typeof candidate.shapeId !== "string" || !MOTE_SHAPE_SET.has(candidate.shapeId))
        return null;
    if (typeof candidate.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(candidate.color))
        return null;
    if (typeof candidate.motion !== "string" || !MOTE_MOTION_LEVELS.has(candidate.motion))
        return null;
    const base = {
        kind: candidate.kind,
        shapeId: candidate.shapeId,
        color: candidate.color.toLowerCase(),
        motion: candidate.motion,
    };
    if (candidate.kind === "upload") {
        if (typeof candidate.imageDataUrl !== "string" ||
            candidate.imageDataUrl.length > 720_000 ||
            !RASTER_DATA_URL.test(candidate.imageDataUrl))
            return null;
        base.imageDataUrl = candidate.imageDataUrl;
    }
    return base;
}
/** Validate lifecycle JSON read from disk or received through a trusted
 * internal boundary. Expired timestamps remain valid: the sweeper, not store
 * migration, owns deletion and its activity/audit safety checks. */
export function parseBotLifecycle(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
    const candidate = value;
    if (candidate.kind !== "temporary")
        return null;
    if (!Number.isSafeInteger(candidate.expiresAt) || Number(candidate.expiresAt) <= 0)
        return null;
    return { kind: "temporary", expiresAt: Number(candidate.expiresAt) };
}
const BOTS_FILE = join(DATA_DIR, "bots.json");
const messagesFile = (threadId) => join(DATA_DIR, `messages-${threadId}.json`);
const COLORS = [
    "green",
    "blue",
    "red",
    "orange",
    "purple",
    "cyan",
    "pink",
    "yellow",
    "teal",
    "coral",
];
const LEGACY_MOTE_COLORS = {
    green: "#19ae7a",
    blue: "#2f8de3",
    red: "#dc2944",
    orange: "#f56a16",
    purple: "#7651d6",
    cyan: "#16a79d",
    pink: "#d72879",
    yellow: "#ee9e18",
    teal: "#16a79d",
    coral: "#f56a16",
};
function defaultBotAvatar(index, color) {
    return {
        kind: "mote",
        shapeId: MOTE_SHAPE_IDS[index % MOTE_SHAPE_IDS.length],
        color: LEGACY_MOTE_COLORS[color],
        motion: index % 3 === 0 ? "playful" : index % 3 === 1 ? "calm" : "kinetic",
    };
}
/** Resolve @mentions in a message against a bot roster: `@` must start a
 * word, names match case-insensitively, longest name wins (so "@New Bot 2"
 * never half-matches "New Bot"), hidden bots skipped, results deduped.
 * Callers pre-filter the sender out of `peers`. */
export function mentionedBots(text, peers) {
    const candidates = peers
        .filter((p) => !p.hidden && p.name.trim())
        .sort((a, b) => b.name.length - a.name.length);
    const lower = text.toLowerCase();
    const found = [];
    let at = -1;
    while ((at = lower.indexOf("@", at + 1)) !== -1) {
        if (at > 0 && !/\s/.test(text[at - 1]))
            continue; // user@host, not a tag
        const rest = lower.slice(at + 1);
        const hit = candidates.find((p) => {
            const name = p.name.toLowerCase();
            if (!rest.startsWith(name))
                return false;
            const next = rest.slice(name.length, name.length + 1);
            return !next || !/[\p{L}\p{N}_]/u.test(next);
        });
        if (hit && !found.includes(hit))
            found.push(hit);
    }
    return found;
}
const onboardingCard = () => ({
    title: "What do you mostly want help with?",
    subtitle: "Pick whatever's closest; we can always expand from there.",
    options: ["Work & projects", "Writing & research", "Life admin", "A bit of everything"],
});
export class Store {
    bots = [];
    threads = new Map();
    defaultSelection;
    sanitizeMessage;
    constructor(defaultSelection, sanitizeMessage = (message) => message) {
        this.defaultSelection = defaultSelection;
        this.sanitizeMessage = sanitizeMessage;
        this.reloadFromDisk();
    }
    /** Reopen the durable roster after an atomic backup restore.
     * Callers must hold the server-wide maintenance gate so cached transcript
     * state cannot race an active turn while it is discarded. */
    reloadFromDisk() {
        mkdirSync(DATA_DIR, { recursive: true });
        this.threads.clear();
        this.bots = loadPersistentJson(BOTS_FILE, {
            label: "Agent roster", missing: () => [], resetValue: [], maxBytes: 8 * 1024 * 1024,
            validate: (value) => {
                if (!Array.isArray(value) || value.length > 1_000)
                    throw new Error("invalid agent roster schema");
                const seen = new Set();
                for (const row of value) {
                    if (!row || typeof row !== "object" || Array.isArray(row) || typeof row.id !== "string" || typeof row.threadId !== "string" || seen.has(row.id)) {
                        throw new Error("invalid agent roster schema");
                    }
                    const assignments = row.skillAssignments;
                    if (assignments !== undefined) {
                        if (!Array.isArray(assignments) || assignments.length > SKILL_MAX_ASSIGNMENTS)
                            throw new Error("invalid agent skill assignments");
                        const decoded = assignments.map((assignment) => validateSkillAssignment(assignment));
                        if (new Set(decoded.map((assignment) => assignment.id)).size !== decoded.length)
                            throw new Error("duplicate agent skill assignments");
                    }
                    seen.add(row.id);
                }
                return value;
            },
        });
        // busy never survives a restart — no turn does either. Old bot records
        // are upgraded in place so every renderer receives a durable Mote config.
        let migrated = false;
        let coordinatorSeen = false;
        for (const [index, b] of this.bots.entries()) {
            b.busy = false;
            if (Object.prototype.hasOwnProperty.call(b, "approvalPolicy")) {
                // Legacy allow/deny covered the bot's entire permission surface. It
                // cannot be translated to a least-privilege key without guessing.
                delete b.approvalPolicy;
                migrated = true;
            }
            const avatar = parseBotAvatar(b.avatar);
            if (avatar) {
                b.avatar = avatar;
            }
            else {
                const legacyColor = COLORS.includes(b.color) ? b.color : COLORS[index % COLORS.length];
                b.color = legacyColor;
                b.avatar = defaultBotAvatar(index, legacyColor);
                migrated = true;
            }
            if (Object.prototype.hasOwnProperty.call(b, "lifecycle")) {
                const lifecycle = parseBotLifecycle(b.lifecycle);
                if (lifecycle) {
                    b.lifecycle = lifecycle;
                }
                else {
                    // Malformed lifecycle metadata must fail safe as permanent. Store
                    // migration never guesses a deletion deadline.
                    delete b.lifecycle;
                    migrated = true;
                }
            }
            if (b.coordinator === true && !coordinatorSeen) {
                coordinatorSeen = true;
                if (b.collaborationEnabled !== true) {
                    b.collaborationEnabled = true;
                    migrated = true;
                }
            }
            else if (Object.prototype.hasOwnProperty.call(b, "coordinator")) {
                // Canonical storage omits false, malformed and duplicate roles. The
                // first row wins because bots are already ordered newest-first.
                delete b.coordinator;
                migrated = true;
            }
        }
        if (migrated)
            this.saveBots();
    }
    saveBots() {
        assertPersistenceWritable(BOTS_FILE);
        writeFileAtomic(BOTS_FILE, JSON.stringify(this.bots, null, 2));
    }
    thread(threadId) {
        const cached = this.threads.get(threadId);
        if (cached)
            return cached;
        const path = messagesFile(threadId);
        const raw = loadPersistentJson(path, {
            label: `Transcript ${threadId}`, missing: () => [], resetValue: { messages: [], activeLeafId: null }, maxBytes: 64 * 1024 * 1024,
            validate: (value) => {
                const container = value && typeof value === "object" && !Array.isArray(value) ? value : null;
                const rows = Array.isArray(value) ? value : container?.messages;
                if (!Array.isArray(rows) || rows.length > 50_000 || rows.some((row) => !row || typeof row !== "object" || Array.isArray(row) || typeof row.id !== "string")) {
                    throw new Error("invalid transcript schema");
                }
                return value;
            },
        });
        const container = raw && typeof raw === "object" && !Array.isArray(raw)
            ? raw
            : null;
        const input = Array.isArray(raw) ? raw : Array.isArray(container?.messages) ? container.messages : [];
        const messages = input.filter((candidate) => Boolean(candidate && typeof candidate === "object" && typeof candidate.id === "string"));
        const ids = new Set(messages.map((message) => message.id));
        let previous = null;
        for (const message of messages) {
            // Legacy arrays were a single chain. Existing tree rows fail closed to
            // a root if their parent is malformed or no longer exists.
            if (message.parentId === undefined)
                message.parentId = previous;
            else if (message.parentId !== null && (!ids.has(message.parentId) || message.parentId === message.id))
                message.parentId = null;
            previous = message.id;
        }
        const requestedLeaf = typeof container?.activeLeafId === "string" ? container.activeLeafId : null;
        const state = {
            messages,
            activeLeafId: requestedLeaf && ids.has(requestedLeaf) ? requestedLeaf : messages.at(-1)?.id ?? null,
        };
        this.threads.set(threadId, state);
        return state;
    }
    saveThread(threadId) {
        const thread = this.thread(threadId);
        const path = messagesFile(threadId);
        assertPersistenceWritable(path);
        writeFileAtomic(path, JSON.stringify(thread, null, 2));
    }
    /** Every durable branch, in creation order. Use activePath for provider
     * context and ordinary conversation rendering. */
    messagesFor(threadId) {
        return this.thread(threadId).messages;
    }
    activeLeaf(threadId) {
        return this.thread(threadId).activeLeafId;
    }
    /** The visible root-to-leaf path. Corrupt/cyclic legacy data is bounded by
     * the visited set rather than hanging the host. */
    activePath(threadId) {
        const thread = this.thread(threadId);
        const byId = new Map(thread.messages.map((message) => [message.id, message]));
        const path = [];
        const visited = new Set();
        let current = thread.activeLeafId ? byId.get(thread.activeLeafId) : undefined;
        while (current && !visited.has(current.id)) {
            visited.add(current.id);
            path.push(current);
            current = current.parentId ? byId.get(current.parentId) : undefined;
        }
        return path.reverse();
    }
    appendMessage(threadId, message) {
        const thread = this.thread(threadId);
        const previousLeaf = thread.activeLeafId;
        // Callers may preserve an explicit timestamp for migrations/tests, but
        // they must not be able to splice arbitrary parents into the tree.
        const full = this.sanitizeMessage({
            ...message,
            id: newId(),
            at: message.at ?? Date.now(),
            parentId: thread.activeLeafId,
        });
        thread.messages.push(full);
        thread.activeLeafId = full.id;
        try {
            this.saveThread(threadId);
        }
        catch (error) {
            thread.messages.pop();
            thread.activeLeafId = previousLeaf;
            throw error;
        }
        return full;
    }
    /** Persist queued work without changing the active conversation branch.
     * It is attached to the then-current leaf only when dispatch begins, so
     * output from the in-flight turn cannot become a reply to future work. */
    appendDetachedMessage(threadId, message) {
        const thread = this.thread(threadId);
        const full = this.sanitizeMessage({
            ...message,
            id: newId(),
            at: message.at ?? Date.now(),
            parentId: thread.activeLeafId,
        });
        thread.messages.push(full);
        try {
            this.saveThread(threadId);
        }
        catch (error) {
            thread.messages.pop();
            throw error;
        }
        return full;
    }
    /** Create a sibling replacement for a user text message. Attachments stay
     * attached to the replacement so editing prose never silently drops the
     * files that were part of that turn. */
    branchMessage(threadId, sourceId, text) {
        const thread = this.thread(threadId);
        const source = thread.messages.find((message) => message.id === sourceId);
        if (!source || source.role !== "user" || source.kind !== "text")
            return null;
        const full = this.sanitizeMessage({
            id: newId(),
            parentId: source.parentId ?? null,
            at: Date.now(),
            role: "user",
            kind: "text",
            text,
            ...(source.attachments?.length ? { attachments: source.attachments.map((attachment) => ({ ...attachment })) } : {}),
        });
        thread.messages.push(full);
        const previousLeaf = thread.activeLeafId;
        thread.activeLeafId = full.id;
        try {
            this.saveThread(threadId);
        }
        catch (error) {
            thread.messages.pop();
            thread.activeLeafId = previousLeaf;
            throw error;
        }
        return full;
    }
    /** Activate the selected version and its newest descendant. */
    setActiveLeaf(threadId, messageId) {
        const thread = this.thread(threadId);
        if (!thread.messages.some((message) => message.id === messageId))
            return null;
        const visited = new Set();
        let current = messageId;
        while (!visited.has(current)) {
            visited.add(current);
            const children = thread.messages.filter((message) => message.parentId === current && !visited.has(message.id));
            if (!children.length)
                break;
            current = children.reduce((latest, candidate) => candidate.at >= latest.at ? candidate : latest).id;
        }
        const previousLeaf = thread.activeLeafId;
        thread.activeLeafId = current;
        try {
            this.saveThread(threadId);
        }
        catch (error) {
            thread.activeLeafId = previousLeaf;
            throw error;
        }
        return current;
    }
    patchMessage(threadId, messageId, patch) {
        const thread = this.thread(threadId);
        const idx = thread.messages.findIndex((m) => m.id === messageId);
        if (idx === -1)
            return null;
        const previous = thread.messages[idx];
        thread.messages[idx] = this.sanitizeMessage({ ...previous, ...patch, card: patch.card ?? previous.card });
        try {
            this.saveThread(threadId);
        }
        catch (error) {
            thread.messages[idx] = previous;
            throw error;
        }
        return thread.messages[idx];
    }
    bot(id) {
        return this.bots.find((b) => b.id === id) ?? null;
    }
    botByThread(threadId) {
        return this.bots.find((b) => b.threadId === threadId) ?? null;
    }
    createBot(options = {}) {
        const color = COLORS[this.bots.length % COLORS.length];
        const bot = {
            id: newId(),
            threadId: newId(),
            name: "New Bot",
            title: "",
            description: "",
            notifications: true,
            color,
            avatar: defaultBotAvatar(this.bots.length, color),
            unread: false,
            modelSelection: this.defaultSelection(),
            resumeCursors: {},
            appsEnabled: true,
            collaborationEnabled: true,
            memoryWriteEnabled: false,
            ...(options.lifecycle ? { lifecycle: options.lifecycle } : {}),
            createdAt: Date.now(),
        };
        this.bots.unshift(bot);
        this.saveBots();
        this.appendMessage(bot.threadId, {
            role: "bot",
            kind: "text",
            text: "Hey — I'm your new bot. Nice to meet you.",
        });
        this.appendMessage(bot.threadId, { role: "bot", kind: "options", card: onboardingCard() });
        return bot;
    }
    deleteBot(id) {
        const bot = this.bot(id);
        if (!bot)
            return false;
        const files = stageFilesForDeletion(this.botDeletionFiles(id));
        let transaction = null;
        try {
            transaction = this.deleteBotRecordTransaction(id);
            if (!transaction)
                throw Object.assign(new Error("bot disappeared during deletion"), { status: 500 });
            transaction.finalize();
        }
        catch (error) {
            const rollbackErrors = [];
            try {
                transaction?.rollback();
            }
            catch (rollbackError) {
                rollbackErrors.push(rollbackError);
            }
            try {
                files.rollback();
            }
            catch (rollbackError) {
                rollbackErrors.push(rollbackError);
            }
            if (rollbackErrors.length) {
                throw Object.assign(new Error("bot deletion failed and could not be fully rolled back"), {
                    status: 500,
                    cause: new AggregateError([error, ...rollbackErrors]),
                });
            }
            throw error;
        }
        // The durable bot record is gone. Purge is post-commit garbage
        // collection: a filesystem failure may leave private quarantine bytes,
        // but must never resurrect metadata whose transcript was partly purged.
        purgeCommittedFileDeletions([files], () => console.error("could not purge committed bot transcript quarantine"));
        return true;
    }
    botDeletionFiles(id) {
        const bot = this.bot(id);
        return bot ? [{ path: messagesFile(bot.threadId), label: "transcript" }] : [];
    }
    /** Metadata phase used after the outer transaction quarantines every file. */
    deleteBotRecordTransaction(id) {
        const bot = this.bot(id);
        if (!bot)
            return null;
        const previousBots = this.bots;
        this.bots = previousBots.filter((candidate) => candidate.id !== id);
        try {
            this.saveBots();
        }
        catch (error) {
            this.bots = previousBots;
            throw error;
        }
        let settled = false;
        return {
            rollback: () => {
                if (settled)
                    return;
                this.bots = previousBots;
                try {
                    this.saveBots();
                    settled = true;
                }
                catch (error) {
                    // Keep the retry anchor visible in the live store even when the
                    // durable rollback itself is blocked.
                    throw Object.assign(new Error("could not restore bot record after deletion failed"), {
                        status: 500,
                        cause: error,
                    });
                }
            },
            finalize: () => {
                if (settled)
                    return;
                this.threads.delete(bot.threadId);
                settled = true;
            },
        };
    }
    patchBot(id, patch, options = {}) {
        const bot = this.bot(id);
        if (!bot)
            return null;
        const effectivePatch = patch.coordinator === true && patch.collaborationEnabled !== true
            ? { ...patch, collaborationEnabled: true }
            : patch;
        const touched = new Map();
        for (const key of Object.keys(effectivePatch)) {
            touched.set(key, { present: Object.prototype.hasOwnProperty.call(bot, key), value: bot[key] });
        }
        const displacedCoordinators = new Map();
        if (effectivePatch.coordinator === true) {
            for (const candidate of this.bots) {
                if (candidate !== bot && candidate.coordinator === true) {
                    displacedCoordinators.set(candidate, {
                        present: Object.prototype.hasOwnProperty.call(candidate, "coordinator"),
                        value: candidate.coordinator,
                    });
                    delete candidate.coordinator;
                }
            }
        }
        if (options.clearLifecycle && !touched.has("lifecycle")) {
            touched.set("lifecycle", {
                present: Object.prototype.hasOwnProperty.call(bot, "lifecycle"),
                value: bot.lifecycle,
            });
        }
        Object.assign(bot, effectivePatch);
        if (effectivePatch.coordinator === false)
            delete bot.coordinator;
        if (options.clearLifecycle)
            delete bot.lifecycle;
        try {
            this.saveBots();
        }
        catch (error) {
            // Keep the live store aligned with the last durable snapshot. This is
            // especially important for Keep permanently: a failed write must not
            // make the sweeper forget an expiry that is still present on disk.
            for (const [key, previous] of touched) {
                if (previous.present) {
                    Object.assign(bot, { [key]: previous.value });
                }
                else {
                    delete bot[key];
                }
            }
            for (const [candidate, previous] of displacedCoordinators) {
                if (previous.present)
                    candidate.coordinator = previous.value;
                else
                    delete candidate.coordinator;
            }
            throw error;
        }
        return bot;
    }
    /** Lifecycle mutations need deletion semantics: `undefined` must remove the
     * durable property instead of lingering as an ambiguous in-memory field. */
    setBotLifecycle(id, lifecycle) {
        return this.patchBot(id, lifecycle ? { lifecycle } : {}, { clearLifecycle: lifecycle === null });
    }
    setResumeCursor(botId, instanceId, cursor) {
        const bot = this.bot(botId);
        if (!bot)
            return;
        bot.resumeCursors[instanceId] = cursor;
        this.saveBots();
    }
    /** First-run seed: one bot so the app never opens empty. */
    seedIfEmpty() {
        if (this.bots.length)
            return;
        const bot = this.createBot();
        this.patchBot(bot.id, { name: "Guide", color: "blue" });
    }
}
