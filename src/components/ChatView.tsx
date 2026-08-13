import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, FileText, ListChecks, Loader2, Monitor, Square, X } from "lucide-react";
import { api, useStore, formatTime, type Bot, type Message } from "@/state/store";
import { CumeaAvatar } from "./Avatar";
import { expressionForBot } from "@/lib/mascot";
import { avatarForBot, avatarStateForBot } from "@/lib/mote";
import { OptionCard } from "./OptionCard";
import { Composer } from "./Composer";
import { cn } from "@/lib/cn";
import { SafeMarkdown } from "./SafeMarkdown";
import { FileViewer, type FileCapabilityView } from "./FileViewer";

function checkedFileCapability(value: unknown): FileCapabilityView {
  const file = value && typeof value === "object" ? value as Record<string, unknown> : null;
  if (
    !file ||
    typeof file.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(file.token) ||
    typeof file.name !== "string" || !file.name || file.name.length > 180 || /[\u0000-\u001f\u007f]/.test(file.name) ||
    typeof file.mime !== "string" || file.mime.length > 120 ||
    !["markdown", "pdf", "docx"].includes(String(file.kind)) ||
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

function Bubble({ message, onOpenPath, onOpenAttachment }: { message: Message; onOpenPath: (path: string) => void; onOpenAttachment: (id: string) => void }) {
  const user = message.role === "user";
  return (
    <div className={cn("flex w-full", user ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[70%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed",
          user ? "whitespace-pre-wrap bg-bubble-user text-ink" : "bg-card text-ink",
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
                className="flex max-w-[260px] items-center gap-2 rounded-lg bg-inset px-2.5 py-1.5 text-[12px] text-ink hover:bg-raised"
              >
                <FileText size={13} className="shrink-0 text-ink-secondary" />
                <span className="truncate">{attachment.name}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
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
  return (
    <div className="flex w-full justify-start">
      <div className="max-w-[70%] rounded-2xl bg-card px-4 py-2.5 text-[15px] leading-relaxed text-ink">
        <SafeMarkdown text={text} onOpenFile={onOpenPath} />
        <span className="ml-0.5 inline-block h-[14px] w-[2px] animate-pulse bg-ink-secondary align-middle" />
      </div>
    </div>
  );
}

export function ChatView({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [fileViewer, setFileViewer] = useState<FileCapabilityView | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const streaming = state.streaming[bot.threadId];
  const provisioning = state.provisioning[bot.id];
  const mascotMotion = state.mascotMotion?.botId === bot.id ? state.mascotMotion : null;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [bot.id, bot.messages.length, streaming, bot.busy]);

  useEffect(() => {
    setFileViewer(null);
    setFileError(null);
  }, [bot.id]);

  const first = bot.messages[0];

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
          {bot.busy && <Loader2 size={14} className="animate-spin text-ink-secondary" />}
        </button>
        <div className="flex items-center gap-2">
          {bot.busy && (
            <button
              onClick={() => dispatch({ type: "interrupt", botId: bot.id })}
              className="flex items-center gap-1.5 rounded-full border border-hairline/40 bg-raised/60 px-2.5 py-1 text-[13px] text-ink-secondary hover:bg-raised hover:text-ink"
              title="Stop this turn"
            >
              <Square size={12} className="fill-current" />
              Stop
            </button>
          )}
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
          {first && (
            <div className="py-3 text-center text-[13px] text-ink-secondary">
              Today {formatTime(first.at)}
            </div>
          )}
          {bot.messages.map((m) => {
            switch (m.kind) {
              case "options":
                return <OptionCard key={m.id} botId={bot.id} message={m} />;
              case "activity":
                return <ActivityChip key={m.id} message={m} />;
              case "screen":
                return m.png ? <ScreenFrame key={m.id} png={m.png} mime={m.mime} /> : null;
              case "handoff":
                return <HandoffCard key={m.id} message={m} />;
              default:
                return <Bubble key={m.id} message={m} onOpenPath={openPath} onOpenAttachment={openAttachment} />;
            }
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
                  <span className="size-1.5 animate-bounce rounded-full bg-ink-secondary [animation-delay:0ms]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-ink-secondary [animation-delay:150ms]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-ink-secondary [animation-delay:300ms]" />
                </div>
              </div>
            )
          )}
        </div>
      </div>

      <Composer bot={bot} />
      {fileViewer && <FileViewer file={fileViewer} onClose={() => setFileViewer(null)} />}
    </main>
  );
}
