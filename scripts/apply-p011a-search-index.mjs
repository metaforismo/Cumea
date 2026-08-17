import { readFileSync, writeFileSync } from "node:fs";

function edit(path, transform) {
  const before = readFileSync(path, "utf8");
  const after = transform(before);
  if (after === before) throw new Error(`${path}: transform made no changes`);
  writeFileSync(path, after);
}

function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0 || first !== source.lastIndexOf(needle)) {
    throw new Error(`${label}: expected exactly one match`);
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + needle.length)}`;
}

edit("server/message-search-index.ts", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    `export class MessageSearchIndex {\n`,
    `export const MESSAGE_SEARCH_DB_PATH = join(DATA_DIR, "message-search.sqlite");\n\nexport class MessageSearchIndex {\n`,
    "search DB path export",
  );
  source = replaceOnce(
    source,
    `  constructor(path = join(DATA_DIR, "message-search.sqlite")) {\n`,
    `  constructor(path = MESSAGE_SEARCH_DB_PATH) {\n`,
    "search DB default path",
  );
  return source;
});

edit("server/store.ts", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    `import { readFileSync, mkdirSync } from "node:fs";\n`,
    `import { existsSync, readFileSync, mkdirSync } from "node:fs";\n`,
    "store existsSync import",
  );
  source = replaceOnce(
    source,
    `import { writeFileAtomic } from "./atomic.ts";\n`,
    `import { writeFileAtomic } from "./atomic.ts";\nimport {\n  MESSAGE_SEARCH_DB_PATH,\n  MessageSearchIndex,\n  type TranscriptSearchResult,\n} from "./message-search-index.ts";\n`,
    "store search import",
  );
  source = replaceOnce(
    source,
    `  private messages = new Map<string, Message[]>();\n  private defaultSelection: () => ModelSelection;\n`,
    `  private messages = new Map<string, Message[]>();\n  private defaultSelection: () => ModelSelection;\n  private messageSearch: MessageSearchIndex | null = null;\n  private messageSearchHasResidualData = false;\n`,
    "store search fields",
  );
  source = replaceOnce(
    source,
    `    if (migrated) this.saveBots();\n  }\n\n  private saveBots() {\n`,
    `    if (migrated) this.saveBots();\n    try {\n      this.messageSearch = new MessageSearchIndex();\n      this.messageSearch.seedLegacy(this.bots);\n      this.messageSearchHasResidualData = false;\n    } catch (error) {\n      this.messageSearch = null;\n      this.messageSearchHasResidualData = existsSync(MESSAGE_SEARCH_DB_PATH);\n      console.warn(\n        "[message-search] local transcript search is unavailable:",\n        error instanceof Error ? error.message : String(error),\n      );\n    }\n  }\n\n  private disableMessageSearch(error: unknown) {\n    console.warn(\n      "[message-search] disabling derived transcript search:",\n      error instanceof Error ? error.message : String(error),\n    );\n    this.messageSearchHasResidualData = existsSync(MESSAGE_SEARCH_DB_PATH);\n    try { this.messageSearch?.close(); } catch {}\n    this.messageSearch = null;\n  }\n\n  private indexMessage(threadId: string, message: Message) {\n    if (!this.messageSearch) return;\n    try {\n      this.messageSearch.upsert(threadId, message);\n    } catch (error) {\n      this.disableMessageSearch(error);\n    }\n  }\n\n  private saveBots() {\n`,
    "store search initialization",
  );
  source = replaceOnce(
    source,
    `    list.push(full);\n    writeFileAtomic(messagesFile(threadId), JSON.stringify(list, null, 2));\n    return full;\n`,
    `    list.push(full);\n    writeFileAtomic(messagesFile(threadId), JSON.stringify(list, null, 2));\n    this.indexMessage(threadId, full);\n    return full;\n`,
    "append index update",
  );
  source = replaceOnce(
    source,
    `    list[idx] = { ...list[idx], ...patch, card: patch.card ?? list[idx].card };\n    writeFileAtomic(messagesFile(threadId), JSON.stringify(list, null, 2));\n    return list[idx];\n`,
    `    list[idx] = { ...list[idx], ...patch, card: patch.card ?? list[idx].card };\n    writeFileAtomic(messagesFile(threadId), JSON.stringify(list, null, 2));\n    this.indexMessage(threadId, list[idx]);\n    return list[idx];\n`,
    "patch index update",
  );
  source = replaceOnce(
    source,
    `  /** Metadata phase used after the outer transaction quarantines every file. */\n  deleteBotRecordTransaction(id: string): BotRecordDeletionTransaction | null {\n    const bot = this.bot(id);\n    if (!bot) return null;\n    const previousBots = this.bots;\n    this.bots = previousBots.filter((candidate) => candidate.id !== id);\n    try {\n      this.saveBots();\n    } catch (error) {\n      this.bots = previousBots;\n      throw error;\n    }\n\n    let settled = false;\n    return {\n      rollback: () => {\n        if (settled) return;\n        this.bots = previousBots;\n        try {\n          this.saveBots();\n          settled = true;\n        } catch (error) {\n          // Keep the retry anchor visible in the live store even when the\n          // durable rollback itself is blocked.\n          throw Object.assign(new Error("could not restore bot record after deletion failed"), {\n            status: 500,\n            cause: error,\n          });\n        }\n      },\n      finalize: () => {\n        if (settled) return;\n        this.messages.delete(bot.threadId);\n        settled = true;\n      },\n    };\n  }\n`,
    `  /** Metadata phase used after the outer transaction quarantines every file. */\n  deleteBotRecordTransaction(id: string): BotRecordDeletionTransaction | null {\n    const bot = this.bot(id);\n    if (!bot) return null;\n    if (!this.messageSearch && this.messageSearchHasResidualData) {\n      throw Object.assign(\n        new Error("local transcript search index is unavailable; indexed transcript deletion cannot be guaranteed"),\n        { status: 500 },\n      );\n    }\n    const transcriptSnapshot = [...this.messagesFor(bot.threadId)];\n    if (this.messageSearch) {\n      try {\n        this.messageSearch.deleteThread(bot.threadId);\n      } catch (error) {\n        throw Object.assign(new Error("could not remove transcript from local search index"), {\n          status: 500,\n          cause: error,\n        });\n      }\n    }\n\n    const restoreSearch = () => {\n      if (!this.messageSearch) return;\n      try {\n        this.messageSearch.replaceThread(bot.threadId, transcriptSnapshot);\n      } catch (error) {\n        this.disableMessageSearch(error);\n      }\n    };\n\n    const previousBots = this.bots;\n    this.bots = previousBots.filter((candidate) => candidate.id !== id);\n    try {\n      this.saveBots();\n    } catch (error) {\n      this.bots = previousBots;\n      restoreSearch();\n      throw error;\n    }\n\n    let settled = false;\n    return {\n      rollback: () => {\n        if (settled) return;\n        this.bots = previousBots;\n        try {\n          this.saveBots();\n          restoreSearch();\n          settled = true;\n        } catch (error) {\n          // Keep the retry anchor visible in the live store even when the\n          // durable rollback itself is blocked. The search index is derived;\n          // canonical transcript bytes remain in the quarantined JSON file.\n          throw Object.assign(new Error("could not restore bot record after deletion failed"), {\n            status: 500,\n            cause: error,\n          });\n        }\n      },\n      finalize: () => {\n        if (settled) return;\n        this.messages.delete(bot.threadId);\n        settled = true;\n      },\n    };\n  }\n\n  searchMessages(query: string, limit?: number): TranscriptSearchResult & {\n    hits: Array<TranscriptSearchResult["hits"][number] & { botId: string; botName: string }>;\n  } {\n    if (!this.messageSearch) return { available: false, mode: "unavailable", hits: [] };\n    try {\n      const result = this.messageSearch.search(query, limit);\n      return {\n        ...result,\n        hits: result.hits.flatMap((hit) => {\n          const bot = this.botByThread(hit.threadId);\n          return bot && !bot.hidden ? [{ ...hit, botId: bot.id, botName: bot.name }] : [];\n        }),\n      };\n    } catch (error) {\n      if ((error as { status?: unknown })?.status === 400) throw error;\n      this.disableMessageSearch(error);\n      return { available: false, mode: "unavailable", hits: [] };\n    }\n  }\n`,
    "delete/search integration",
  );
  for (const invariant of [
    "new MessageSearchIndex()",
    "this.indexMessage(threadId, full)",
    "indexed transcript deletion cannot be guaranteed",
    "searchMessages(query: string",
  ]) {
    if (!source.includes(invariant)) throw new Error(`missing store search invariant: ${invariant}`);
  }
  return source;
});

edit("server/index.ts", (input) => {
  let source = input;
  const marker = `    // ── atomic desktop startup snapshot ───────────────────────────────\n`;
  const route = `    // ── local transcript search ──────────────────────────────────────\n    if (method === "GET" && path === "/api/search/messages") {\n      if (surface !== "local") return json(res, 403, { error: "transcript search is local-only" });\n      const query = url.searchParams.get("q") ?? "";\n      const rawLimit = url.searchParams.get("limit");\n      const limit = rawLimit === null ? undefined : Number(rawLimit);\n      return json(res, 200, store.searchMessages(query, limit));\n    }\n\n`;
  source = replaceOnce(source, marker, `${route}${marker}`, "search API route");
  if (!source.includes('path === "/api/search/messages"')) throw new Error("search route missing");
  return source;
});
