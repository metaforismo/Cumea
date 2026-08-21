import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Brain, FileText, Loader2, Mic, Paperclip, Plus, Square, X } from "lucide-react";
import { api, uploadAttachment, useStore, visibleMessages, type AttachmentRef, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { CumeaAvatar } from "./Avatar";
import { avatarForBot } from "@/lib/mote";
import { readComposerDraft, writeComposerDraft } from "@/lib/drafts";
import {
  LONG_PASTE_MAX_BYTES,
  pastedTextBytes,
  pastedTextFile,
  shouldAttachPastedText,
} from "@/lib/composer-paste";
import { pendingRequests } from "@/lib/pending-requests";
import { PendingRequestPanel } from "./PendingRequestPanel";

/** The active @mention query at the caret: the text between an `@` that
 * starts a word and the caret. null = no mention being typed. */
function mentionQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf("@");
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(upto[at - 1])) return null; // user@host, not a tag
  const query = upto.slice(at + 1);
  if (query.length > 24 || query.includes("@") || query.includes("\n")) return null;
  return { start: at, query };
}

async function rollbackAttachments(attachments: AttachmentRef[]) {
  await Promise.allSettled(
    attachments.map((attachment) => api(`/api/attachments/${attachment.id}`, { method: "DELETE" })),
  );
}

type SpeechIssue = {
  message: string;
  settingsPane?: "mic" | "speech";
};

function speechIssueFor(reason: string | undefined, code: number | null): SpeechIssue | null {
  switch (reason) {
    case "completed":
      return null;
    case "speech-not-authorized":
      return {
        message: "Speech Recognition access is off. Allow Cumea to transcribe dictation in System Settings.",
        settingsPane: "speech",
      };
    case "mic-failed":
      return {
        message: "Cumea couldn’t start the microphone. Check Microphone access, then try again.",
        settingsPane: "mic",
      };
    case "recognizer-unavailable":
      return { message: "Speech recognition isn’t available for the current language or device right now." };
    case "recognition-error":
      return { message: "Dictation stopped before it could finish. Check the connection and try again." };
    case "helper-unavailable":
      return { message: "The desktop speech helper is unavailable. Rebuild Cumea, then try again." };
    case "unsupported-platform":
      return { message: "Native voice dictation is currently available on macOS only." };
    default:
      return code === 0 ? null : { message: "Dictation stopped unexpectedly. Please try again." };
  }
}

export function Composer({ bot, onEditLast }: { bot: Bot; onEditLast?: () => void }) {
  const { state, dispatch, sendMessage, startContext, answerCard } = useStore();
  const [text, setText] = useState(() => readComposerDraft(bot.id));
  const [recording, setRecording] = useState(false);
  const [speechError, setSpeechError] = useState<SpeechIssue | null>(null);
  const [caret, setCaret] = useState(0);
  const [highlight, setHighlight] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null); // Esc'd this @
  const [completedMention, setCompletedMention] = useState<{ start: number; caret: number } | null>(null);
  const [attachments, setAttachments] = useState<AttachmentRef[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [limitsOpen, setLimitsOpen] = useState(false);
  const [durationMinutes, setDurationMinutes] = useState("");
  const [toolCallLimit, setToolCallLimit] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const draftTextRef = useRef(text);
  draftTextRef.current = text;
  const activeBotIdRef = useRef(bot.id);
  const previousBotIdRef = useRef(bot.id);
  const operationGenerationRef = useRef(0);
  const attachmentsRef = useRef<AttachmentRef[]>([]);
  const sendingRef = useRef(false);
  // what was typed before the mic went on — partials append after it
  const baseText = useRef("");
  const dragDepth = useRef(0);
  const addMenuRef = useRef<HTMLDivElement>(null);

  const queuedTasks = state.workspace.tasks.filter(
    (task) => task.botId === bot.id && task.source === "message" && task.status === "queued",
  );
  const requests = useMemo(
    () => pendingRequests(visibleMessages(bot)),
    [bot.activeLeafId, bot.messages],
  );
  const activeRequest = requests[0] ?? null;
  const hasPendingRequest = activeRequest !== null;

  // ── @mention picker (tag another bot; the agent reaches it via ask_bot) ──
  const mention = mentionQueryAt(text, caret);
  const candidates = useMemo(() => {
    if (!mention || mention.start === dismissedAt) return [];
    const q = mention.query.trim().toLowerCase();
    return state.bots
      .filter((b) => b.id !== bot.id && !b.hidden)
      .filter((b) => !q || b.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [mention, dismissedAt, state.bots, bot.id]);
  const pickerOpen = candidates.length > 0;

  useEffect(() => setHighlight(0), [mention?.start, mention?.query]);

  useEffect(() => {
    if (!hasPendingRequest) return;
    setRecording(false);
    setAddMenuOpen(false);
    setLimitsOpen(false);
    setDragActive(false);
    dragDepth.current = 0;
  }, [hasPendingRequest]);

  useEffect(() => {
    if (!addMenuOpen) return;
    const close = (event: PointerEvent) => {
      if (!addMenuRef.current?.contains(event.target as Node)) setAddMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAddMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [addMenuOpen]);

  useEffect(() => {
    const timer = setTimeout(() => writeComposerDraft(bot.id, text), 120);
    return () => clearTimeout(timer);
  }, [bot.id, text]);

  useEffect(() => () => writeComposerDraft(bot.id, draftTextRef.current), [bot.id]);

  const pickMention = (peer: Bot) => {
    if (!mention) return;
    const after = text.slice(caret);
    const next = `${text.slice(0, mention.start)}@${peer.name} ${after}`;
    setText(next);
    const newCaret = mention.start + peer.name.length + 2;
    setCaret(newCaret);
    // Keep this completed mention closed until the user edits inside it.
    setDismissedAt(mention.start);
    setCompletedMention({ start: mention.start, caret: newCaret });
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(newCaret, newCaret);
    });
  };

  // Run before the browser can hand control back to an upload/send promise, so
  // late results can never mutate the newly selected agent's composer.
  useLayoutEffect(() => {
    activeBotIdRef.current = bot.id;
    operationGenerationRef.current += 1;
    if (previousBotIdRef.current !== bot.id) {
      const abandoned = attachmentsRef.current;
      // A pending send owns its attachment snapshot until the host responds.
      // Otherwise these are unsent uploads and can be reclaimed immediately.
      if (abandoned.length && !sendingRef.current) void rollbackAttachments(abandoned);
    }
    previousBotIdRef.current = bot.id;
    attachmentsRef.current = [];
    sendingRef.current = false;
    const restoredDraft = readComposerDraft(bot.id);
    setText(restoredDraft);
    setCaret(restoredDraft.length);
    setDismissedAt(null);
    setCompletedMention(null);
    setAttachments([]);
    setUploading(false);
    setSending(false);
    setAttachmentError(null);
    setRecording(false);
    setAddMenuOpen(false);
  }, [bot.id]);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "0px";
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  }, [text]);

  const send = async () => {
    if (hasPendingRequest || (!text.trim() && !attachments.length) || uploading || sending) return;
    const targetBotId = bot.id;
    const generation = operationGenerationRef.current;
    const draftText = text;
    const draftAttachments = [...attachments];
    const attachmentIds = new Set(draftAttachments.map((attachment) => attachment.id));

    if (recording) setRecording(false);
    sendingRef.current = true;
    setSending(true);
    try {
      await sendMessage({
        botId: targetBotId,
        text: draftText.trim() || "Please review the attached files.",
        attachments: draftAttachments,
        budget: durationMinutes || toolCallLimit ? {
          ...(durationMinutes ? { durationMs: Number(durationMinutes) * 60_000 } : {}),
          ...(toolCallLimit ? { toolCalls: Number(toolCallLimit) } : {}),
        } : undefined,
      });
    } catch {
      // On the same agent the untouched draft remains ready to retry. If the
      // user switched agents, there is no longer a visible draft to own these
      // uploads, so reclaim them best-effort.
      if (
        activeBotIdRef.current !== targetBotId
        || operationGenerationRef.current !== generation
      ) {
        await rollbackAttachments(draftAttachments);
      }
      return;
    } finally {
      if (
        activeBotIdRef.current === targetBotId
        && operationGenerationRef.current === generation
      ) {
        sendingRef.current = false;
        setSending(false);
      }
    }

    if (
      activeBotIdRef.current === targetBotId
      && operationGenerationRef.current === generation
    ) {
      if (draftTextRef.current === draftText) {
        writeComposerDraft(targetBotId, "");
        setText("");
      }
      setAttachments((current) => {
        const next = current.filter((attachment) => !attachmentIds.has(attachment.id));
        attachmentsRef.current = next;
        return next;
      });
    }
  };

  const addFiles = async (files: FileList | File[] | null) => {
    if (hasPendingRequest || !files?.length) return;
    setAttachmentError(null);
    const incoming = [...files];
    const available = Math.max(0, 10 - attachments.length);
    const selected = incoming.slice(0, available);
    if (incoming.length > available) setAttachmentError("A message can include up to 10 files.");
    if (!selected.length) {
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    const oversized = selected.find((file) => file.size > 25 * 1024 * 1024);
    if (oversized) {
      setAttachmentError(`${oversized.name} is larger than 25 MB.`);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    const targetBotId = bot.id;
    const generation = operationGenerationRef.current;
    const uploaded: AttachmentRef[] = [];
    setUploading(true);
    try {
      // Sequential uploads let us know exactly what must be rolled back if a
      // later file fails. Promise.all loses that ownership information.
      for (const file of selected) {
        const attachment = await uploadAttachment(targetBotId, file);
        uploaded.push(attachment);
        if (
          activeBotIdRef.current !== targetBotId
          || operationGenerationRef.current !== generation
        ) {
          break;
        }
      }

      if (
        activeBotIdRef.current !== targetBotId
        || operationGenerationRef.current !== generation
        || uploaded.length !== selected.length
      ) {
        await rollbackAttachments(uploaded);
        return;
      }

      setAttachments((current) => {
        const next = [...current, ...uploaded].slice(0, 10);
        attachmentsRef.current = next;
        return next;
      });
    } catch (error) {
      await rollbackAttachments(uploaded);
      if (
        activeBotIdRef.current === targetBotId
        && operationGenerationRef.current === generation
      ) {
        setAttachmentError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (
        activeBotIdRef.current === targetBotId
        && operationGenerationRef.current === generation
      ) {
        setUploading(false);
        if (fileRef.current) fileRef.current.value = "";
      }
    }
  };

  useEffect(() => {
    const hasFiles = (event: DragEvent) => [...(event.dataTransfer?.types ?? [])].includes("Files");
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (hasPendingRequest) return;
      dragDepth.current += 1;
      setDragActive(true);
    };
    const over = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const leave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragActive(false);
    };
    const drop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth.current = 0;
      setDragActive(false);
      if (!hasPendingRequest && !uploading && !sending) void addFiles(event.dataTransfer?.files ?? null);
    };
    document.addEventListener("dragenter", enter);
    document.addEventListener("dragover", over);
    document.addEventListener("dragleave", leave);
    document.addEventListener("drop", drop);
    return () => {
      document.removeEventListener("dragenter", enter);
      document.removeEventListener("dragover", over);
      document.removeEventListener("dragleave", leave);
      document.removeEventListener("drop", drop);
    };
  }, [bot.id, attachments.length, hasPendingRequest, uploading, sending]);

  const removeAttachment = (attachment: AttachmentRef) => {
    setAttachments((current) => {
      const next = current.filter((candidate) => candidate.id !== attachment.id);
      attachmentsRef.current = next;
      return next;
    });
    api(`/api/attachments/${attachment.id}`, { method: "DELETE" }).catch(() => {});
  };

  // native dictation: partials stream into the input while the Swift
  // helper runs; the final transcript stays in the box, ready to edit/send
  useEffect(() => {
    if (!recording) return;
    const bridge = window.cumea;
    if (!bridge) {
      setRecording(false);
      return;
    }
    let cancelled = false;
    setSpeechError(null);
    const offTranscript = bridge.onSpeechTranscript((line) => {
      if (cancelled) return;
      if (typeof line.text === "string") {
        const base = baseText.current;
        setText(base ? `${base} ${line.text}` : line.text);
      }
    });
    const offEnd = bridge.onSpeechEnd(({ code, reason }) => {
      if (cancelled) return;
      setRecording(false);
      setSpeechError(speechIssueFor(reason, code));
    });
    void (async () => {
      try {
        const microphoneGranted = await bridge.permRequestMic();
        if (cancelled) return;
        if (!microphoneGranted) {
          setSpeechError({
            message: "Microphone access is off. Allow Cumea to hear dictation in System Settings.",
            settingsPane: "mic",
          });
          setRecording(false);
          return;
        }
        await bridge.speechStart();
      } catch {
        if (cancelled) return;
        setSpeechError({ message: "Cumea couldn’t start dictation. Please try again." });
        setRecording(false);
      }
    })();
    return () => {
      cancelled = true;
      offTranscript();
      offEnd();
      void bridge.speechStop();
    };
  }, [recording]);

  const toggleMic = () => {
    if (!window.cumea) {
      setSpeechError({ message: "Voice input needs the desktop app — run pnpm dev:desktop." });
      return;
    }
    if (window.cumea.platform !== "darwin") {
      setSpeechError({ message: "Native voice dictation is currently available on macOS only." });
      return;
    }
    baseText.current = text.trim();
    setRecording((r) => !r);
  };

  const hasPayload = text.trim().length > 0 || attachments.length > 0;

  if (activeRequest) {
    return (
      <div className="px-3 pb-3 pt-2 sm:px-5 sm:pb-5">
        <div className="mx-auto max-w-[900px]">
          <PendingRequestPanel
            botName={bot.name}
            request={activeRequest}
            count={requests.length}
            busy={Boolean(bot.busy)}
            onAnswer={(answer) => answerCard({ botId: bot.id, messageId: activeRequest.message.id, answer })}
            onStop={() => dispatch({ type: "interrupt", botId: bot.id })}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="px-5 pb-5 pt-2">
      {dragActive ? (
        <div className="pointer-events-none fixed inset-3 z-50 flex items-center justify-center rounded-[28px] border-2 border-dashed border-accent/60 bg-app/90 backdrop-blur-md" aria-hidden="true">
          <div className="rounded-2xl bg-raised px-5 py-3 text-[15px] font-semibold text-ink shadow-xl">Drop files to attach</div>
        </div>
      ) : null}
      {speechError && (
        <div
          role="alert"
          className="mx-auto mb-2 flex max-w-[900px] items-center gap-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning"
        >
          <span className="min-w-0 flex-1">{speechError.message}</span>
          {speechError.settingsPane && window.cumea ? (
            <button
              type="button"
              onClick={() => void window.cumea?.permOpenSettings(speechError.settingsPane!)}
              className="shrink-0 rounded-md border border-warning/30 px-2 py-1 font-medium hover:bg-warning/10"
            >
              Open Settings
            </button>
          ) : null}
        </div>
      )}
      {attachmentError && (
        <div className="mx-auto mb-2 max-w-[900px] rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
          {attachmentError}
        </div>
      )}
      <div className="relative mx-auto max-w-[900px]">
        {pickerOpen && (
          <div className="absolute bottom-full left-10 z-20 mb-2 w-72 overflow-hidden rounded-xl border border-hairline/40 bg-raised shadow-lg">
            {candidates.map((peer, i) => (
              <button
                key={peer.id}
                onClick={() => pickMention(peer)}
                onMouseEnter={() => setHighlight(i)}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left",
                  i === highlight ? "bg-raised-hover" : "",
                )}
              >
                <CumeaAvatar avatar={avatarForBot(peer)} expression={peer.mascotExpression ?? "friendly"} size={24} />
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">{peer.name}</span>
                <span className="shrink-0 text-xs text-ink-secondary">Agent</span>
              </button>
            ))}
          </div>
        )}
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2 px-2">
            {attachments.map((attachment) => (
              <div
                key={attachment.id}
                className="flex max-w-[260px] items-center gap-2 rounded-lg border border-hairline/40 bg-card px-2.5 py-1.5 text-[12px] text-ink"
              >
                <FileText size={14} className="shrink-0 text-ink-secondary" />
                <span className="truncate">{attachment.name}</span>
                <button
                  type="button"
                  onClick={() => removeAttachment(attachment)}
                  disabled={sending}
                  className="rounded p-0.5 text-ink-secondary hover:bg-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label={`Remove ${attachment.name}`}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        {limitsOpen && (
          <div className="mb-2 grid grid-cols-2 gap-2 rounded-xl border border-hairline/40 bg-card p-2.5" aria-label="Task limits">
            <label className="grid gap-1 text-[10px] text-ink-secondary">Duration (minutes)<input type="number" min={1} max={10080} step={1} value={durationMinutes} onChange={(event) => setDurationMinutes(event.target.value)} className="rounded-md bg-inset px-2 py-1.5 text-[11px] text-ink outline-none" /></label>
            <label className="grid gap-1 text-[10px] text-ink-secondary">Tool calls<input type="number" min={1} max={100000} step={1} value={toolCallLimit} onChange={(event) => setToolCallLimit(event.target.value)} className="rounded-md bg-inset px-2 py-1.5 text-[11px] text-ink outline-none" /></label>
            <div className="col-span-2 text-[10px] leading-4 text-ink-secondary">Optional limits apply to this task. Token limits activate only after canonical provider telemetry establishes a baseline.</div>
          </div>
        )}
        <div className="composer-shell flex items-end gap-1.5 rounded-[22px] border border-hairline/40 bg-raised/60 p-2">
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => void addFiles(event.target.files)}
        />
        <div ref={addMenuRef} className="relative shrink-0">
          {addMenuOpen ? (
            <div className="composer-add-menu absolute bottom-11 left-0 z-30 w-[280px] overflow-hidden rounded-[14px] border border-hairline/45 bg-panel p-1.5 shadow-2xl" role="menu" aria-label="Add to conversation">
              <button type="button" role="menuitem" onClick={() => { setAddMenuOpen(false); fileRef.current?.click(); }} disabled={uploading || sending || attachments.length >= 10} className="composer-menu-item">
                <span className="composer-menu-icon"><Paperclip size={16} /></span>
                <span className="min-w-0"><span className="block text-[13px] font-medium text-ink">Attach files</span><span className="mt-0.5 block text-[11px] text-ink-secondary">Up to 10 files, 25 MB each</span></span>
              </button>
              <button type="button" role="menuitem" onClick={() => { setAddMenuOpen(false); void startContext(bot.id, "Fresh context"); }} disabled={Boolean(bot.busy) || queuedTasks.length > 0 || hasPayload} className="composer-menu-item">
                <span className="composer-menu-icon"><Brain size={16} /></span>
                <span className="min-w-0"><span className="block text-[13px] font-medium text-ink">Start a fresh context</span><span className="mt-0.5 block text-[11px] leading-4 text-ink-secondary">Keep the agent, separate the next task’s context</span></span>
              </button>
              <button type="button" role="menuitem" onClick={() => { setAddMenuOpen(false); setLimitsOpen((open) => !open); }} className="composer-menu-item">
                <span className="composer-menu-icon"><Square size={14} /></span>
                <span className="min-w-0"><span className="block text-[13px] font-medium text-ink">Task limits</span><span className="mt-0.5 block text-[11px] text-ink-secondary">Bound duration and tool use</span></span>
              </button>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => setAddMenuOpen((open) => !open)}
            disabled={uploading || sending}
            className="composer-icon-button"
            title="Add files or start a fresh context"
            aria-label="Add files or start a fresh context"
            aria-expanded={addMenuOpen}
          >
            {uploading ? <Loader2 size={17} className="animate-spin" /> : <Plus size={20} />}
          </button>
        </div>
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          onChange={(e) => {
            if (recording) setRecording(false);
            setText(e.target.value);
            const nextCaret = e.target.selectionStart ?? e.target.value.length;
            setCaret(nextCaret);
            const editingCompletedMention = completedMention
              && nextCaret <= completedMention.caret
              && nextCaret >= completedMention.start;
            if (editingCompletedMention) {
              setDismissedAt(null);
              setCompletedMention(null);
            }
          }}
          onPaste={(event) => {
            const files = event.clipboardData.files;
            if (files.length > 0) {
              // Rich clipboard providers can expose both a file and its name
              // as text. Own the paste when files are present so the composer
              // never inserts a duplicate filename beside the attachment.
              event.preventDefault();
              void addFiles(files);
              return;
            }
            const pasted = event.clipboardData.getData("text/plain");
            if (
              shouldAttachPastedText(pasted)
              && attachments.length < 10
              && !uploading
              && !sending
            ) {
              event.preventDefault();
              if (pastedTextBytes(pasted) > LONG_PASTE_MAX_BYTES) {
                setAttachmentError("Pasted text is larger than 5 MB. Save it as a file and attach it instead.");
                return;
              }
              const ordinal = attachments.filter((attachment) => attachment.name.startsWith("pasted-text")).length + 1;
              void addFiles([pastedTextFile(pasted, ordinal)]);
            }
          }}
          onKeyUp={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
          onClick={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
          onKeyDown={(e) => {
            if (pickerOpen) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const delta = e.key === "ArrowDown" ? 1 : -1;
                setHighlight((h) => (h + delta + candidates.length) % candidates.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                pickMention(candidates[highlight]);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setDismissedAt(mention?.start ?? null);
                return;
              }
            }
            if (
              e.key === "ArrowUp"
              && !text
              && attachments.length === 0
              && !uploading
              && !sending
              && !bot.busy
              && onEditLast
            ) {
              e.preventDefault();
              onEditLast();
              return;
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
            if (e.key === "Escape" && recording) setRecording(false);
          }}
          disabled={uploading || sending}
          aria-label={`Message ${bot.name}`}
          placeholder={
            recording ? "Listening…" : bot.busy ? `Queue another task for ${bot.name}` : `Message ${bot.name}`
          }
          className="composer-input max-h-40 min-h-8 w-full resize-none overflow-y-auto bg-transparent px-1.5 py-1.5 text-[15px] leading-5 text-ink placeholder:text-ink-secondary/80 outline-none"
        />
        {hasPayload ? (
          <button
            type="button"
            onClick={() => void send()}
            disabled={uploading || sending}
            className="composer-send-button"
            title={sending ? "Sending…" : bot.busy ? "Add to queue" : "Send"}
            aria-label={sending ? "Sending message" : bot.busy ? `Queue message for ${bot.name}` : `Send message to ${bot.name}`}
          >
            {sending ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={17} strokeWidth={2.4} />}
          </button>
        ) : null}
        <button
          type="button"
          onClick={toggleMic}
          disabled={uploading || sending}
          className={cn("composer-icon-button", recording ? "bg-danger/15 text-danger" : "")}
          title={recording ? "Stop dictation (Esc)" : "Dictate with Apple Speech"}
          aria-label={recording ? "Stop dictation" : "Start dictation"}
          aria-pressed={recording}
        >
          <Mic size={18} />
        </button>
        {bot.busy ? (
          <button
            type="button"
            onClick={() => dispatch({ type: "interrupt", botId: bot.id })}
            className="composer-stop-button"
            title="Stop the active task"
            aria-label={`Stop ${bot.name}'s active task`}
          >
            <Square size={13} className="fill-current" />
          </button>
        ) : null}
        </div>
      </div>
    </div>
  );
}
