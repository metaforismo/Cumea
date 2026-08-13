import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, FileText, Loader2, Mic, Plus, Square, X } from "lucide-react";
import { api, uploadAttachment, useStore, type AttachmentRef, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { CumeaAvatar } from "./Avatar";
import { avatarForBot } from "@/lib/mote";

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

export function Composer({ bot }: { bot: Bot }) {
  const { state, dispatch, sendMessage } = useStore();
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [caret, setCaret] = useState(0);
  const [highlight, setHighlight] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null); // Esc'd this @
  const [completedMention, setCompletedMention] = useState<{ start: number; caret: number } | null>(null);
  const [attachments, setAttachments] = useState<AttachmentRef[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const activeBotIdRef = useRef(bot.id);
  const previousBotIdRef = useRef(bot.id);
  const operationGenerationRef = useRef(0);
  const attachmentsRef = useRef<AttachmentRef[]>([]);
  const sendingRef = useRef(false);
  // what was typed before the mic went on — partials append after it
  const baseText = useRef("");

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
    setText("");
    setCaret(0);
    setDismissedAt(null);
    setCompletedMention(null);
    setAttachments([]);
    setUploading(false);
    setSending(false);
    setAttachmentError(null);
    setRecording(false);
  }, [bot.id]);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "0px";
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  }, [text]);

  const send = async () => {
    if ((!text.trim() && !attachments.length) || bot.busy || uploading || sending) return;
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
      setText((current) => (current === draftText ? "" : current));
      setAttachments((current) => {
        const next = current.filter((attachment) => !attachmentIds.has(attachment.id));
        attachmentsRef.current = next;
        return next;
      });
    }
  };

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setAttachmentError(null);
    const available = Math.max(0, 10 - attachments.length);
    const selected = [...files].slice(0, available);
    if (files.length > available) setAttachmentError("A message can include up to 10 files.");
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
    setSpeechError(null);
    const offTranscript = bridge.onSpeechTranscript((line) => {
      if (typeof line.text === "string") {
        const base = baseText.current;
        setText(base ? `${base} ${line.text}` : line.text);
      }
    });
    const offEnd = bridge.onSpeechEnd(({ code }) => {
      setRecording(false);
      if (code === 1) {
        setSpeechError(
          "Dictation needs Microphone + Speech Recognition access — System Settings → Privacy & Security.",
        );
      }
    });
    void bridge.speechStart();
    return () => {
      offTranscript();
      offEnd();
      void bridge.speechStop();
    };
  }, [recording]);

  const toggleMic = () => {
    if (!window.cumea) {
      setSpeechError("Voice input needs the desktop app — run pnpm dev:desktop.");
      return;
    }
    if (window.cumea.platform !== "darwin") {
      setSpeechError("On-device voice dictation is currently available on macOS only.");
      return;
    }
    baseText.current = text.trim();
    setRecording((r) => !r);
  };

  const hasPayload = text.trim().length > 0 || attachments.length > 0;

  return (
    <div className="px-5 pb-5 pt-2">
      {speechError && (
        <div className="mx-auto mb-2 max-w-[900px] rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
          {speechError}
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
        <div className="flex items-center gap-2 rounded-full border border-hairline/40 bg-raised/60 py-2 pl-2 pr-2">
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => void addFiles(event.target.files)}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading || sending || attachments.length >= 10 || bot.busy}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink"
          title="Attach files (25 MB each)"
          aria-label="Attach files"
        >
          {uploading ? <Loader2 size={17} className="animate-spin" /> : <Plus size={20} />}
        </button>
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          onChange={(e) => {
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
            if (files.length > 0) void addFiles(files);
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
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
            if (e.key === "Escape" && recording) setRecording(false);
          }}
          disabled={uploading || sending}
          aria-label={`Message ${bot.name}`}
          placeholder={
            recording ? "Listening…" : bot.busy ? `${bot.name} is working…` : `Message ${bot.name}`
          }
          className="max-h-40 min-h-6 w-full resize-none overflow-y-auto bg-transparent py-0.5 text-[15px] leading-5 text-ink placeholder:text-ink-secondary focus:outline-none"
        />
        {bot.busy ? (
          <button
            type="button"
            onClick={() => dispatch({ type: "interrupt", botId: bot.id })}
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink"
            title="Stop"
            aria-label={`Stop ${bot.name}`}
          >
            <Square size={14} className="fill-current" />
          </button>
        ) : hasPayload ? (
          <button
            type="button"
            onClick={() => void send()}
            disabled={uploading || sending}
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink text-app transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50"
            title={sending ? "Sending…" : "Send"}
            aria-label={sending ? "Sending message" : `Send message to ${bot.name}`}
          >
            {sending ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={17} strokeWidth={2.4} />}
          </button>
        ) : (
          <button
            type="button"
            onClick={toggleMic}
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-full",
              recording
                ? "animate-pulse bg-danger/20 text-danger"
                : "text-ink-secondary hover:bg-raised hover:text-ink",
            )}
            title={recording ? "Stop dictation (Esc)" : "Dictate"}
            aria-label={recording ? "Stop dictation" : "Start dictation"}
          >
            <Mic size={18} />
          </button>
        )}
        </div>
      </div>
    </div>
  );
}
