// Bot + thread persistence. bots.json holds bot records (including the
// thread→instance binding and per-instance resume cursors — upstream's
// ProviderSessionDirectory, recipe step 6: persist the binding from day
// one). messages-<threadId>.json holds the folded transcript.
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./config.js";
import { stageFilesForDeletion } from "./delete-files.js";
import { writeFileAtomic } from "./atomic.js";
import { newId } from "./contracts.js";
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
    messages = new Map();
    defaultSelection;
    constructor(defaultSelection) {
        this.defaultSelection = defaultSelection;
        mkdirSync(DATA_DIR, { recursive: true });
        try {
            this.bots = JSON.parse(readFileSync(BOTS_FILE, "utf8"));
        }
        catch {
            this.bots = [];
        }
        // busy never survives a restart — no turn does either. Old bot records
        // are upgraded in place so every renderer receives a durable Mote config.
        let migrated = false;
        for (const [index, b] of this.bots.entries()) {
            b.busy = false;
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
        }
        if (migrated)
            this.saveBots();
    }
    saveBots() {
        writeFileAtomic(BOTS_FILE, JSON.stringify(this.bots, null, 2));
    }
    messagesFor(threadId) {
        let list = this.messages.get(threadId);
        if (!list) {
            try {
                list = JSON.parse(readFileSync(messagesFile(threadId), "utf8"));
            }
            catch {
                list = [];
            }
            this.messages.set(threadId, list);
        }
        return list;
    }
    appendMessage(threadId, message) {
        const full = { id: newId(), at: Date.now(), ...message };
        const list = this.messagesFor(threadId);
        list.push(full);
        writeFileAtomic(messagesFile(threadId), JSON.stringify(list, null, 2));
        return full;
    }
    patchMessage(threadId, messageId, patch) {
        const list = this.messagesFor(threadId);
        const idx = list.findIndex((m) => m.id === messageId);
        if (idx === -1)
            return null;
        list[idx] = { ...list[idx], ...patch, card: patch.card ?? list[idx].card };
        writeFileAtomic(messagesFile(threadId), JSON.stringify(list, null, 2));
        return list[idx];
    }
    bot(id) {
        return this.bots.find((b) => b.id === id) ?? null;
    }
    botByThread(threadId) {
        return this.bots.find((b) => b.threadId === threadId) ?? null;
    }
    createBot() {
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
            approvalPolicy: "ask",
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
            files.purge();
            transaction.finalize();
            return true;
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
                this.messages.delete(bot.threadId);
                settled = true;
            },
        };
    }
    patchBot(id, patch) {
        const bot = this.bot(id);
        if (!bot)
            return null;
        Object.assign(bot, patch);
        this.saveBots();
        return bot;
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
