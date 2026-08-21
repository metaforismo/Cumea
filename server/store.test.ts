// Store persistence contract: bots.json + messages-<threadId>.json are
// the durable record — everything here must survive a process restart
// except `busy`, which never does (no turn survives one either).
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "./config.ts";
import type { ModelSelection } from "./contracts.ts";
import { stageFilesForDeletion } from "./delete-files.ts";
import { parseBotAvatar, Store, type BotRecord } from "./store.ts";
import { sweepTemporaryBots } from "./temporary-bots.ts";

const selection = (): ModelSelection => ({ instanceId: "claude", model: "claude-sonnet-5" });

describe("Store", () => {
  beforeEach(() => {
    rmSync(DATA_DIR, { recursive: true, force: true });
  });

  it("createBot seeds a greeting and an onboarding card", () => {
    const store = new Store(selection);
    const bot = store.createBot();

    const messages = store.messagesFor(bot.threadId);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: "bot", kind: "text" });
    expect(messages[1].kind).toBe("options");
    expect(messages[1].card?.options.length).toBeGreaterThan(1);
    expect(bot.modelSelection).toEqual(selection());
    expect(bot).toMatchObject({ appsEnabled: true, collaborationEnabled: true });
    expect(bot).not.toHaveProperty("approvalPolicy");
    expect(bot.avatar).toMatchObject({ kind: "mote", shapeId: "orb", motion: "playful" });
  });

  it("rotates colors across created bots", () => {
    const store = new Store(selection);
    const first = store.createBot();
    const second = store.createBot();
    expect(first.color).not.toBe(second.color);
  });

  it("migrates legacy global approval authority to ask with no durable grant", () => {
    const first = new Store(selection);
    const bot = first.createBot();
    const botsPath = join(DATA_DIR, "bots.json");
    const rows = JSON.parse(readFileSync(botsPath, "utf8"));
    rows[0].approvalPolicy = "allow";
    writeFileSync(botsPath, JSON.stringify(rows));

    const migrated = new Store(selection).bot(bot.id)!;
    expect(migrated).not.toHaveProperty("approvalPolicy");
    expect(readFileSync(botsPath, "utf8")).not.toContain("approvalPolicy");
  });

  it("keeps the Coordinator role exclusive and collaboration-enabled across restart", () => {
    const store = new Store(selection);
    const first = store.createBot();
    const second = store.createBot();

    store.patchBot(first.id, { coordinator: true, collaborationEnabled: false });
    expect(store.bot(first.id)).toMatchObject({ coordinator: true, collaborationEnabled: true });

    store.patchBot(second.id, { coordinator: true });
    expect(store.bot(first.id)).not.toHaveProperty("coordinator");
    expect(store.bot(second.id)).toMatchObject({ coordinator: true, collaborationEnabled: true });

    const reloaded = new Store(selection);
    expect(reloaded.bots.filter((bot) => bot.coordinator === true)).toHaveLength(1);
    expect(reloaded.bot(second.id)).toMatchObject({ coordinator: true, collaborationEnabled: true });
  });

  it("persists bots and messages across a restart, resetting busy", () => {
    const store = new Store(selection);
    const bot = store.createBot();
    store.patchBot(bot.id, {
      name: "Testy",
      busy: true,
      avatar: { kind: "mote", shapeId: "ripple", color: "#7651d6", motion: "kinetic" },
    });
    store.appendMessage(bot.threadId, { role: "user", kind: "text", text: "hi there" });

    const reloaded = new Store(selection);
    const back = reloaded.bot(bot.id)!;
    expect(back.name).toBe("Testy");
    expect(back.busy).toBe(false);
    expect(back.avatar).toEqual({ kind: "mote", shapeId: "ripple", color: "#7651d6", motion: "kinetic" });
    const messages = reloaded.messagesFor(bot.threadId);
    expect(messages.at(-1)).toMatchObject({ role: "user", text: "hi there" });
  });

  it("migrates legacy flat transcripts into one durable parent chain", () => {
    const store = new Store(selection);
    const bot = store.createBot();
    const file = join(DATA_DIR, `messages-${bot.threadId}.json`);
    const legacy = [
      { id: "legacy-1", at: 1, role: "user", kind: "text", text: "one" },
      { id: "legacy-2", at: 2, role: "bot", kind: "text", text: "two" },
      { id: "legacy-3", at: 3, role: "user", kind: "text", text: "three" },
    ];
    writeFileSync(file, JSON.stringify(legacy));

    const reloaded = new Store(selection);
    expect(reloaded.activePath(bot.threadId).map((message) => [message.id, message.parentId])).toEqual([
      ["legacy-1", null],
      ["legacy-2", "legacy-1"],
      ["legacy-3", "legacy-2"],
    ]);
    reloaded.appendMessage(bot.threadId, { role: "bot", kind: "text", text: "four" });
    const persisted = JSON.parse(readFileSync(file, "utf8"));
    expect(persisted).toMatchObject({ activeLeafId: expect.any(String), messages: expect.any(Array) });
    expect(persisted.messages.at(-1).parentId).toBe("legacy-3");
  });

  it("creates sibling edits and switches complete visible branches across restart", () => {
    const store = new Store(selection);
    const bot = store.createBot();
    const original = store.appendMessage(bot.threadId, { role: "user", kind: "text", text: "Original" });
    const originalReply = store.appendMessage(bot.threadId, { role: "bot", kind: "text", text: "Original reply" });
    const edited = store.branchMessage(bot.threadId, original.id, "Edited");
    expect(edited).not.toBeNull();
    const editedReply = store.appendMessage(bot.threadId, { role: "bot", kind: "text", text: "Edited reply" });

    expect(store.activePath(bot.threadId).map((message) => message.id)).toEqual([
      ...store.activePath(bot.threadId).slice(0, -2).map((message) => message.id),
      edited!.id,
      editedReply.id,
    ]);
    expect(store.setActiveLeaf(bot.threadId, original.id)).toBe(originalReply.id);
    expect(store.activePath(bot.threadId).at(-2)?.id).toBe(original.id);
    expect(store.activePath(bot.threadId).at(-1)?.id).toBe(originalReply.id);

    const reloaded = new Store(selection);
    expect(reloaded.activeLeaf(bot.threadId)).toBe(originalReply.id);
    expect(reloaded.messagesFor(bot.threadId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: edited!.id, parentId: original.parentId, text: "Edited" }),
      expect.objectContaining({ id: editedReply.id, parentId: edited!.id }),
    ]));
  });

  it("does not let an append caller splice an arbitrary parent into the active branch", () => {
    const store = new Store(selection);
    const bot = store.createBot();
    const active = store.appendMessage(bot.threadId, { role: "user", kind: "text", text: "Active" });
    const appended = store.appendMessage(bot.threadId, {
      role: "bot",
      kind: "text",
      text: "Reply",
      parentId: "attacker-selected-parent",
    });

    expect(appended.parentId).toBe(active.id);
    expect(store.activePath(bot.threadId).at(-1)?.id).toBe(appended.id);
  });

  it("keeps queued messages detached until their turn begins", () => {
    const store = new Store(selection);
    const bot = store.createBot();
    const before = store.activeLeaf(bot.threadId);
    const queued = store.appendDetachedMessage(bot.threadId, {
      role: "user",
      kind: "text",
      text: "Do this next",
      delivery: "queued",
    });
    expect(store.activeLeaf(bot.threadId)).toBe(before);
    expect(store.activePath(bot.threadId).some((message) => message.id === queued.id)).toBe(false);

    const currentReply = store.appendMessage(bot.threadId, { role: "bot", kind: "text", text: "Current work finished" });
    const dispatched = store.patchMessage(bot.threadId, queued.id, {
      parentId: store.activeLeaf(bot.threadId),
      delivery: "sent",
    })!;
    store.setActiveLeaf(bot.threadId, dispatched.id);

    expect(store.activePath(bot.threadId).slice(-2).map((message) => message.id)).toEqual([currentReply.id, queued.id]);
  });

  it("persists temporary lifecycle across restart and converts atomically to permanent", () => {
    const expiresAt = Date.now() + 60_000;
    const store = new Store(selection);
    const bot = store.createBot({ lifecycle: { kind: "temporary", expiresAt } });

    expect(new Store(selection).bot(bot.id)?.lifecycle).toEqual({ kind: "temporary", expiresAt });
    expect(store.setBotLifecycle(bot.id, null)?.lifecycle).toBeUndefined();

    const raw: BotRecord[] = JSON.parse(readFileSync(join(DATA_DIR, "bots.json"), "utf8"));
    expect(raw.find((candidate) => candidate.id === bot.id)).not.toHaveProperty("lifecycle");
    expect(new Store(selection).bot(bot.id)?.lifecycle).toBeUndefined();
  });

  it("keeps the temporary deadline in memory and on disk when conversion cannot persist", () => {
    const lifecycle = { kind: "temporary" as const, expiresAt: Date.now() + 60_000 };
    const store = new Store(selection);
    const bot = store.createBot({ lifecycle });
    const botsFile = join(DATA_DIR, "bots.json");
    const backup = join(DATA_DIR, "bots-backup.json");
    renameSync(botsFile, backup);
    mkdirSync(botsFile);

    expect(() => store.setBotLifecycle(bot.id, null)).toThrow();
    expect(store.bot(bot.id)?.lifecycle).toEqual(lifecycle);

    rmSync(botsFile, { recursive: true });
    renameSync(backup, botsFile);
    expect(new Store(selection).bot(bot.id)?.lifecycle).toEqual(lifecycle);
  });

  it("remains eligible for cleanup after a restart once its durable TTL is due", async () => {
    const expiresAt = Date.now() + 1_000;
    const store = new Store(selection);
    const bot = store.createBot({ lifecycle: { kind: "temporary", expiresAt } });
    const reloaded = new Store(selection);

    const result = await sweepTemporaryBots({
      bots: () => reloaded.bots,
      workspace: () => ({ tasks: [], runs: [], routines: [] }),
      messagesFor: (threadId) => reloaded.messagesFor(threadId),
      hasActiveTurn: () => false,
      isPendingRequest: () => false,
      deleteBot: (botId) => { reloaded.deleteBot(botId); },
      now: expiresAt,
    });

    expect(result).toMatchObject({ removed: [bot.id], skipped: [], failed: [] });
    expect(new Store(selection).bot(bot.id)).toBeNull();
  });

  it("fails malformed lifecycle metadata safe as permanent during migration", () => {
    const store = new Store(selection);
    const bot = store.createBot();
    const file = join(DATA_DIR, "bots.json");
    const raw: Array<Omit<BotRecord, "lifecycle"> & { lifecycle?: unknown }> = JSON.parse(readFileSync(file, "utf8"));
    raw[0].lifecycle = { kind: "temporary", expiresAt: "soon" };
    writeFileSync(file, JSON.stringify(raw));

    expect(new Store(selection).bot(bot.id)?.lifecycle).toBeUndefined();
    expect(JSON.parse(readFileSync(file, "utf8"))[0]).not.toHaveProperty("lifecycle");
  });

  it("patchMessage merges card patches and returns null for unknown ids", () => {
    const store = new Store(selection);
    const bot = store.createBot();
    const card = store.messagesFor(bot.threadId)[1];

    const patched = store.patchMessage(bot.threadId, card.id, {
      card: { ...card.card!, answered: "Work & projects" },
    });
    expect(patched?.card?.answered).toBe("Work & projects");
    expect(store.patchMessage(bot.threadId, "nope", {})).toBeNull();
  });

  it("deleteBot removes the bot and its transcript file", () => {
    const store = new Store(selection);
    const bot = store.createBot();
    const file = join(DATA_DIR, `messages-${bot.threadId}.json`);
    expect(existsSync(file)).toBe(true);

    expect(store.deleteBot(bot.id)).toBe(true);
    expect(store.bot(bot.id)).toBeNull();
    expect(existsSync(file)).toBe(false);
    expect(store.deleteBot(bot.id)).toBe(false);
  });

  it("keeps the bot when its transcript cannot be unlinked", () => {
    const store = new Store(selection);
    const bot = store.createBot();
    const file = join(DATA_DIR, `messages-${bot.threadId}.json`);
    rmSync(file);
    mkdirSync(file);

    expect(() => store.deleteBot(bot.id)).toThrow(/could not stage bot transcript/);
    expect(store.bot(bot.id)).toEqual(expect.objectContaining({ id: bot.id }));
    expect(new Store(selection).bot(bot.id)).toEqual(expect.objectContaining({ id: bot.id }));

    rmSync(file, { recursive: true });
    expect(store.deleteBot(bot.id)).toBe(true);
  });

  it("restores the in-memory bot record when bots.json cannot be committed", () => {
    const store = new Store(selection);
    const bot = store.createBot();
    const botsFile = join(DATA_DIR, "bots.json");
    const backup = join(DATA_DIR, "bots-backup.json");
    renameSync(botsFile, backup);
    mkdirSync(botsFile);

    expect(() => store.deleteBot(bot.id)).toThrow();
    expect(store.bot(bot.id)).toEqual(expect.objectContaining({ id: bot.id }));
    expect(existsSync(join(DATA_DIR, `messages-${bot.threadId}.json`))).toBe(true);

    rmSync(botsFile, { recursive: true });
    renameSync(backup, botsFile);
    expect(store.deleteBot(bot.id)).toBe(true);
  });

  it("restores bot metadata and transcript when quarantine cleanup fails", () => {
    const store = new Store(selection);
    const bot = store.createBot();
    const transcript = join(DATA_DIR, `messages-${bot.threadId}.json`);
    const staged = stageFilesForDeletion(store.botDeletionFiles(bot.id), {
      unlink() {
        throw Object.assign(new Error("blocked cleanup"), { code: "EACCES" });
      },
    });
    const transaction = store.deleteBotRecordTransaction(bot.id)!;

    expect(() => staged.purge()).toThrow(/could not finalize bot file deletion/);
    transaction.rollback();
    staged.rollback();

    expect(store.bot(bot.id)).toEqual(expect.objectContaining({ id: bot.id }));
    expect(new Store(selection).bot(bot.id)).toEqual(expect.objectContaining({ id: bot.id }));
    expect(existsSync(transcript)).toBe(true);
  });

  it("setResumeCursor persists per-instance continuations", () => {
    const store = new Store(selection);
    const bot = store.createBot();
    store.setResumeCursor(bot.id, "claude", "sess-abc");
    store.setResumeCursor(bot.id, "codex", "thread-xyz");

    const reloaded = new Store(selection);
    expect(reloaded.bot(bot.id)?.resumeCursors).toEqual({ claude: "sess-abc", codex: "thread-xyz" });
  });

  it("seedIfEmpty creates exactly one starter bot, once", () => {
    const store = new Store(selection);
    store.seedIfEmpty();
    expect(store.bots).toHaveLength(1);
    store.seedIfEmpty();
    expect(store.bots).toHaveLength(1);

    const reloaded = new Store(selection);
    reloaded.seedIfEmpty();
    expect(reloaded.bots).toHaveLength(1);
  });

  it("tolerates a corrupt bots.json by starting empty", () => {
    const store = new Store(selection);
    store.createBot();
    writeFileSync(join(DATA_DIR, "bots.json"), "{not json");

    const reloaded = new Store(selection);
    expect(reloaded.bots).toEqual([]);
  });

  it("busy is wiped even when bots.json says otherwise", () => {
    const store = new Store(selection);
    const bot = store.createBot();
    const raw: BotRecord[] = JSON.parse(readFileSync(join(DATA_DIR, "bots.json"), "utf8"));
    raw.find((b) => b.id === bot.id)!.busy = true;
    writeFileSync(join(DATA_DIR, "bots.json"), JSON.stringify(raw));

    const reloaded = new Store(selection);
    expect(reloaded.bot(bot.id)?.busy).toBe(false);
  });

  it("migrates pre-avatar bot records to durable Mote configs", () => {
    const store = new Store(selection);
    const bot = store.createBot();
    const file = join(DATA_DIR, "bots.json");
    const raw: Array<Partial<BotRecord>> = JSON.parse(readFileSync(file, "utf8"));
    delete raw[0].avatar;
    raw[0].color = "blue";
    writeFileSync(file, JSON.stringify(raw));

    const reloaded = new Store(selection);
    expect(reloaded.bot(bot.id)?.avatar).toEqual({
      kind: "mote",
      shapeId: "orb",
      color: "#2f8de3",
      motion: "playful",
    });
    expect(JSON.parse(readFileSync(file, "utf8"))[0].avatar).toBeTruthy();
  });

  it("accepts safe raster avatar data and rejects malformed or SVG payloads", () => {
    expect(parseBotAvatar({
      kind: "upload",
      shapeId: "drop",
      color: "#F56A16",
      motion: "calm",
      imageDataUrl: "data:image/png;base64,aA==",
    })).toEqual({
      kind: "upload",
      shapeId: "drop",
      color: "#f56a16",
      motion: "calm",
      imageDataUrl: "data:image/png;base64,aA==",
    });
    expect(parseBotAvatar({
      kind: "upload",
      shapeId: "drop",
      color: "#f56a16",
      motion: "calm",
      imageDataUrl: "data:image/svg+xml;base64,PHN2Zz4=",
    })).toBeNull();
    expect(parseBotAvatar({ kind: "mote", shapeId: "unknown", color: "#f56a16", motion: "calm" })).toBeNull();
  });
});
