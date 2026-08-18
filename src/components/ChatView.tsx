import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowRight, Check, Download, FileText, ListChecks, Loader2, Monitor, Square, X } from "lucide-react";
import { api, useStore, formatTime, type Bot, type Message } from "@/state/store";
import { CumeaAvatar } from "./Avatar";
import { expressionForBot } from "@/lib/mascot";
import { avatarForBot, avatarStateForBot } from "@/lib/mote";
import { OptionCard } from "./OptionCard";
import { Composer } from "./Composer";
import { cn } from "@/lib/cn";

// Minimal markdown for bot bubbles: **bold**, `code`, headings, lists.
// Rendered as React nodes — model output never reaches the DOM as HTML.
function inlineMd(text: string, keyBase: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      parts.push(<strong key={`${keyBase}-${i++}`}>{tok.slice(2, -2)}</strong>);
    } else {
      parts.push(
        <code key={`${keyBase}-${i++}`} className="rounded bg-inset px-1 py-px text-[13px]">
          {tok.slice(1, -1)}
        </code>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function Markdownish({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => {
        const heading = line.match(/^#{1,4}\s+(.*)$/);
        if (heading) {
          return (
            <div key={i} className="mt-1.5 font-semibold">
              {inlineMd(heading[1], `h${i}`)}
            </div>
          );
        }
        const bullet = line.match(/^\s*[-•*]\s+(.*)$/);
        if (bullet) {
          return (
            <div key={i} className="flex gap-2 pl-1">
              <span className="text-ink-secondary">•</span>
              <span className="min-w-0">{inlineMd(bullet[1], `b${i}`)}</span>
            </div>
          );
        }
        const numbered = line.match(/^\s*(\d+)\.\s+(.*)$/);
        if (numbered) {
          return (
            <div key={i} className="flex gap-2 pl-1">
              <span className="text-ink-secondary">{numbered[1]}.</span>
              <span className="min-w-0">{inlineMd(numbered[2], `n${i}`)}</span>
            </div>
          );
        }
        if (!line.trim()) return <div key={i} className="h-2.5" />;
        return <div key={i}>{inlineMd(line, `p${i}`)}</div>;
      })}
    </>
  );
}

function Bubble({ message }: { message: Message }) {
  const user = message.role === "user";
  return (
    <div className={cn("flex w-full", user ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[70%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed",
          user ? "whitespace-pre-wrap bg-bubble-user text-ink" : "bg-card text-ink",
        )}
      >
        {user ? message.text : <Markdownish text={message.text ?? ""} />}
        {message.attachments?.length ? (
          <div className="mt-2 flex flex-wrap gap-2 border-t border-hairline/30 pt-2">
            {message.attachments.map((attachment) => (
              <a
                key={attachment.id}
                href={`/api/attachments/${attachment.id}`}
                className="flex max-w-[260px] items-center gap-2 rounded-lg bg-inset px-2.5 py-1.5 text-[12px] text-ink hover:bg-raised"
              >
                <FileText size={13} className="shrink-0 text-ink-secondary" />
                <span className="truncate">{attachment.name}</span>
              </a>
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

function StreamingBubble({ text }: { text: string }) {
  return (
    <div className="flex w-full justify-start">
      <div className="max-w-[70%] rounded-2xl bg-card px-4 py-2.5 text-[15px] leading-relaxed text-ink">
        <Markdownish text={text} />
        <span className="ml-0.5 inline-block h-[14px] w-[2px] animate-pulse bg-ink-secondary align-middle" />
      </div>
    </div>
  );
}

export function ChatView({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef<HTMLDivElement>(null);
  const [returningLatest, setReturningLatest] = useState(false);
  const [exporting, setExporting] = useState(false);

  const focus = state.searchFocus?.botId === bot.id ? state.searchFocus : null;
  const streaming = state.streaming[bot.threadId];
  const provisioning = state.provisioning[bot.id];
  const mascotMotion = state.mascotMotion?.botId === bot.id ? state.mascotMotion : null;

  useEffect(() => {
    if (focus) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [bot.id, bot.messages.length, streaming, bot.busy, focus]);

  useEffect(() => {
    if (!focus) return;
    const frame = requestAnimationFrame(() => {
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      focusRef.current?.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [focus?.messageId, bot.messages.length]);

  const returnToLatest = async () => {
    setReturningLatest(true);
    try {
      const page = await api(`/api/bots/${encodeURIComponent(bot.id)}/messages?limit=80`);
      dispatch({ type: "latestMessages", threadId: bot.threadId, messages: page.messages ?? [] });
    } catch (error) {
      dispatch({ type: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setReturningLatest(false);
    }
  };

  const exportTranscript = async () => {
    setExporting(true);
    try {
      const response = await fetch(`/api/bots/${encodeURIComponent(bot.id)}/export?format=markdown`);
      if (!response.ok) throw new Error("Export failed (" + response.status + ")");
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const safeName = (bot.name || "transcript").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "transcript";
      anchor.href = href;
      anchor.download = safeName + ".md";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(href);
    } catch (error) {
      dispatch({ type: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setExporting(false);
    }
  };

  const first = bot.messages[0];

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
          <button
            onClick={() => void exportTranscript()}
            disabled={exporting}
            className="rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-50"
            aria-label="Export visible transcript as Markdown"
            title="Export visible transcript as Markdown"
          >
            {exporting ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
          </button>
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

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5">
        <div className="mx-auto flex max-w-[900px] flex-col gap-3 pb-4">
          {first && (
            <div className="py-3 text-center text-[13px] text-ink-secondary">
              Today {formatTime(first.at)}
            </div>
          )}
          {focus?.hasMoreAfter && (
            <div className="sticky top-2 z-10 flex justify-center py-1">
              <button
                onClick={() => void returnToLatest()}
                disabled={returningLatest}
                className="flex items-center gap-1.5 rounded-full border border-hairline/50 bg-panel/95 px-3 py-1.5 text-[12px] font-medium text-ink shadow-sm backdrop-blur hover:bg-raised disabled:opacity-60"
              >
                {returningLatest ? <Loader2 size={13} className="animate-spin" /> : <ArrowDown size={13} />}
                Return to latest
              </button>
            </div>
          )}
          {bot.messages.map((m) => {
            let content: React.ReactNode = null;
            switch (m.kind) {
              case "options":
                content = <OptionCard botId={bot.id} message={m} />;
                break;
              case "activity":
                content = <ActivityChip message={m} />;
                break;
              case "screen":
                content = m.png ? <ScreenFrame png={m.png} mime={m.mime} /> : null;
                break;
              case "handoff":
                content = <HandoffCard message={m} />;
                break;
              default:
                content = <Bubble message={m} />;
            }
            if (!content) return null;
            const focused = focus?.messageId === m.id;
            return (
              <div
                key={m.id}
                ref={focused ? focusRef : undefined}
                data-message-id={m.id}
                className={cn(
                  "scroll-my-20 rounded-2xl transition-shadow",
                  focused && "ring-2 ring-accent/55 ring-offset-2 ring-offset-app",
                )}
              >
                {content}
              </div>
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
            <StreamingBubble text={streaming} />
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
    </main>
  );
}
