import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowRight, Bug, Check, Download, FileText, ListChecks, Loader2, Monitor, Square, X } from "lucide-react";
import { api, useStore, formatTime, type Bot, type Message } from "@/state/store";
import { CumeaAvatar } from "./Avatar";
import { expressionForBot } from "@/lib/mascot";
import { BOTTOM_FOLLOW_THRESHOLD, shouldResumeBottomFollow } from "@/lib/bottom-follow";
import { TRANSCRIPT_WINDOW_SIZE, expandWindowStart, focusWindowRange, resolveTranscriptWindow, tailWindowStart } from "@/lib/transcript-window";
import { avatarForBot, avatarStateForBot } from "@/lib/mote";
import { OptionCard } from "./OptionCard";
import { Composer } from "./Composer";
import { cn } from "@/lib/cn";
import { SafeMarkdown } from "./SafeMarkdown";
import { FileViewer, type FileCapabilityView } from "./FileViewer";

function checkedFileCapability(value: unknown): FileCapabilityView {
  const file = value && typeof value === "object" ? value as Record<string, unknown> : null;
  if (
    !file || typeof file.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(file.token) ||
    typeof file.name !== "string" || !file.name || file.name.length > 180 || /[\u0000-\u001f\u007f]/.test(file.name) ||
    typeof file.mime !== "string" || file.mime.length > 120 ||
    !["markdown", "pdf", "docx", "binary"].includes(String(file.kind)) ||
    !["local", "attachment"].includes(String(file.source)) ||
    typeof file.size !== "number" || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 25 * 1024 * 1024 ||
    typeof file.expiresAt !== "number" || !Number.isFinite(file.expiresAt)
  ) throw new Error("The host returned an invalid file capability");
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

// Rows are memoized: message references survive streamDelta dispatches, so
// during token streaming only the streaming bubble re-renders — this is what
// makes the transcript window's mounted-rows guarantee pay off.
const Bubble = memo(function Bubble({ message, onOpenPath, onOpenAttachment }: { message: Message; onOpenPath: (path: string) => void; onOpenAttachment: (id: string) => void }) {
  const user = message.role === "user";
  return (
    <div className={cn("flex w-full", user ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[70%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed", user ? "whitespace-pre-wrap bg-bubble-user text-ink" : "bg-card text-ink")}>
        {user ? message.text : <SafeMarkdown text={message.text ?? ""} onOpenFile={onOpenPath} />}
        {message.attachments?.length ? (
          <div className="mt-2 flex flex-wrap gap-2 border-t border-hairline/30 pt-2">
            {message.attachments.map((attachment) => (
              <button type="button" key={attachment.id} onClick={() => onOpenAttachment(attachment.id)} className="flex max-w-[260px] items-center gap-2 rounded-lg bg-inset px-2.5 py-1.5 text-[12px] text-ink hover:bg-raised">
                <FileText size={13} className="shrink-0 text-ink-secondary" />
                <span className="truncate">{attachment.name}</span>
              </button>
            ))}
          </div>
        ) : null}
        {user && message.delivery === "queued" ? <div className="mt-1.5 text-right text-[10px] text-ink-secondary">Queued · sends after the current turn</div> : null}
        {user && message.delivery === "dispatching" ? <div className="mt-1.5 text-right text-[10px] text-ink-secondary">Sending steering…</div> : null}
        {user && message.delivery === "failed" ? <div className="mt-1.5 text-right text-[10px] text-danger">Not sent</div> : null}
      </div>
    </div>
  );
});

const HandoffCard = memo(function HandoffCard({ message }: { message: Message }) {
  const handoff = message.handoff;
  if (!handoff) return null;
  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[620px] rounded-2xl border border-hairline/50 bg-card p-3.5">
        <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
          <span>{handoff.fromName}</span><ArrowRight size={14} className="text-ink-secondary" /><span>{handoff.toName}</span>
          <span className={cn("ml-auto rounded-full px-2 py-0.5 text-[10px]", handoff.status === "completed" ? "bg-success/10 text-success" : handoff.status === "failed" ? "bg-danger/10 text-danger" : "bg-accent/10 text-accent")}>{handoff.status}</span>
        </div>
        <div className="mt-2 text-[12px] leading-relaxed text-ink-secondary">{handoff.prompt}</div>
        {handoff.reply && <div className="mt-2 rounded-lg bg-inset px-2.5 py-2 text-[12px] leading-relaxed text-ink">{handoff.reply}</div>}
      </div>
    </div>
  );
});

const ActivityChip = memo(function ActivityChip({ message }: { message: Message }) {
  const tool = message.tool;
  if (!tool) return null;
  const failed = tool.ok === false;
  return (
    <div className="flex justify-start">
      <div className={cn("flex items-center gap-2 rounded-full border border-hairline/40 bg-panel px-3 py-1.5 text-[13px]", failed ? "text-danger" : "text-ink-secondary")}>
        {tool.ok === undefined ? <Loader2 size={13} className="animate-spin" /> : failed ? <X size={13} /> : <Check size={13} className="text-success" />}
        <span className="max-w-[480px] truncate font-mono">{tool.name}</span>
      </div>
    </div>
  );
});

const ScreenFrame = memo(function ScreenFrame({ png, mime }: { png: string; mime?: string }) {
  return <div className="flex justify-start"><img src={`data:${mime ?? "image/png"};base64,${png}`} alt="Bot's screen" className="max-w-[70%] rounded-2xl border border-hairline/40" /></div>;
});

const StreamingBubble = memo(function StreamingBubble({ text, onOpenPath }: { text: string; onOpenPath: (path: string) => void }) {
  return (
    <div className="flex w-full justify-start">
      <div className="max-w-[70%] rounded-2xl bg-card px-4 py-2.5 text-[15px] leading-relaxed text-ink">
        <SafeMarkdown text={text} onOpenFile={onOpenPath} />
        <span className="ml-0.5 inline-block h-[14px] w-[2px] animate-pulse bg-ink-secondary align-middle" />
      </div>
    </div>
  );
});

export function ChatView({ bot, inspectorOpen = false, onToggleInspector }: { bot: Bot; inspectorOpen?: boolean; onToggleInspector?: () => void }) {
  const { state, dispatch } = useStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef<HTMLDivElement>(null);
  const [returningLatest, setReturningLatest] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [fileViewer, setFileViewer] = useState<FileCapabilityView | null>(null);

  const focus = state.searchFocus?.botId === bot.id ? state.searchFocus : null;
  const streaming = state.streaming[bot.threadId];
  const provisioning = state.provisioning[bot.id];
  const mascotMotion = state.mascotMotion?.botId === bot.id ? state.mascotMotion : null;
  const messages = bot.messages;

  // Windowed transcript: only a tail of the thread mounts (screenshots make
  // full threads DOM-heavy). The boundary is anchored per thread; a
  // render-phase reset re-tails it on switch so the old thread's boundary
  // never flashes into the new one.
  const transcriptKey = `${bot.id}:${bot.threadId}`;
  const [transcriptWindow, setTranscriptWindow] = useState<{ key: string; start: number; end: number | null }>(() => ({
    key: transcriptKey,
    start: tailWindowStart(messages.length),
    end: null,
  }));
  if (transcriptWindow.key !== transcriptKey) {
    setTranscriptWindow({ key: transcriptKey, start: tailWindowStart(messages.length), end: null });
  }
  const { visible: windowedMessages, hiddenCount, laterCount, endIndex } = useMemo(
    () => resolveTranscriptWindow(messages, transcriptWindow.start, TRANSCRIPT_WINDOW_SIZE, transcriptWindow.end),
    [messages, transcriptWindow.start, transcriptWindow.end],
  );

  // Scroll pinning: follow the bottom while the user hasn't scrolled away.
  // Follow breaks ONLY on an upward user gesture (wheel/touch/keyboard),
  // never on scroll position checks — streamed content growth flickers "at
  // bottom" false for a frame, and breaking there kills follow permanently.
  // Scrolling back down to the end re-arms it.
  const [follow, setFollow] = useState(true);
  const followRef = useRef(true);
  const previousScrollTop = useRef(0);
  const touchY = useRef(0);
  const setBottomFollow = useCallback((next: boolean) => {
    followRef.current = next;
    setFollow(next);
  }, []);
  useEffect(() => setBottomFollow(true), [bot.id, setBottomFollow]);

  // A search result may sit before the mounted tail. Open a bounded window
  // around it first; the focus effect below scrolls to the row once React
  // commits that window.
  const appliedFocus = useRef<string | null>(null);
  useEffect(() => {
    if (!focus) {
      appliedFocus.current = null;
      return;
    }
    if (appliedFocus.current === focus.messageId) return;
    const targetIndex = messages.findIndex((m) => m.id === focus.messageId);
    if (targetIndex < 0) return;
    appliedFocus.current = focus.messageId;
    const range = focusWindowRange(messages.length, targetIndex);
    setBottomFollow(false);
    setTranscriptWindow({ key: transcriptKey, start: range.start, end: range.end });
  }, [focus, messages, setBottomFollow, transcriptKey]);

  useEffect(() => {
    if (!focus) return;
    const frame = requestAnimationFrame(() => {
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      focusRef.current?.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [focus?.messageId, bot.messages.length, transcriptWindow.start, transcriptWindow.end]);

  // deps track the FULL messages.length, so expanding the window (which only
  // changes windowedMessages) can never re-trigger this bottom scrollTo
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !followRef.current) return;
    el.scrollTo({ top: el.scrollHeight });
    previousScrollTop.current = el.scrollTop;
  }, [bot.id, messages.length, streaming, bot.busy, follow]);

  // Expanding prepends rows: capture the height first, then after the commit
  // shift scrollTop by the growth so the message under the cursor stays put
  // (browser scroll anchoring is disabled on this container).
  const preExpandHeight = useRef<number | null>(null);
  const showEarlier = () => {
    preExpandHeight.current = scrollRef.current?.scrollHeight ?? null;
    setBottomFollow(false);
    setTranscriptWindow((w) => ({ ...w, start: expandWindowStart(w.start) }));
  };
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (preExpandHeight.current === null || !el) return;
    el.scrollTop += el.scrollHeight - preExpandHeight.current;
    preExpandHeight.current = null;
    previousScrollTop.current = el.scrollTop;
  }, [transcriptWindow.start]);

  const showLater = () => {
    setBottomFollow(false);
    const nextEnd = Math.min(messages.length, endIndex + TRANSCRIPT_WINDOW_SIZE);
    setTranscriptWindow((w) => ({ ...w, end: nextEnd >= messages.length ? null : nextEnd }));
  };

  // keyboard is a scroll gesture too: PageUp/Home break follow like an
  // upward wheel; the at-end onScroll check re-arms it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "PageUp" || (e.key === "Home" && !(e.target instanceof HTMLTextAreaElement))) setBottomFollow(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setBottomFollow]);

  const atEnd = () => {
    const el = scrollRef.current;
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_FOLLOW_THRESHOLD;
  };
  const jumpToLatest = () => {
    setBottomFollow(true);
    setTranscriptWindow({ key: transcriptKey, start: tailWindowStart(messages.length), end: null });
    requestAnimationFrame(() => {
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: reduced ? "auto" : "smooth" });
    });
  };

  const returnToLatest = async () => {
    setReturningLatest(true);
    setBottomFollow(true);
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

  useEffect(() => { setFileViewer(null); }, [bot.id]);

  const resolveFile = useCallback(async (endpoint: string, path?: string) => {
    try {
      const body = await api(endpoint, { method: "POST", ...(path !== undefined ? { body: JSON.stringify({ path }) } : {}) });
      setFileViewer(checkedFileCapability(body.file));
    } catch (error) {
      dispatch({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [dispatch]);
  const openPath = useCallback((path: string) => void resolveFile(`/api/bots/${encodeURIComponent(bot.id)}/files/resolve`, path), [bot.id, resolveFile]);
  const openAttachment = useCallback((id: string) => void resolveFile(`/api/attachments/${encodeURIComponent(id)}/files/resolve`), [resolveFile]);

  const first = bot.messages[0];

  return (
    <main className="relative flex h-full min-w-0 flex-1 flex-col bg-app">
      <div className="flex items-center justify-between px-5 py-3">
        <button onClick={() => dispatch({ type: "toggleSettings" })} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1 hover:bg-raised/50" title="Bot settings">
          <CumeaAvatar avatar={avatarForBot(bot)} expression={expressionForBot(bot)} size={28} motion={mascotMotion?.kind ?? "none"} motionKey={mascotMotion?.nonce ?? 0} state={avatarStateForBot(bot)} label={`${bot.name} avatar`} ambient />
          <span className="text-[15px] font-semibold text-ink">{bot.name}</span>
          {bot.busy && <Loader2 size={14} className="animate-spin text-ink-secondary" />}
        </button>
        <div className="flex items-center gap-2">
          <button onClick={() => void exportTranscript()} disabled={exporting} className="rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-50" aria-label="Export visible transcript as Markdown" title="Export visible transcript as Markdown">
            {exporting ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
          </button>
          {bot.busy && <button onClick={() => dispatch({ type: "interrupt", botId: bot.id })} className="flex items-center gap-1.5 rounded-full border border-hairline/40 bg-raised/60 px-2.5 py-1 text-[13px] text-ink-secondary hover:bg-raised hover:text-ink" title="Stop this turn"><Square size={12} className="fill-current" />Stop</button>}
          {onToggleInspector ? <button onClick={onToggleInspector} className={cn("rounded-md p-1.5 hover:bg-raised", inspectorOpen ? "text-accent" : "text-ink-secondary hover:text-ink")} aria-label="Open local runtime inspector" title="Runtime inspector: events and raw provider diagnostics"><Bug size={18} /></button> : null}
          <button onClick={() => dispatch({ type: "toggleWork", tab: "activity" })} className={cn("rounded-md p-1.5 hover:bg-raised", state.workOpen ? "text-accent" : "text-ink-secondary hover:text-ink")} aria-label="Open work: Needs you, activity, routines, and sections" title="Work: Needs you, activity, routines, and sections"><ListChecks size={18} /></button>
          <button onClick={() => dispatch({ type: "toggleComputer" })} className={cn("rounded-md p-1.5 hover:bg-raised", state.computerOpen ? "text-accent" : "text-ink-secondary hover:text-ink")} title="Bot's computer"><Monitor size={18} /></button>
        </div>
      </div>

      {state.error && <div className="mx-auto w-full max-w-[900px] px-5"><div className="mb-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">{state.error}</div></div>}

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-5 [overflow-anchor:none]"
        onWheel={(e) => {
          if (e.deltaY < 0) setBottomFollow(false);
          else if (atEnd()) setBottomFollow(true);
        }}
        onTouchStart={(e) => { touchY.current = e.touches[0]?.clientY ?? 0; }}
        onTouchMove={(e) => {
          const y = e.touches[0]?.clientY ?? 0;
          if (y > touchY.current + 4) setBottomFollow(false);
          else if (atEnd()) setBottomFollow(true);
        }}
        onScroll={() => {
          const el = scrollRef.current;
          if (!el) return;
          const scrollTop = el.scrollTop;
          const resume = shouldResumeBottomFollow({
            following: followRef.current,
            previousScrollTop: previousScrollTop.current,
            scrollTop,
            distanceFromBottom: el.scrollHeight - scrollTop - el.clientHeight,
          });
          previousScrollTop.current = scrollTop;
          if (resume) setBottomFollow(true);
        }}
      >
        <div className="mx-auto flex max-w-[900px] flex-col gap-3 pb-4" role="log" aria-live="polite" aria-label={`Conversation with ${bot.name}`}>
          {hiddenCount > 0 && (
            <div className="flex justify-center pt-2">
              <button onClick={showEarlier} className="rounded-full border border-hairline/40 bg-panel px-3 py-1 text-[12.5px] text-ink-secondary hover:bg-raised hover:text-ink">
                Show earlier messages ({hiddenCount} more)
              </button>
            </div>
          )}
          {first && <div className="py-3 text-center text-[13px] text-ink-secondary">Today {formatTime(first.at)}</div>}
          {focus?.hasMoreAfter && <div className="sticky top-2 z-10 flex justify-center py-1"><button onClick={() => void returnToLatest()} disabled={returningLatest} className="flex items-center gap-1.5 rounded-full border border-hairline/50 bg-panel/95 px-3 py-1.5 text-[12px] font-medium text-ink shadow-sm backdrop-blur hover:bg-raised disabled:opacity-60">{returningLatest ? <Loader2 size={13} className="animate-spin" /> : <ArrowDown size={13} />}Return to latest</button></div>}
          {windowedMessages.map((m) => {
            let content: React.ReactNode = null;
            switch (m.kind) {
              case "options": content = <OptionCard botId={bot.id} message={m} />; break;
              case "activity": content = <ActivityChip message={m} />; break;
              case "screen": content = m.png ? <ScreenFrame png={m.png} mime={m.mime} /> : null; break;
              case "handoff": content = <HandoffCard message={m} />; break;
              default: content = <Bubble message={m} onOpenPath={openPath} onOpenAttachment={openAttachment} />;
            }
            if (!content) return null;
            const focused = focus?.messageId === m.id;
            return <div key={m.id} ref={focused ? focusRef : undefined} data-message-id={m.id} className={cn("scroll-my-20 rounded-2xl transition-shadow", focused && "ring-2 ring-accent/55 ring-offset-2 ring-offset-app")}>{content}</div>;
          })}
          {laterCount > 0 && (
            <div className="flex justify-center">
              <button onClick={showLater} className="rounded-full border border-hairline/40 bg-panel px-3 py-1 text-[12.5px] text-ink-secondary hover:bg-raised hover:text-ink">
                Show later messages ({laterCount} more)
              </button>
            </div>
          )}
          {provisioning && <div className="flex justify-start"><div className="flex items-center gap-2 rounded-full border border-hairline/40 bg-panel px-3 py-1.5 text-[13px] text-ink-secondary"><Loader2 size={13} className="animate-spin" />Setting up this bot's computer…</div></div>}
          {streaming ? <StreamingBubble text={streaming} onOpenPath={openPath} /> : bot.busy && <div className="flex justify-start"><div className="flex items-center gap-1.5 rounded-2xl bg-raised px-4 py-3"><span className="size-1.5 animate-bounce rounded-full bg-ink-secondary [animation-delay:0ms]" /><span className="size-1.5 animate-bounce rounded-full bg-ink-secondary [animation-delay:150ms]" /><span className="size-1.5 animate-bounce rounded-full bg-ink-secondary [animation-delay:300ms]" /></div></div>}
        </div>
      </div>

      {!follow && (
        <button onClick={jumpToLatest} aria-label="Jump to latest messages" className="absolute bottom-24 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-hairline/40 bg-panel px-3 py-1.5 text-[12.5px] font-medium text-ink shadow-lg backdrop-blur hover:bg-raised">
          <ArrowDown size={13} />Jump to latest
        </button>
      )}

      <Composer bot={bot} />
      {fileViewer && <FileViewer file={fileViewer} onClose={() => setFileViewer(null)} />}
    </main>
  );
}
