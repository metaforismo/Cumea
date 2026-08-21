import { Fragment, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, ChevronLeft, ChevronRight, Crown, FileText, ListChecks, Loader2, Monitor, Pencil, X } from "lucide-react";
import { api, useStore, useStreaming, formatTime, messageVersions, visibleMessages, type Bot, type Message } from "@/state/store";
import { CumeaAvatar } from "./Avatar";
import { expressionForBot } from "@/lib/mascot";
import { avatarForBot, avatarStateForBot } from "@/lib/mote";
import { OptionCard } from "./OptionCard";
import { Composer } from "./Composer";
import { cn } from "@/lib/cn";
import { SafeMarkdown } from "./SafeMarkdown";
import { FileViewer, type FileCapabilityView } from "./FileViewer";

function calendarDay(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(at: number): string {
  const date = new Date(at);
  const today = new Date();
  const start = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((start(today) - start(date)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

function DaySeparator({ at }: { at: number }) {
  return <div className="chat-date-separator">{dayLabel(at)} {formatTime(at)}</div>;
}

function ContextSeparator({ message }: { message: Message }) {
  return (
    <div className="chat-context-separator" role="separator" aria-label={`Task context: ${message.context?.label ?? "Fresh context"}`}>
      <span>{message.context?.label ?? "Fresh context"}</span>
    </div>
  );
}

function checkedFileCapability(value: unknown): FileCapabilityView {
  const file = value && typeof value === "object" ? value as Record<string, unknown> : null;
  if (
    !file ||
    typeof file.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(file.token) ||
    typeof file.name !== "string" || !file.name || file.name.length > 180 || /[\u0000-\u001f\u007f]/.test(file.name) ||
    typeof file.mime !== "string" || file.mime.length > 120 ||
    !["markdown", "pdf", "docx", "html"].includes(String(file.kind)) ||
    !["local", "cloud"].includes(String(file.source)) ||
    typeof file.size !== "number" || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 25 * 1024 * 1024 ||
    typeof file.expiresAt !== "number" || !Number.isFinite(file.expiresAt)
  ) {
    throw new Error("The host returned an invalid file capability");
  }
  return {
    token: file.token,
    name: file.name,
    mime: file.mime,
    kind: file.kind as FileCapabilityView["kind"],
    size: file.size,
    source: file.source as FileCapabilityView["source"],
    expiresAt: file.expiresAt,
  };
}

function BubbleEditor({
  message,
  onCancel,
  onSubmit,
}: {
  message: Message;
  onCancel: () => void;
  onSubmit: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState(message.text ?? "");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.setSelectionRange(text.length, text.length);
  }, [message.id]);

  const save = async () => {
    const next = text.trim();
    if (!next || saving) return;
    setSaving(true);
    try {
      await onSubmit(next);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="chat-bubble chat-bubble--user ml-auto w-full border border-accent/40 px-4 py-3">
      <label className="sr-only" htmlFor={`edit-${message.id}`}>Edit message</label>
      <textarea
        id={`edit-${message.id}`}
        ref={inputRef}
        value={text}
        rows={Math.min(10, Math.max(2, text.split("\n").length))}
        disabled={saving}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void save();
          }
        }}
        className="w-full resize-none bg-transparent text-[14px] leading-5 text-bubble-user-text outline-none disabled:opacity-60"
      />
      {message.attachments?.length ? (
        <p className="mt-1 text-[11px] text-bubble-user-text/60">Attached files stay with this version.</p>
      ) : null}
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={saving} className="rounded-full px-3 py-1 text-[13px] text-bubble-user-text/65 hover:bg-black/[0.08] hover:text-bubble-user-text disabled:opacity-50">
          Cancel
        </button>
        <button type="button" onClick={() => void save()} disabled={!text.trim() || saving} className="flex items-center gap-1.5 rounded-full bg-ink px-3 py-1 text-[13px] font-medium text-app disabled:opacity-50">
          {saving ? <Loader2 size={12} className="animate-spin" /> : null}
          Save & rerun
        </button>
      </div>
    </div>
  );
}

function Bubble({
  bot,
  message,
  editing,
  switching,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
  onSwitch,
  onOpenPath,
  onOpenAttachment,
  onCancelQueued,
}: {
  bot: Bot;
  message: Message;
  editing: boolean;
  switching: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSubmitEdit: (text: string) => Promise<void>;
  onSwitch: (messageId: string) => Promise<void>;
  onOpenPath: (path: string) => void;
  onOpenAttachment: (id: string) => void;
  onCancelQueued?: () => void;
}) {
  const user = message.role === "user";
  if (user && editing) {
    return <BubbleEditor message={message} onCancel={onCancelEdit} onSubmit={onSubmitEdit} />;
  }
  const versions = user ? messageVersions(bot, message) : [message];
  const versionIndex = versions.findIndex((version) => version.id === message.id);
  return (
    <div className={cn("group flex w-full flex-col", user ? "items-end" : "items-start")}>
      <div className={cn("flex w-full items-center gap-1.5", user ? "justify-end" : "justify-start")}>
        {user && message.kind === "text" && !bot.busy ? (
          <button
            type="button"
            onClick={onStartEdit}
            className="rounded-md p-1.5 text-ink-secondary opacity-0 hover:bg-raised hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
            aria-label="Edit message"
            title="Edit message"
          >
            <Pencil size={14} />
          </button>
        ) : null}
        <div
          className={cn(
            "chat-bubble",
            user ? "chat-bubble--user whitespace-pre-wrap" : "chat-bubble--assistant",
          )}
        >
          {user ? <div className="whitespace-pre-wrap">{message.text}</div> : <SafeMarkdown text={message.text ?? ""} onOpenFile={onOpenPath} />}
          {message.attachments?.length ? (
            <div className="mt-2 flex flex-wrap gap-2 border-t border-hairline/30 pt-2">
              {message.attachments.map((attachment) => (
                <button
                  type="button"
                  key={attachment.id}
                  onClick={() => onOpenAttachment(attachment.id)}
                  className={cn(
                    "flex max-w-[260px] items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px]",
                    user
                      ? "bg-black/[0.08] text-bubble-user-text hover:bg-black/[0.12]"
                      : "bg-inset text-ink hover:bg-raised",
                  )}
                >
                  <FileText size={13} className="shrink-0 text-ink-secondary" />
                  <span className="truncate">{attachment.name}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {user && message.delivery ? (
        <div className="mt-1 flex min-h-5 items-center gap-2 pr-1 text-[11px] text-ink-secondary">
          <span>{message.delivery === "queued" ? "Queued" : message.delivery === "failed" ? "Couldn’t start" : message.delivery === "cancelled" ? "Cancelled" : "Sent"}</span>
          {message.delivery === "queued" && onCancelQueued ? (
            <button type="button" onClick={onCancelQueued} className="rounded px-1.5 py-0.5 hover:bg-raised hover:text-ink">Cancel</button>
          ) : null}
        </div>
      ) : null}
      {versions.length > 1 ? (
        <div className="mt-1 flex items-center gap-0.5 pr-1 text-[12px] text-ink-secondary" aria-label={`Message version ${versionIndex + 1} of ${versions.length}`}>
          <button
            type="button"
            onClick={() => versions[versionIndex - 1] && void onSwitch(versions[versionIndex - 1].id)}
            disabled={switching || bot.busy || versionIndex <= 0}
            className="rounded p-0.5 hover:bg-raised hover:text-ink disabled:opacity-30"
            aria-label="Previous message version"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="min-w-7 text-center tabular-nums">{versionIndex + 1}/{versions.length}</span>
          <button
            type="button"
            onClick={() => versions[versionIndex + 1] && void onSwitch(versions[versionIndex + 1].id)}
            disabled={switching || bot.busy || versionIndex >= versions.length - 1}
            className="rounded p-0.5 hover:bg-raised hover:text-ink disabled:opacity-30"
            aria-label="Next message version"
          >
            {switching ? <Loader2 size={12} className="animate-spin" /> : <ChevronRight size={14} />}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function HandoffCard({ message }: { message: Message }) {
  const handoff = message.handoff;
  if (!handoff) return null;
  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[620px] rounded-2xl border border-hairline/50 bg-card p-3.5">
        <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
          <span>{handoff.fromName}</span>
          <ArrowRight size={14} className="text-ink-secondary" />
          <span>{handoff.toName}</span>
          <span className={cn("ml-auto rounded-full px-2 py-0.5 text-[10px]", handoff.status === "completed" ? "bg-success/10 text-success" : handoff.status === "failed" ? "bg-danger/10 text-danger" : "bg-accent/10 text-accent")}>
            {handoff.status}
          </span>
        </div>
        <div className="mt-2 text-[12px] leading-relaxed text-ink-secondary">{handoff.prompt}</div>
        {handoff.reply && <div className="mt-2 rounded-lg bg-inset px-2.5 py-2 text-[12px] leading-relaxed text-ink">{handoff.reply}</div>}
      </div>
    </div>
  );
}

/** A tool run: spinner while live, check/cross once settled. */
function ActivityChip({ message }: { message: Message }) {
  const tool = message.tool;
  if (!tool) return null;
  const failed = tool.ok === false;
  return (
    <div className="flex justify-start">
      <div
        className={cn(
          "flex items-center gap-2 rounded-full border border-hairline/40 bg-panel px-3 py-1.5 text-[13px]",
          failed ? "text-danger" : "text-ink-secondary",
        )}
      >
        {tool.ok === undefined ? (
          <Loader2 size={13} className="animate-spin" />
        ) : failed ? (
          <X size={13} />
        ) : (
          <Check size={13} className="text-success" />
        )}
        <span className="max-w-[480px] truncate font-mono">{tool.name}</span>
      </div>
    </div>
  );
}

function ScreenFrame({ png, mime }: { png: string; mime?: string }) {
  return (
    <div className="flex justify-start">
      <img
        src={`data:${mime ?? "image/png"};base64,${png}`}
        alt="Bot's screen"
        className="max-w-[70%] rounded-2xl border border-hairline/40"
      />
    </div>
  );
}

function StreamingBubble({ text, onOpenPath }: { text: string; onOpenPath: (path: string) => void }) {
  // Markdown parsing is intentionally deferred behind the 1-frame transport
  // batching; a long answer cannot monopolize urgent composer interactions.
  const deferredText = useDeferredValue(text);
  return (
    <div className="flex w-full justify-start">
      <div className="chat-bubble chat-bubble--assistant chat-bubble--streaming">
        <SafeMarkdown text={deferredText} onOpenFile={onOpenPath} streaming />
        <span className="chat-stream-caret" aria-hidden />
      </div>
    </div>
  );
}

export function ChatView({ bot }: { bot: Bot }) {
  const { state, dispatch, editMessage, switchBranch } = useStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [fileViewer, setFileViewer] = useState<FileCapabilityView | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  const stream = useStreaming(bot.threadId);
  const streaming = stream.assistantText;
  const provisioning = state.provisioning[bot.id];
  const mascotMotion = state.mascotMotion?.botId === bot.id ? state.mascotMotion : null;
  const queuedTasks = useMemo(
    () => state.workspace.tasks.filter((task) => task.botId === bot.id && task.source === "message" && task.status === "queued"),
    [bot.id, state.workspace.tasks],
  );
  const queuedTaskByMessage = useMemo(
    () => new Map(queuedTasks.flatMap((task) => task.messageId ? [[task.messageId, task]] : [])),
    [queuedTasks],
  );
  const queuedRows = useMemo(
    () => queuedTasks.flatMap((task) => {
      const message = task.messageId ? bot.messages.find((candidate) => candidate.id === task.messageId) : undefined;
      return message?.kind === "text" && message.text ? [{ task, message }] : [];
    }),
    [bot.messages, queuedTasks],
  );

  const messages = useMemo(() => visibleMessages(bot), [bot]);
  const transcriptMessages = useMemo(
    () => messages.filter((message) => message.kind !== "activity" || message.tool?.ok !== true),
    [messages],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [bot.id, messages.length, bot.activeLeafId, streaming, bot.busy]);

  useEffect(() => {
    setFileViewer(null);
    setFileError(null);
    setEditingId(null);
    setSwitchingId(null);
  }, [bot.id]);

  const resolveFile = useCallback(async (endpoint: string, path?: string) => {
    setFileError(null);
    try {
      const body = await api(endpoint, {
        method: "POST",
        ...(path !== undefined ? { body: JSON.stringify({ path }) } : {}),
      });
      setFileViewer(checkedFileCapability(body.file));
    } catch (reason) {
      setFileError(reason instanceof Error ? reason.message : String(reason));
    }
  }, []);
  const openPath = useCallback((path: string) => void resolveFile(`/api/bots/${bot.id}/files/resolve`, path), [bot.id, resolveFile]);
  const openAttachment = useCallback((id: string) => void resolveFile(`/api/attachments/${id}/files/resolve`), [resolveFile]);
  const submitEdit = useCallback(async (messageId: string, text: string) => {
    await editMessage({ botId: bot.id, messageId, text });
    setEditingId(null);
  }, [bot.id, editMessage]);
  const changeBranch = useCallback(async (messageId: string) => {
    setSwitchingId(messageId);
    try {
      await switchBranch({ botId: bot.id, messageId });
      setEditingId(null);
    } finally {
      setSwitchingId(null);
    }
  }, [bot.id, switchBranch]);
  const cancelQueued = useCallback(async (taskId: string) => {
    try {
      await api(`/api/tasks/${taskId}/queue`, { method: "DELETE" });
    } catch (error) {
      dispatch({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [dispatch]);
  const lastEditableMessage = [...messages].reverse().find((message) => message.role === "user" && message.kind === "text");

  return (
    <main className="relative flex h-full min-w-0 flex-1 flex-col bg-app">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3">
        <button
          onClick={() => dispatch({ type: "toggleSettings" })}
          className="flex items-center gap-2.5 rounded-lg px-1.5 py-1 hover:bg-raised/50"
          title="Bot settings"
        >
          <CumeaAvatar
            avatar={avatarForBot(bot)}
            expression={expressionForBot(bot)}
            size={28}
            motion={mascotMotion?.kind ?? "none"}
            motionKey={mascotMotion?.nonce ?? 0}
            state={avatarStateForBot(bot)}
            label={`${bot.name} avatar`}
            ambient
          />
          <span className="text-[15px] font-semibold text-ink">{bot.name}</span>
          {bot.coordinator ? (
            <span className="flex items-center gap-1 rounded-md bg-warning/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.05em] text-warning">
              <Crown size={10} aria-hidden="true" /> Coordinator
            </span>
          ) : null}
          {bot.busy && <Loader2 size={14} className="animate-spin text-ink-secondary" />}
          {queuedTasks.length ? <span className="rounded-full bg-raised px-2 py-0.5 text-[11px] text-ink-secondary">{queuedTasks.length} queued</span> : null}
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => dispatch({ type: "toggleWork", tab: "activity" })}
            className={cn(
              "rounded-md p-1.5 hover:bg-raised",
              state.workOpen ? "text-accent" : "text-ink-secondary hover:text-ink",
            )}
            aria-label="Open work: Needs you, activity, routines, and sections"
            title="Work: Needs you, activity, routines, and sections"
          >
            <ListChecks size={18} />
          </button>
          <button
            onClick={() => dispatch({ type: "toggleComputer" })}
            className={cn(
              "rounded-md p-1.5 hover:bg-raised",
              state.computerOpen ? "text-accent" : "text-ink-secondary hover:text-ink",
            )}
            title="Bot's computer"
          >
            <Monitor size={18} />
          </button>
        </div>
      </div>

      {/* Error banner */}
      {state.error && (
        <div className="mx-auto w-full max-w-[900px] px-5">
          <div className="mb-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">
            {state.error}
          </div>
        </div>
      )}
      {fileError && (
        <div className="mx-auto w-full max-w-[900px] px-5">
          <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">
            <span>{fileError}</span>
            <button type="button" onClick={() => setFileError(null)} aria-label="Dismiss file error"><X size={14} /></button>
          </div>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5">
        <div className="mx-auto flex max-w-[900px] flex-col gap-3 pb-4">
          {transcriptMessages.map((message, index) => {
            const needsSeparator = index === 0 || calendarDay(transcriptMessages[index - 1].at) !== calendarDay(message.at);
            let content;
            switch (message.kind) {
              case "options":
                content = <OptionCard botId={bot.id} message={message} projectionOnly={Boolean(message.card?.requestId)} />;
                break;
              case "activity":
                content = <ActivityChip message={message} />;
                break;
              case "screen":
                content = message.png ? <ScreenFrame png={message.png} mime={message.mime} /> : null;
                break;
              case "handoff":
                content = <HandoffCard message={message} />;
                break;
              case "context":
                content = <ContextSeparator message={message} />;
                break;
              default:
                content = (
                  <Bubble
                    bot={bot}
                    message={message}
                    editing={editingId === message.id}
                    switching={switchingId !== null}
                    onStartEdit={() => setEditingId(message.id)}
                    onCancelEdit={() => setEditingId(null)}
                    onSubmitEdit={(text) => submitEdit(message.id, text)}
                    onSwitch={changeBranch}
                    onOpenPath={openPath}
                    onOpenAttachment={openAttachment}
                    onCancelQueued={queuedTaskByMessage.get(message.id) ? () => void cancelQueued(queuedTaskByMessage.get(message.id)!.id) : undefined}
                  />
                );
            }
            return (
              <Fragment key={message.id}>
                {needsSeparator && <DaySeparator at={message.at} />}
                {content}
              </Fragment>
            );
          })}
          {provisioning && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-full border border-hairline/40 bg-panel px-3 py-1.5 text-[13px] text-ink-secondary">
                <Loader2 size={13} className="animate-spin" />
                Setting up this bot's computer…
              </div>
            </div>
          )}
          {streaming ? (
            <StreamingBubble text={streaming} onOpenPath={openPath} />
          ) : (
            bot.busy && (
              <div className="flex justify-start">
                <div className="flex items-center gap-1.5 rounded-2xl bg-raised px-4 py-3">
                  <span className="chat-thinking-dot [animation-delay:0ms]" />
                  <span className="chat-thinking-dot [animation-delay:180ms]" />
                  <span className="chat-thinking-dot [animation-delay:360ms]" />
                </div>
              </div>
            )
          )}
        </div>
      </div>

      {queuedRows.length ? (
        <section className="mx-auto mb-1 w-full max-w-[900px] px-5" aria-label={`${queuedRows.length} queued ${queuedRows.length === 1 ? "task" : "tasks"}`}>
          <div className="rounded-2xl border border-hairline/35 bg-panel/95 px-3 py-2 shadow-sm backdrop-blur">
            <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-ink-secondary">
              <span>Up next</span>
              <span>{queuedRows.length}</span>
            </div>
            {queuedRows.slice(0, 3).map(({ task, message }) => (
              <div key={task.id} className="flex min-h-9 items-center gap-2 border-t border-hairline/25 first:border-t-0">
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{message.text}</span>
                <button type="button" onClick={() => void cancelQueued(task.id)} className="min-h-8 rounded-full px-2 text-[11px] font-semibold text-ink-secondary hover:bg-raised hover:text-ink">
                  Cancel
                </button>
              </div>
            ))}
            {queuedRows.length > 3 ? <div className="pt-1 text-[11px] text-ink-secondary">+{queuedRows.length - 3} more</div> : null}
          </div>
        </section>
      ) : null}

      <Composer
        bot={bot}
        onEditLast={lastEditableMessage && !bot.busy ? () => setEditingId(lastEditableMessage.id) : undefined}
      />
      {fileViewer && <FileViewer file={fileViewer} onClose={() => setFileViewer(null)} />}
    </main>
  );
}
