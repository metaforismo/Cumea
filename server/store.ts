// Bot + thread persistence. bots.json holds bot records (including the
// thread→instance binding and per-instance resume cursors — upstream's
// ProviderSessionDirectory, recipe step 6: persist the binding from day
// one). messages-<threadId>.json holds the folded transcript.
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { DATA_DIR } from "./config.ts";
import {
  purgeCommittedFileDeletions,
  stageFilesForDeletion,
  type DeletionFile,
} from "./delete-files.ts";
import { writeFileAtomic } from "./atomic.ts";
import { newId, type ModelSelection, type ThreadId } from "./contracts.ts";

export type CumeaColor =
  | "green"
  | "blue"
  | "red"
  | "orange"
  | "purple"
  | "cyan"
  | "pink"
  | "yellow"
  | "teal"
  | "coral";

export type CumeaExpression =
  | "deadpan"
  | "friendly"
  | "focused"
  | "thinking"
  | "excited"
  | "sleepy"
  | "surprised"
  | "skeptical"
  | "worried"
  | "mischievous";

export const MOTE_SHAPE_IDS = ["orb", "soft", "tile", "capsule", "peak", "gem", "ripple", "drop"] as const;
export type MoteShapeId = (typeof MOTE_SHAPE_IDS)[number];
export type MoteMotionLevel = "calm" | "playful" | "kinetic";

export interface BotAvatarConfig {
  kind: "mote" | "upload";
  shapeId: MoteShapeId;
  color: string;
  motion: MoteMotionLevel;
  /** Client-resized raster only. SVG is deliberately excluded. */
  imageDataUrl?: string;
}

const MOTE_MOTION_LEVELS = new Set<MoteMotionLevel>(["calm", "playful", "kinetic"]);
const MOTE_SHAPE_SET = new Set<MoteShapeId>(MOTE_SHAPE_IDS);
const RASTER_DATA_URL = /^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/]+={0,2}$/;

/** Strict public boundary for avatar JSON received over HTTP or read from disk. */
export function parseBotAvatar(value: unknown): BotAvatarConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind !== "mote" && candidate.kind !== "upload") return null;
  if (typeof candidate.shapeId !== "string" || !MOTE_SHAPE_SET.has(candidate.shapeId as MoteShapeId)) return null;
  if (typeof candidate.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(candidate.color)) return null;
  if (typeof candidate.motion !== "string" || !MOTE_MOTION_LEVELS.has(candidate.motion as MoteMotionLevel)) return null;
  const base: BotAvatarConfig = {
    kind: candidate.kind,
    shapeId: candidate.shapeId as MoteShapeId,
    color: candidate.color.toLowerCase(),
    motion: candidate.motion as MoteMotionLevel,
  };
  if (candidate.kind === "upload") {
    if (
      typeof candidate.imageDataUrl !== "string" ||
      candidate.imageDataUrl.length > 720_000 ||
      !RASTER_DATA_URL.test(candidate.imageDataUrl)
    ) return null;
    base.imageDataUrl = candidate.imageDataUrl;
  }
  return base;
}

export interface OptionCardData {
  title: string;
  subtitle: string;
  options: string[];
  answered?: string;
  dismissed?: boolean;
  /** Present when this card is a live provider ask (approval/question). */
  requestId?: string;
  requestType?: "permission" | "question";
  tool?: string;
}

export interface AttachmentRef {
  id: string;
  name: string;
  mime: string;
  size: number;
}

export interface HandoffData {
  fromBotId: string;
  fromName: string;
  toBotId: string;
  toName: string;
  prompt: string;
  status: "requested" | "completed" | "failed";
  reply?: string;
}

/** Durable lifecycle contract for intentionally ephemeral teammates.
 *
 * Absence means permanent. Keeping this as a tagged object (instead of a
 * loose boolean plus timestamp) makes future lifecycle variants additive and
 * prevents a half-written `temporary: true` record with no expiry.
 */
export interface BotLifecycle {
  kind: "temporary";
  expiresAt: number;
}

/** Validate lifecycle JSON read from disk or received through a trusted
 * internal boundary. Expired timestamps remain valid: the sweeper, not store
 * migration, owns deletion and its activity/audit safety checks. */
export function parseBotLifecycle(value: unknown): BotLifecycle | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind !== "temporary") return null;
  if (!Number.isSafeInteger(candidate.expiresAt) || Number(candidate.expiresAt) <= 0) return null;
  return { kind: "temporary", expiresAt: Number(candidate.expiresAt) };
}

export interface Message {
  id: string;
  role: "bot" | "user";
  kind: "text" | "options" | "activity" | "screen" | "handoff";
  text?: string;
  card?: OptionCardData;
  attachments?: AttachmentRef[];
  handoff?: HandoffData;
  /** activity messages: tool name + outcome */
  tool?: { name: string; ok?: boolean };
  /** screen messages: a frame of the bot's computer (base64 image) */
  png?: string;
  mime?: string;
  at: number;
}

export interface BotRecord {
  id: string;
  threadId: ThreadId;
  name: string;
  title: string;
  description: string;
  notifications: boolean;
  color: CumeaColor;
  mascotExpression?: CumeaExpression | null;
  avatar: BotAvatarConfig;
  unread: boolean;
  modelSelection: ModelSelection;
  /** provider-native continuation per instance (e.g. claude session id) */
  resumeCursors: Record<string, unknown>;
  /** which computer the bot acts on: its cloud box, this Mac (local CUA),
   * or none. Unset = auto (box when it exists, else local when available). */
  computer?: "cloud" | "local" | "off";
  /** Optional visual grouping in the sidebar. */
  sectionId?: string | null;
  /** Connected apps and peer agents are independently scoped per bot. */
  appsEnabled?: boolean;
  collaborationEnabled?: boolean;
  /** Remembered provider permission behavior for this bot. */
  approvalPolicy?: "ask" | "allow" | "deny";
  pinned?: boolean;
  hidden?: boolean;
  busy?: boolean;
  /** Absent for permanent bots. Temporary bots are removed only after this
   * deadline and only when the server's cleanup safety gate is clear. */
  lifecycle?: BotLifecycle;
  createdAt: number;
}

const BOTS_FILE = join(DATA_DIR, "bots.json");
const messagesFile = (threadId: string) => join(DATA_DIR, `messages-${threadId}.json`);

export interface BotRecordDeletionTransaction {
  rollback: () => void;
  finalize: () => void;
}

const COLORS: CumeaColor[] = [
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

const LEGACY_MOTE_COLORS: Record<CumeaColor, string> = {
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

function defaultBotAvatar(index: number, color: CumeaColor): BotAvatarConfig {
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
export function mentionedBots<T extends { name: string; hidden?: boolean }>(text: string, peers: T[]): T[] {
  const candidates = peers
    .filter((p) => !p.hidden && p.name.trim())
    .sort((a, b) => b.name.length - a.name.length);
  const lower = text.toLowerCase();
  const found: T[] = [];
  let at = -1;
  while ((at = lower.indexOf("@", at + 1)) !== -1) {
    if (at > 0 && !/\s/.test(text[at - 1])) continue; // user@host, not a tag
    const rest = lower.slice(at + 1);
    const hit = candidates.find((p) => {
      const name = p.name.toLowerCase();
      if (!rest.startsWith(name)) return false;
      const next = rest.slice(name.length, name.length + 1);
      return !next || !/[\p{L}\p{N}_]/u.test(next);
    });
    if (hit && !found.includes(hit)) found.push(hit);
  }
  return found;
}

const onboardingCard = (): OptionCardData => ({
  title: "What do you mostly want help with?",
  subtitle: "Pick whatever's closest; we can always expand from there.",
  options: ["Work & projects", "Writing & research", "Life admin", "A bit of everything"],
});

export class Store {
  bots: BotRecord[] = [];
  private messages = new Map<string, Message[]>();
  private defaultSelection: () => ModelSelection;

  constructor(defaultSelection: () => ModelSelection) {
    this.defaultSelection = defaultSelection;
    mkdirSync(DATA_DIR, { recursive: true });
    try {
      this.bots = JSON.parse(readFileSync(BOTS_FILE, "utf8"));
    } catch {
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
      } else {
        const legacyColor = COLORS.includes(b.color) ? b.color : COLORS[index % COLORS.length];
        b.color = legacyColor;
        b.avatar = defaultBotAvatar(index, legacyColor);
        migrated = true;
      }
      if (Object.prototype.hasOwnProperty.call(b, "lifecycle")) {
        const lifecycle = parseBotLifecycle(b.lifecycle);
        if (lifecycle) {
          b.lifecycle = lifecycle;
        } else {
          // Malformed lifecycle metadata must fail safe as permanent. Store
          // migration never guesses a deletion deadline.
          delete b.lifecycle;
          migrated = true;
        }
      }
    }
    if (migrated) this.saveBots();
  }

  private saveBots() {
    writeFileAtomic(BOTS_FILE, JSON.stringify(this.bots, null, 2));
  }

  messagesFor(threadId: string): Message[] {
    let list = this.messages.get(threadId);
    if (!list) {
      try {
        list = JSON.parse(readFileSync(messagesFile(threadId), "utf8"));
      } catch {
        list = [];
      }
      this.messages.set(threadId, list!);
    }
    return list!;
  }

  appendMessage(threadId: string, message: Omit<Message, "id" | "at"> & { at?: number }): Message {
    const full: Message = { id: newId(), at: Date.now(), ...message };
    const list = this.messagesFor(threadId);
    list.push(full);
    writeFileAtomic(messagesFile(threadId), JSON.stringify(list, null, 2));
    return full;
  }

  patchMessage(threadId: string, messageId: string, patch: Partial<Message>): Message | null {
    const list = this.messagesFor(threadId);
    const idx = list.findIndex((m) => m.id === messageId);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...patch, card: patch.card ?? list[idx].card };
    writeFileAtomic(messagesFile(threadId), JSON.stringify(list, null, 2));
    return list[idx];
  }

  bot(id: string) {
    return this.bots.find((b) => b.id === id) ?? null;
  }

  botByThread(threadId: string) {
    return this.bots.find((b) => b.threadId === threadId) ?? null;
  }

  createBot(options: { lifecycle?: BotLifecycle } = {}): BotRecord {
    const color = COLORS[this.bots.length % COLORS.length];
    const bot: BotRecord = {
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

  deleteBot(id: string): boolean {
    const bot = this.bot(id);
    if (!bot) return false;

    const files = stageFilesForDeletion(this.botDeletionFiles(id));
    let transaction: BotRecordDeletionTransaction | null = null;
    try {
      transaction = this.deleteBotRecordTransaction(id);
      if (!transaction) throw Object.assign(new Error("bot disappeared during deletion"), { status: 500 });
      transaction.finalize();
    } catch (error) {
      const rollbackErrors: unknown[] = [];
      try {
        transaction?.rollback();
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
      try {
        files.rollback();
      } catch (rollbackError) {
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
    purgeCommittedFileDeletions(
      [files],
      (error) => console.error("could not purge committed bot transcript quarantine", error),
    );
    return true;
  }

  botDeletionFiles(id: string): DeletionFile[] {
    const bot = this.bot(id);
    return bot ? [{ path: messagesFile(bot.threadId), label: "transcript" }] : [];
  }

  /** Metadata phase used after the outer transaction quarantines every file. */
  deleteBotRecordTransaction(id: string): BotRecordDeletionTransaction | null {
    const bot = this.bot(id);
    if (!bot) return null;
    const previousBots = this.bots;
    this.bots = previousBots.filter((candidate) => candidate.id !== id);
    try {
      this.saveBots();
    } catch (error) {
      this.bots = previousBots;
      throw error;
    }

    let settled = false;
    return {
      rollback: () => {
        if (settled) return;
        this.bots = previousBots;
        try {
          this.saveBots();
          settled = true;
        } catch (error) {
          // Keep the retry anchor visible in the live store even when the
          // durable rollback itself is blocked.
          throw Object.assign(new Error("could not restore bot record after deletion failed"), {
            status: 500,
            cause: error,
          });
        }
      },
      finalize: () => {
        if (settled) return;
        this.messages.delete(bot.threadId);
        settled = true;
      },
    };
  }

  patchBot(id: string, patch: Partial<BotRecord>, options: { clearLifecycle?: boolean } = {}): BotRecord | null {
    const bot = this.bot(id);
    if (!bot) return null;
    const touched = new Map<keyof BotRecord, { present: boolean; value: BotRecord[keyof BotRecord] }>();
    for (const key of Object.keys(patch) as Array<keyof BotRecord>) {
      touched.set(key, { present: Object.prototype.hasOwnProperty.call(bot, key), value: bot[key] });
    }
    if (options.clearLifecycle && !touched.has("lifecycle")) {
      touched.set("lifecycle", {
        present: Object.prototype.hasOwnProperty.call(bot, "lifecycle"),
        value: bot.lifecycle,
      });
    }
    Object.assign(bot, patch);
    if (options.clearLifecycle) delete bot.lifecycle;
    try {
      this.saveBots();
    } catch (error) {
      // Keep the live store aligned with the last durable snapshot. This is
      // especially important for Keep permanently: a failed write must not
      // make the sweeper forget an expiry that is still present on disk.
      for (const [key, previous] of touched) {
        if (previous.present) {
          Object.assign(bot, { [key]: previous.value });
        } else {
          delete (bot as unknown as Record<string, unknown>)[key];
        }
      }
      throw error;
    }
    return bot;
  }

  /** Lifecycle mutations need deletion semantics: `undefined` must remove the
   * durable property instead of lingering as an ambiguous in-memory field. */
  setBotLifecycle(id: string, lifecycle: BotLifecycle | null): BotRecord | null {
    return this.patchBot(id, lifecycle ? { lifecycle } : {}, { clearLifecycle: lifecycle === null });
  }

  setResumeCursor(botId: string, instanceId: string, cursor: unknown) {
    const bot = this.bot(botId);
    if (!bot) return;
    bot.resumeCursors[instanceId] = cursor;
    this.saveBots();
  }

  /** First-run seed: one bot so the app never opens empty. */
  seedIfEmpty() {
    if (this.bots.length) return;
    const bot = this.createBot();
    this.patchBot(bot.id, { name: "Guide", color: "blue" });
  }
}
