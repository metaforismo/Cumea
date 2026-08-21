import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  BellDot,
  ClipboardCopy,
  Copy,
  EyeOff,
  Folder,
  FolderPlus,
  Loader2,
  MessageSquareText,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  Trash2,
} from "lucide-react";
import { api, useStore, formatTime, type Bot } from "@/state/store";
import { CumeaAvatar, InitialsAvatar } from "./Avatar";
import { expressionForBot } from "@/lib/mascot";
import { avatarForBot, avatarStateForBot } from "@/lib/mote";
import { cn } from "@/lib/cn";
import { currentPlatformCapabilities } from "@/lib/platform-capabilities";

const { platform: electronPlatform, desktop: isElectron } = currentPlatformCapabilities();
const isMacElectron = electronPlatform === "darwin";

interface TranscriptSearchHit {
  threadId: string;
  messageId: string;
  at: number;
  role: "bot" | "user";
  kind: string;
  preview: string;
  botId: string;
  botName: string;
}

/** "Ada Lovelace" → "AL", "ada" → "A", "you@x.dev" → "Y", unset → "?" */
function profileInitials(profile?: { name?: string; email?: string }): string {
  const name = profile?.name?.trim();
  if (name) {
    const words = name.split(/\s+/);
    return words
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("");
  }
  const email = profile?.email?.trim();
  return email ? email[0]!.toUpperCase() : "?";
}

function preview(bot: Bot): string {
  if (bot.busy) return "Working…";
  const last = bot.messages[bot.messages.length - 1];
  if (!last) return "";
  if (last.kind === "options" && last.card) return last.card.title;
  if (last.kind === "activity" && last.tool) return last.tool.name;
  if (last.kind === "screen") return "Screen frame";
  return last.text ?? "";
}

interface MenuState {
  botId: string;
  x: number;
  y: number;
}

function BotContextMenu({
  menu,
  onClose,
  onMove,
  onDelete,
}: {
  menu: MenuState;
  onClose: () => void;
  onMove: (botId: string) => void;
  onDelete: (botId: string) => void;
}) {
  const { state, dispatch } = useStore();
  const bot = state.bots.find((b) => b.id === menu.botId);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-bot-menu]")) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  if (!bot) return null;
  // keep the menu on-screen near the click
  const top = Math.min(menu.y, window.innerHeight - 340);
  const left = Math.min(menu.x, window.innerWidth - 240);

  const item = (
    icon: React.ReactNode,
    label: string,
    onClick?: () => void,
    opts?: { danger?: boolean; disabled?: boolean; hint?: string },
  ) => (
    <button
      key={label}
      disabled={opts?.disabled}
      onClick={() => {
        onClick?.();
        onClose();
      }}
      title={opts?.hint}
      className={cn(
        "flex w-full items-center gap-3 px-3.5 py-2 text-left text-[14px]",
        opts?.danger ? "text-danger" : "text-ink",
        opts?.disabled ? "cursor-default opacity-40" : "hover:bg-raised/70",
      )}
    >
      {icon}
      {label}
    </button>
  );
  const divider = (key: string) => <div key={key} className="mx-2 my-1 border-t border-hairline/40" />;

  return (
    <div
      data-bot-menu
      style={{ top, left }}
      className="fixed z-40 w-[228px] overflow-hidden rounded-xl border border-hairline/50 bg-card py-1.5 shadow-2xl shadow-black/60"
    >
      {[
        item(
          bot.pinned ? <PinOff size={16} className="text-ink-secondary" /> : <Pin size={16} className="text-ink-secondary" />,
          bot.pinned ? "Unpin" : "Pin",
          () => dispatch({ type: "updateBot", botId: bot.id, patch: { pinned: !bot.pinned } }),
        ),
        item(<FolderPlus size={16} className="text-ink-secondary" />, "Move to section", () => onMove(bot.id)),
        item(<BellDot size={16} className="text-ink-secondary" />, "Mark as Unread", () =>
          dispatch({ type: "markUnread", botId: bot.id }),
        ),
        divider("d1"),
        item(<Pencil size={16} className="text-ink-secondary" />, "Edit Profile", () => {
          dispatch({ type: "select", id: bot.id });
          dispatch({ type: "toggleSettings", open: true });
        }),
        item(<Copy size={16} className="text-ink-secondary" />, "Duplicate", () =>
          dispatch({ type: "duplicateBot", botId: bot.id }),
        ),
        divider("d2"),
        item(<ClipboardCopy size={16} className="text-ink-secondary" />, "Copy conversation ID", () => {
          void navigator.clipboard?.writeText(bot.threadId);
        }),
        divider("d3"),
        item(<EyeOff size={16} className="text-ink-secondary" />, "Hide from sidebar", () =>
          dispatch({ type: "updateBot", botId: bot.id, patch: { hidden: true } }),
        ),
        item(<Trash2 size={16} />, "Delete", () => onDelete(bot.id), {
          danger: true,
        }),
      ]}
    </div>
  );
}

function DeleteBotDialog({ botId, onClose }: { botId: string; onClose: () => void }) {
  const { state, deleteBot } = useStore();
  const bot = state.bots.find((candidate) => candidate.id === botId);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  if (!bot) return null;
  const titleId = `delete-bot-title-${bot.id}`;
  const impactId = `delete-bot-impact-${bot.id}`;

  const confirmDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteBot(bot.id);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setDeleting(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={impactId}
      aria-busy={deleting}
      onCancel={(event) => {
        event.preventDefault();
        if (!deleting) onClose();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !deleting) onClose();
      }}
      className="m-auto w-[calc(100%-2.5rem)] max-w-md border-0 bg-transparent p-0 text-left backdrop:bg-black/70"
    >
      <div className="rounded-2xl border border-hairline/60 bg-panel p-5 text-ink shadow-2xl shadow-black/70">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-danger/12 text-danger">
            <Trash2 size={18} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 id={titleId} className="text-[16px] font-semibold">
              Delete “{bot.name}”?
            </h2>
            <p id={impactId} className="mt-1.5 text-[13px] leading-relaxed text-ink-secondary">
              This permanently deletes the conversation, uploaded files, routines, and task and run history for this bot.
              {bot.busy ? " Its current work will be stopped." : ""} This cannot be undone.
            </p>
          </div>
        </div>

        {error && (
          <div role="alert" className="mt-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
            Deletion didn’t complete, so {bot.name} remains available to retry. {error}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            autoFocus
            disabled={deleting}
            onClick={onClose}
            className="rounded-lg px-3.5 py-2 text-[13px] font-medium text-ink hover:bg-raised disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={() => void confirmDelete()}
            className="flex min-w-28 items-center justify-center gap-2 rounded-lg bg-danger px-3.5 py-2 text-[13px] font-semibold text-white hover:brightness-110 disabled:cursor-wait disabled:opacity-65"
          >
            {deleting && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
            {deleting ? "Deleting…" : `Delete ${bot.name}`}
          </button>
        </div>
      </div>
    </dialog>
  );
}

function MoveSectionDialog({ botId, onClose }: { botId: string; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const bot = state.bots.find((candidate) => candidate.id === botId);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!bot) return null;

  const move = (sectionId: string | null) => {
    dispatch({ type: "updateBot", botId, patch: { sectionId } });
    onClose();
  };
  const create = async () => {
    if (!name.trim()) return;
    try {
      const { section } = await api("/api/sections", {
        method: "POST",
        body: JSON.stringify({ name: name.trim() }),
      });
      move(section.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-5" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Move ${bot.name} to section`}
        className="w-full max-w-sm rounded-2xl border border-hairline/50 bg-panel p-4 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-3 text-[15px] font-semibold text-ink">Move {bot.name}</div>
        <div className="max-h-52 space-y-1 overflow-y-auto">
          <button
            onClick={() => move(null)}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[14px] text-ink hover:bg-raised"
          >
            <Folder size={15} className="text-ink-secondary" /> No section
          </button>
          {state.workspace.sections.map((section) => (
            <button
              key={section.id}
              onClick={() => move(section.id)}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[14px] text-ink hover:bg-raised"
            >
              <Folder size={15} className="text-ink-secondary" /> {section.name}
            </button>
          ))}
        </div>
        <div className="mt-3 flex gap-2 border-t border-hairline/40 pt-3">
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && void create()}
            placeholder="New section"
            className="min-w-0 flex-1 rounded-lg bg-inset px-3 py-2 text-[13px] text-ink outline-none ring-accent-border focus:ring-1"
          />
          <button onClick={() => void create()} className="rounded-lg bg-ink px-3 py-2 text-[13px] font-medium text-app">
            Create
          </button>
        </div>
        {error && <div className="mt-2 text-[12px] text-danger">{error}</div>}
      </div>
    </div>
  );
}

function BotListItem({ bot, onMenu }: { bot: Bot; onMenu: (menu: MenuState) => void }) {
  const { state, dispatch } = useStore();
  const selected = state.selectedId === bot.id;
  const mascotMotion = selected && state.mascotMotion?.botId === bot.id ? state.mascotMotion : null;
  const last = bot.messages[bot.messages.length - 1];
  return (
    <button
      onClick={() => dispatch({ type: "select", id: bot.id })}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu({ botId: bot.id, x: e.clientX, y: e.clientY });
      }}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left",
        selected ? "bg-raised" : "hover:bg-raised/50",
      )}
    >
      <CumeaAvatar
        avatar={avatarForBot(bot)}
        expression={expressionForBot(bot)}
        size={44}
        motion={mascotMotion?.kind ?? "none"}
        motionKey={mascotMotion?.nonce ?? 0}
        state={avatarStateForBot(bot)}
        label={`${bot.name} avatar`}
        ambient={selected}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5 truncate text-[15px] font-semibold text-ink">
            {bot.pinned && <Pin size={12} className="shrink-0 text-ink-secondary" />}
            <span className="truncate">{bot.name}</span>
          </span>
          {selected && last && (
            <span className="shrink-0 text-xs text-ink-secondary">
              {formatTime(last.at)}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[13px] text-ink-secondary">
            {preview(bot)}
          </span>
          {bot.unread && (
            <span className="size-2 shrink-0 rounded-full bg-accent" />
          )}
        </div>
      </div>
    </button>
  );
}

export function Sidebar() {
  const { state, dispatch } = useStore();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [moveBotId, setMoveBotId] = useState<string | null>(null);
  const [deleteBotId, setDeleteBotId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [messageHits, setMessageHits] = useState<TranscriptSearchHit[]>([]);
  const [messageSearchLoading, setMessageSearchLoading] = useState(false);
  const [messageSearchUnavailable, setMessageSearchUnavailable] = useState(false);
  const [openingMessageId, setOpeningMessageId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2) {
      setMessageHits([]);
      setMessageSearchLoading(false);
      setMessageSearchUnavailable(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setMessageSearchLoading(true);
      setMessageSearchUnavailable(false);
      void api(`/api/search/messages?q=${encodeURIComponent(needle)}&limit=16`, { signal: controller.signal })
        .then((body) => {
          if (!controller.signal.aborted) {
            setMessageHits(Array.isArray(body.hits) ? body.hits : []);
            setMessageSearchUnavailable(body.available === false);
          }
        })
        .catch((error) => {
          if (!controller.signal.aborted) {
            console.warn("Transcript search failed", error);
            setMessageHits([]);
            setMessageSearchUnavailable(true);
          }
        })
        .finally(() => { if (!controller.signal.aborted) setMessageSearchLoading(false); });
    }, 180);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  const openTranscriptHit = async (hit: TranscriptSearchHit) => {
    setOpeningMessageId(hit.messageId);
    try {
      const window = await api(
        `/api/bots/${encodeURIComponent(hit.botId)}/messages?around=${encodeURIComponent(hit.messageId)}&limit=120`,
      );
      dispatch({
        type: "focusMessage",
        botId: hit.botId,
        threadId: hit.threadId,
        messageId: hit.messageId,
        messages: window.messages ?? [],
        hasMoreAfter: Boolean(window.hasMoreAfter),
        latestMessageId: window.latestMessageId ?? null,
      });
    } catch (error) {
      dispatch({ type: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setOpeningMessageId(null);
    }
  };

  const visibleBots = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return state.bots
      .filter((bot) => !bot.hidden)
      .filter((bot) => !needle || `${bot.name} ${bot.title} ${bot.description} ${preview(bot)}`.toLowerCase().includes(needle))
      .sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false));
  }, [query, state.bots]);
  const groups = [
    ...state.workspace.sections.map((section) => ({
      id: section.id,
      name: section.name,
      bots: visibleBots.filter((bot) => bot.sectionId === section.id),
    })),
    { id: "unsectioned", name: state.workspace.sections.length ? "Bots" : "", bots: visibleBots.filter((bot) => !bot.sectionId) },
  ].filter((group) => group.bots.length > 0);
  const attentionCount = state.bots.reduce(
    (count, bot) => count + bot.messages.filter((message) => message.kind === "options" && message.card && !message.card.answered && !message.card.dismissed).length,
    0,
  );
  const attentionLabel = attentionCount === 0
    ? "Needs you, no pending items"
    : `Needs you, ${attentionCount} pending ${attentionCount === 1 ? "item" : "items"}`;
  const titlebarStyle = isElectron
    ? ({ WebkitAppRegion: "drag" } as React.CSSProperties)
    : undefined;
  const titlebarActionsStyle = isElectron
    ? ({ WebkitAppRegion: "no-drag" } as React.CSSProperties)
    : undefined;

  return (
    <aside className="flex h-full w-[320px] shrink-0 flex-col border-r border-hairline/40 bg-panel">
      {/* Electron owns the macOS traffic lights. The browser gets ordinary web chrome. */}
      <div
        className="flex items-center justify-between px-4 pt-3.5 pb-1"
        style={titlebarStyle}
      >
        {isMacElectron ? <div className="w-14 shrink-0" aria-hidden="true" /> : <span aria-hidden="true" />}
        <div className="flex items-center gap-1" style={titlebarActionsStyle}>
          <button
            onClick={() => dispatch({ type: "toggleWork", open: true, tab: "attention" })}
            className="relative rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink"
            aria-label={attentionLabel}
            aria-expanded={state.workOpen && state.workTab === "attention"}
            title={attentionLabel}
          >
            <Bell size={18} strokeWidth={2} />
            {attentionCount > 0 && (
              <span
                aria-hidden="true"
                className="absolute -right-1 -top-1 min-w-4 rounded-full bg-danger px-1 text-center text-[9px] font-semibold leading-4 text-white"
              >
                {attentionCount > 99 ? "99+" : attentionCount}
              </span>
            )}
          </button>
          <button
            onClick={() => dispatch({ type: "newBot" })}
            className="rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink"
            aria-label="New bot"
            title="New bot"
          >
            <Plus size={20} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 pt-2 pb-3">
        <div className="flex items-center gap-2 rounded-lg bg-raised/70 px-3 py-2">
          <Search size={16} className="text-ink-secondary" />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search bots and messages"
            aria-label="Search bots and messages"
            className="w-full bg-transparent text-[14px] text-ink placeholder:text-ink-secondary focus:outline-none"
          />
          <span className="text-[10px] text-ink-secondary">⌘K</span>
        </div>
      </div>

      {/* Bots + transcript search results */}
      <div className="flex-1 overflow-y-auto px-2">
        <div className="flex flex-col gap-0.5">
          {query.trim().length >= 2 && (messageHits.length > 0 || messageSearchLoading || messageSearchUnavailable) && (
            <div className="mb-2">
              <div className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">
                <MessageSquareText size={12} /> Messages
                {messageSearchLoading && <Loader2 size={11} className="ml-auto animate-spin" />}
              </div>
              {messageHits.map((hit) => (
                <button
                  key={`${hit.threadId}:${hit.messageId}`}
                  onClick={() => void openTranscriptHit(hit)}
                  disabled={openingMessageId === hit.messageId}
                  className="group flex w-full items-start gap-2.5 rounded-xl px-3 py-2 text-left hover:bg-raised/65 disabled:opacity-60"
                  title={`Open message in ${hit.botName}`}
                >
                  <MessageSquareText size={15} className="mt-0.5 shrink-0 text-accent" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[12px] font-semibold text-ink">{hit.botName}</span>
                      <span className="shrink-0 text-[10px] text-ink-secondary">{formatTime(hit.at)}</span>
                    </span>
                    <span className="mt-0.5 block line-clamp-2 text-[12px] leading-4 text-ink-secondary">{hit.preview || "Visible transcript message"}</span>
                  </span>
                  {openingMessageId === hit.messageId && <Loader2 size={12} className="mt-1 animate-spin text-ink-secondary" />}
                </button>
              ))}
              {!messageHits.length && !messageSearchLoading && messageSearchUnavailable && (
                <div className="px-3 py-2 text-[12px] text-ink-secondary">Local transcript search is unavailable.</div>
              )}
            </div>
          )}
          {groups.map((group) => (
            <div key={group.id} className="mb-2">
              {group.name && (
                <div className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">
                  <Folder size={12} /> {group.name}
                </div>
              )}
              {group.bots.map((bot) => <BotListItem key={bot.id} bot={bot} onMenu={setMenu} />)}
            </div>
          ))}
          {!groups.length && <div className="px-4 py-8 text-center text-[13px] text-ink-secondary">No matching bots</div>}
        </div>
      </div>

      {/* Footer */}
      <div className="px-3 pb-3 pt-2">
        <div className="flex items-center">
          <button
            onClick={() => dispatch({ type: "toggleAppSettings" })}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-raised/50"
          >
            <InitialsAvatar initials={profileInitials(state.config?.profile)} size={28} />
            <span className="truncate text-[14px] text-ink">
              {state.config?.profile?.name?.trim() || state.config?.profile?.email?.trim() || "You"}
            </span>
          </button>
          <button
            onClick={() => dispatch({ type: "toggleAppSettings" })}
            className="rounded-md p-2 text-ink-secondary hover:bg-raised hover:text-ink"
            title="App settings"
          >
            <Settings size={18} />
          </button>
        </div>
      </div>

      {menu && (
        <BotContextMenu
          menu={menu}
          onClose={() => setMenu(null)}
          onMove={setMoveBotId}
          onDelete={setDeleteBotId}
        />
      )}
      {moveBotId && <MoveSectionDialog botId={moveBotId} onClose={() => setMoveBotId(null)} />}
      {deleteBotId && <DeleteBotDialog botId={deleteBotId} onClose={() => setDeleteBotId(null)} />}
    </aside>
  );
}
