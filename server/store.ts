// Bot + thread persistence. bots.json holds bot records (including the
// thread→instance binding and per-instance resume cursors — upstream's
// ProviderSessionDirectory, recipe step 6: persist the binding from day
// one). Legacy messages-<threadId>.json remains a migration/recovery anchor;
// folded transcripts are stored incrementally in owner-local SQLite when the
// canonical backend is enabled.
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { DATA_DIR } from "./config.ts";
import { stageFilesForDeletion, type DeletionFile } from "./delete-files.ts";
import { writeFileAtomic } from "./atomic.ts";
import {
  MESSAGE_SEARCH_DB_PATH,
  MessageSearchIndex,
  canonicalFileFingerprint,
  type TranscriptSearchResult,
} from "./message-search-index.ts";
import { TranscriptStore, type TranscriptDeleteTransaction } from "./transcript-store.ts";
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
  createdAt: number;
}

const BOTS_FILE = join(DATA_DIR, "bots.json");
const messagesFile = (threadId: string) => join(DATA_DIR, `messages-${threadId}.json`);

/** A cross-store deletion has a reversible metadata prepare phase, an
 * explicit canonical commit, then outer file purge, and only finally releases
 * its rollback snapshots. */
export interface BotRecordDeletionTransaction {
  commit: () => void;
  rollback: () => void;
  finalize: () => void;
}

export interface StoreOptions {
  messageSearch?: boolean;
  transcripts?: boolean;
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
  private messageSearch: MessageSearchIndex | null = null;
  private messageSearchHasResidualData = false;
  private transcripts: TranscriptStore | null = null;

  constructor(defaultSelection: () => ModelSelection, options: StoreOptions = {}) {
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
    }
    if (migrated) this.saveBots();

    if (options.transcripts) {
      this.transcripts = new TranscriptStore();
      try {
        this.transcripts.recoverPendingDeletes(new Set(this.bots.map((bot) => bot.threadId)));
        // Establish every currently-owned canonical thread before the Store
        // advertises the cutover backend. Import is all-or-nothing per thread;
        // a malformed legacy source therefore fails startup instead of
        // silently creating a split-brain JSON/SQLite view.
        for (const bot of this.bots) this.transcripts.ensureImported(bot.threadId, messagesFile(bot.threadId));
      } catch (error) {
        try { this.transcripts.close(); } catch {}
        this.transcripts = null;
        throw error;
      }
    }

    if (options.messageSearch) {
      try {
        this.messageSearch = new MessageSearchIndex();
      } catch (error) {
        this.messageSearch = null;
        this.messageSearchHasResidualData = existsSync(MESSAGE_SEARCH_DB_PATH);
        console.warn(
          "[message-search] local transcript search is unavailable:",
          error instanceof Error ? error.message : String(error),
        );
      }

      if (this.messageSearch) {
        if (this.transcripts) {
          for (const bot of this.bots) {
            const state = this.transcripts.threadState(bot.threadId);
            if (!state) throw new Error(`canonical transcript is missing for ${bot.threadId}`);
            let matches = false;
            try {
              matches = this.messageSearch.revisionMatches(bot.threadId, state.revision);
            } catch (error) {
              this.disableMessageSearch(error);
              break;
            }
            if (matches || !this.messageSearch) continue;
            const canonicalMessages = this.transcripts.messagesFor(bot.threadId, messagesFile(bot.threadId));
            try {
              this.messageSearch.replaceThreadRevision(bot.threadId, canonicalMessages, state.revision);
            } catch (error) {
              this.disableMessageSearch(error);
              break;
            }
          }
        } else {
          try {
            this.messageSearch.seedLegacy(this.bots);
          } catch (error) {
            this.disableMessageSearch(error);
          }
        }
        if (this.messageSearch) this.messageSearchHasResidualData = false;
      }
    }
  }

  private disableMessageSearch(error: unknown) {
    console.warn(
      "[message-search] disabling derived transcript search:",
      error instanceof Error ? error.message : String(error),
    );
    this.messageSearchHasResidualData = existsSync(MESSAGE_SEARCH_DB_PATH);
    try { this.messageSearch?.close(); } catch {}
    this.messageSearch = null;
  }

  private indexMessage(threadId: string, message: Message, revision?: number) {
    if (!this.messageSearch) return;
    try {
      if (revision !== undefined) {
        this.messageSearch.upsertRevision(threadId, message, revision);
      } else {
        this.messageSearch.upsert(threadId, message, canonicalFileFingerprint(messagesFile(threadId)));
      }
    } catch (error) {
      this.disableMessageSearch(error);
    }
  }

  private saveBots() {
    writeFileAtomic(BOTS_FILE, JSON.stringify(this.bots, null, 2));
  }

  messagesFor(threadId: string): Message[] {
    let list = this.messages.get(threadId);
    if (!list) {
      if (this.transcripts) {
        list = this.transcripts.messagesFor(threadId, messagesFile(threadId));
      } else {
        try {
          list = JSON.parse(readFileSync(messagesFile(threadId), "utf8"));
        } catch {
          list = [];
        }
      }
      this.messages.set(threadId, list!);
    }
    return list!;
  }

  appendMessage(threadId: string, message: Omit<Message, "id" | "at"> & { at?: number }): Message {
    const full: Message = { id: newId(), at: Date.now(), ...message };
    const list = this.messagesFor(threadId);
    if (this.transcripts) {
      const revision = this.transcripts.append(threadId, full, messagesFile(threadId));
      list.push(full);
      this.indexMessage(threadId, full, revision);
      return full;
    }
    list.push(full);
    writeFileAtomic(messagesFile(threadId), JSON.stringify(list, null, 2));
    this.indexMessage(threadId, full);
    return full;
  }

  patchMessage(threadId: string, messageId: string, patch: Partial<Message>): Message | null {
    const list = this.messagesFor(threadId);
    const idx = list.findIndex((m) => m.id === messageId);
    if (idx === -1) return null;
    const next = { ...list[idx], ...patch, card: patch.card ?? list[idx].card };
    if (this.transcripts) {
      const revision = this.transcripts.replaceMessage(threadId, next);
      list[idx] = next;
      this.indexMessage(threadId, next, revision);
      return next;
    }
    list[idx] = next;
    writeFileAtomic(messagesFile(threadId), JSON.stringify(list, null, 2));
    this.indexMessage(threadId, next);
    return next;
  }

  bot(id: string) {
    return this.bots.find((b) => b.id === id) ?? null;
  }

  botByThread(threadId: string) {
    return this.bots.find((b) => b.threadId === threadId) ?? null;
  }

  createBot(): BotRecord {
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

    const transcriptSnapshot = [...this.messagesFor(bot.threadId)];
    const files = stageFilesForDeletion(this.botDeletionFiles(id));
    let transaction: BotRecordDeletionTransaction | null = null;
    try {
      transaction = this.deleteBotRecordTransaction(id, transcriptSnapshot);
      if (!transaction) throw Object.assign(new Error("bot disappeared during deletion"), { status: 500 });
      transaction.commit();
      files.purge();
      transaction.finalize();
      return true;
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
  }

  botDeletionFiles(id: string): DeletionFile[] {
    const bot = this.bot(id);
    // Migrated JSON is now only a recovery anchor, but user-visible deletion
    // must still remove it when present. The staging helper tolerates ENOENT
    // for new canonical-only bots.
    return bot ? [{ path: messagesFile(bot.threadId), label: "transcript" }] : [];
  }

  /** Metadata prepare phase used after the outer transaction quarantines files. */
  deleteBotRecordTransaction(
    id: string,
    transcriptSnapshot: readonly Message[] = this.messagesFor(this.bot(id)?.threadId ?? ""),
  ): BotRecordDeletionTransaction | null {
    const bot = this.bot(id);
    if (!bot) return null;
    if (!this.messageSearch && this.messageSearchHasResidualData) {
      throw Object.assign(
        new Error("local transcript search index is unavailable; indexed transcript deletion cannot be guaranteed"),
        { status: 500 },
      );
    }

    const searchSnapshot = [...transcriptSnapshot];
    const canonicalState = this.transcripts?.threadState(bot.threadId) ?? null;
    let canonicalTransaction: TranscriptDeleteTransaction | null = null;
    if (this.transcripts) {
      if (!canonicalState) {
        throw Object.assign(new Error("canonical transcript is missing during bot deletion"), { status: 500 });
      }
      canonicalTransaction = this.transcripts.stageDelete(bot.threadId);
    }

    const restoreSearch = () => {
      if (!this.messageSearch) return;
      try {
        if (canonicalState) {
          this.messageSearch.replaceThreadRevision(bot.threadId, searchSnapshot, canonicalState.revision);
        } else {
          this.messageSearch.replaceThread(
            bot.threadId,
            searchSnapshot,
            canonicalFileFingerprint(messagesFile(bot.threadId)),
          );
        }
      } catch (error) {
        this.disableMessageSearch(error);
        throw Object.assign(new Error("could not restore local transcript search after deletion failed"), {
          status: 500,
          cause: error,
        });
      }
    };

    if (this.messageSearch) {
      try {
        this.messageSearch.deleteThread(bot.threadId);
      } catch (error) {
        const rollbackErrors: unknown[] = [];
        try { canonicalTransaction?.rollback(); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
        try { restoreSearch(); } catch (restoreError) { rollbackErrors.push(restoreError); }
        if (rollbackErrors.length) {
          throw Object.assign(new Error("could not remove transcript from local search index and restore deletion state"), {
            status: 500,
            cause: new AggregateError([error, ...rollbackErrors]),
          });
        }
        throw Object.assign(new Error("could not remove transcript from local search index"), {
          status: 500,
          cause: error,
        });
      }
    }

    const previousBots = this.bots;
    this.bots = previousBots.filter((candidate) => candidate.id !== id);
    try {
      this.saveBots();
    } catch (error) {
      this.bots = previousBots;
      const rollbackErrors: unknown[] = [];
      try { canonicalTransaction?.rollback(); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
      try { restoreSearch(); } catch (restoreError) { rollbackErrors.push(restoreError); }
      if (rollbackErrors.length) {
        throw Object.assign(new Error("bot metadata deletion failed and canonical/search rollback was incomplete"), {
          status: 500,
          cause: new AggregateError([error, ...rollbackErrors]),
        });
      }
      throw error;
    }

    let canonicalCommitted = false;
    let settled = false;
    return {
      commit: () => {
        if (settled || canonicalCommitted) return;
        canonicalTransaction?.commit();
        canonicalCommitted = true;
      },
      rollback: () => {
        if (settled) return;
        const rollbackErrors: unknown[] = [];
        this.bots = previousBots;
        try { this.saveBots(); } catch (error) { rollbackErrors.push(error); }
        try { canonicalTransaction?.rollback(); } catch (error) { rollbackErrors.push(error); }
        try { restoreSearch(); } catch (error) { rollbackErrors.push(error); }
        if (rollbackErrors.length) {
          throw Object.assign(new Error("could not restore bot record after deletion failed"), {
            status: 500,
            cause: new AggregateError(rollbackErrors),
          });
        }
        settled = true;
      },
      finalize: () => {
        if (settled) return;
        if (canonicalTransaction && !canonicalCommitted) {
          throw new Error("canonical transcript deletion must commit before bot deletion finalizes");
        }
        canonicalTransaction?.finalize();
        this.messages.delete(bot.threadId);
        settled = true;
      },
    };
  }

  searchMessages(query: string, limit?: number): TranscriptSearchResult & {
    hits: Array<TranscriptSearchResult["hits"][number] & { botId: string; botName: string }>;
  } {
    if (!this.messageSearch) return { available: false, mode: "unavailable", hits: [] };
    try {
      const result = this.messageSearch.search(query, limit);
      return {
        ...result,
        hits: result.hits.flatMap((hit) => {
          const bot = this.botByThread(hit.threadId);
          return bot && !bot.hidden ? [{ ...hit, botId: bot.id, botName: bot.name }] : [];
        }),
      };
    } catch (error) {
      if ((error as { status?: unknown })?.status === 400) throw error;
      this.disableMessageSearch(error);
      return { available: false, mode: "unavailable", hits: [] };
    }
  }

  close(): void {
    try { this.messageSearch?.close(); } catch {}
    this.messageSearch = null;
    try { this.transcripts?.close(); } catch {}
    this.transcripts = null;
  }

  patchBot(id: string, patch: Partial<BotRecord>): BotRecord | null {
    const bot = this.bot(id);
    if (!bot) return null;
    Object.assign(bot, patch);
    this.saveBots();
    return bot;
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
