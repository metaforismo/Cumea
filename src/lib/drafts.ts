const STORAGE_KEY = "cumea.composer-drafts.v1";
const MAX_DRAFT_CHARS = 100_000;
const MAX_DRAFTS = 200;

interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function safeId(value: string): string | null {
  const id = value.trim();
  return id && id.length <= 160 && /^[\w-]+$/.test(id) ? id : null;
}

export function parseComposerDrafts(raw: string | null): Record<string, string> {
  if (!raw || raw.length > 20_000_000) return {};
  try {
    const candidate = JSON.parse(raw);
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return {};
    const entries = Object.entries(candidate as Record<string, unknown>)
      .filter(([id, text]) => safeId(id) && typeof text === "string" && text.length <= MAX_DRAFT_CHARS)
      .slice(-MAX_DRAFTS);
    return Object.fromEntries(entries) as Record<string, string>;
  } catch {
    return {};
  }
}

export function updateComposerDrafts(
  current: Record<string, string>,
  botId: string,
  text: string,
): Record<string, string> {
  const id = safeId(botId);
  if (!id) return current;
  const next = { ...current };
  if (text && text.length <= MAX_DRAFT_CHARS) next[id] = text;
  else delete next[id];
  const entries = Object.entries(next);
  return entries.length <= MAX_DRAFTS ? next : Object.fromEntries(entries.slice(-MAX_DRAFTS));
}

function browserStorage(): DraftStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readComposerDraft(botId: string, storage = browserStorage()): string {
  if (!storage) return "";
  try {
    return parseComposerDrafts(storage.getItem(STORAGE_KEY))[safeId(botId) ?? ""] ?? "";
  } catch {
    return "";
  }
}

export function writeComposerDraft(botId: string, text: string, storage = browserStorage()): void {
  if (!storage) return;
  try {
    const next = updateComposerDrafts(parseComposerDrafts(storage.getItem(STORAGE_KEY)), botId, text);
    if (Object.keys(next).length) storage.setItem(STORAGE_KEY, JSON.stringify(next));
    else storage.removeItem(STORAGE_KEY);
  } catch {
    // Draft persistence is best-effort. A quota or privacy mode must never
    // block typing or sending a message.
  }
}
