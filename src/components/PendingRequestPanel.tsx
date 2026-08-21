import { useEffect, useId, useRef, useState } from "react";
import { Loader2, ShieldAlert, Square } from "lucide-react";
import type { PendingRequest } from "@/lib/pending-requests";
import { cn } from "@/lib/cn";

interface PendingRequestPanelProps {
  botName: string;
  request: PendingRequest;
  count: number;
  busy: boolean;
  onAnswer(answer: string): Promise<void>;
  onStop(): void;
}

function optionStyle(option: string, requestType: PendingRequest["requestType"]): string {
  if (requestType !== "permission") return "border-hairline/50 bg-card text-ink hover:bg-raised";
  if (option === "Allow once" || option === "Allow") return "border-ink bg-ink font-medium text-app hover:brightness-110";
  if (option === "Never" || option === "Deny" || option === "Deny once") return "border-danger/40 text-danger hover:bg-danger/10";
  return "border-hairline/50 bg-card text-ink hover:bg-raised";
}

export function PendingRequestPanel({
  botName,
  request,
  count,
  busy,
  onAnswer,
  onStop,
}: PendingRequestPanelProps) {
  const card = request.message.card!;
  const headingId = useId();
  const detailId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [custom, setCustom] = useState("");
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    setCustom("");
    setSubmitting(null);
    setError(false);
    // Focus only when ownership moves to a different request. Re-renders from
    // streaming or workspace updates must not repeatedly steal keyboard focus.
    headingRef.current?.focus({ preventScroll: true });
  }, [request.message.id]);

  const answer = async (value: string) => {
    const choice = value.trim();
    if (!choice || submitting) return;
    setSubmitting(choice);
    setError(false);
    try {
      await onAnswer(choice);
    } catch {
      // Keep the exact decision controls available. Store/server errors may
      // contain provider detail, so the focused surface uses bounded copy.
      setError(true);
      setSubmitting(null);
    }
  };

  const permission = request.requestType === "permission";
  return (
    <section
      role="region"
      aria-labelledby={headingId}
      aria-describedby={detailId}
      aria-busy={submitting !== null}
      className="overflow-hidden rounded-2xl border border-warning/35 bg-panel shadow-lg shadow-black/15"
    >
      <div className="flex min-w-0 items-start gap-3 border-b border-hairline/35 px-4 py-3.5 sm:px-5">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-warning/12 text-warning">
          <ShieldAlert size={16} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2
              ref={headingRef}
              id={headingId}
              tabIndex={-1}
              className="text-[14px] font-semibold text-ink outline-none"
            >
              {permission ? `${botName} needs approval` : `${botName} needs your answer`}
            </h2>
            <span className="rounded-full bg-raised px-2 py-0.5 text-[10px] font-medium tabular-nums text-ink-secondary">
              1 of {count}
            </span>
          </div>
          <p className="mt-1 text-[12px] leading-4 text-ink-secondary">
            {permission ? "Review this action before work can continue." : "This task is paused until you respond."}
          </p>
        </div>
        {card.tool ? (
          <code className="max-w-24 shrink-0 truncate rounded-md bg-inset px-2 py-1 text-[10px] text-ink-secondary sm:max-w-40">
            {card.tool}
          </code>
        ) : null}
      </div>

      <div className="px-4 py-3.5 sm:px-5">
        <div className="text-[13px] font-medium text-ink">{card.title}</div>
        <div
          id={detailId}
          className={cn(
            "mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-inset px-3 py-2.5 text-[12px] leading-[1.55] text-ink",
            permission && "font-mono",
          )}
        >
          {card.subtitle}
        </div>

        {error ? (
          <div role="alert" className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] leading-4 text-danger">
            Cumea couldn’t send this response. The request is still pending; choose again to retry.
          </div>
        ) : null}

        {card.options.length ? (
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label={permission ? "Approval choices" : "Response choices"}>
            {card.options.map((option) => (
              <button
                key={option}
                type="button"
                disabled={submitting !== null}
                onClick={() => void answer(option)}
                className={cn(
                  "flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-center text-[13px] transition-[background-color,filter,opacity] disabled:cursor-wait disabled:opacity-45",
                  optionStyle(option, request.requestType),
                )}
              >
                {submitting === option ? <Loader2 size={14} className="shrink-0 animate-spin" aria-hidden="true" /> : null}
                <span className="break-words">{option}</span>
              </button>
            ))}
          </div>
        ) : null}

        {!permission ? (
          <form
            className="mt-3 flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              void answer(custom);
            }}
          >
            <label className="sr-only" htmlFor={`${headingId}-custom`}>Your answer</label>
            <input
              id={`${headingId}-custom`}
              value={custom}
              maxLength={4_000}
              disabled={submitting !== null}
              onChange={(event) => setCustom(event.target.value)}
              placeholder="Type your answer"
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-hairline/50 bg-inset px-3 text-[15px] text-ink outline-none placeholder:text-ink-secondary focus:border-accent-border disabled:opacity-45"
            />
            <button
              type="submit"
              disabled={submitting !== null || !custom.trim()}
              className="min-h-11 rounded-xl bg-ink px-4 text-[13px] font-medium text-app disabled:cursor-not-allowed disabled:opacity-35"
            >
              {submitting === custom.trim() ? "Sending…" : "Send answer"}
            </button>
          </form>
        ) : null}

        <div className="mt-3 flex flex-col-reverse gap-2 border-t border-hairline/30 pt-3 text-[11px] text-ink-secondary sm:flex-row sm:items-center sm:justify-between">
          <p className="leading-4">Your draft and attachments are saved. Escape does not answer or dismiss this request.</p>
          {busy ? (
            <button
              type="button"
              onClick={onStop}
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl px-3 text-[12px] font-medium text-ink-secondary hover:bg-raised hover:text-ink"
            >
              <Square size={12} className="fill-current" aria-hidden="true" />
              Stop task
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
