import { useState } from "react";
import { X } from "lucide-react";
import { useStore, type Message } from "@/state/store";
import { cn } from "@/lib/cn";

const LETTERS = ["A", "B", "C", "D", "E", "F"];

export function OptionCard({
  botId,
  message,
  projectionOnly = false,
}: {
  botId: string;
  message: Message;
  projectionOnly?: boolean;
}) {
  if (projectionOnly) return <OptionCardProjection message={message} />;
  return <InteractiveOptionCard botId={botId} message={message} />;
}

export function OptionCardProjection({ message }: { message: Message }) {
  const card = message.card;
  if (!card || card.dismissed) return null;

  return (
    <div className="w-full max-w-[840px] rounded-2xl border border-hairline/40 bg-card/70 p-4" aria-label="Request in conversation history">
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[15px] font-semibold text-ink">{card.title}</div>
          <div className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-5 text-ink-secondary">
            {card.subtitle}
          </div>
          {card.tool ? <div className="mt-1 truncate font-mono text-[11px] text-ink-secondary">{card.tool}</div> : null}
        </div>
        <span className="shrink-0 rounded-full bg-raised px-2 py-1 text-[10px] font-medium text-ink-secondary">
          {card.answered ? "Answered" : "Needs you"}
        </span>
      </div>

      <div className="mt-3 overflow-hidden rounded-lg border border-hairline/30" role="list" aria-label="Request choices">
        {card.options.map((option, index) => (
          <div
            key={option}
            role="listitem"
            className={cn(
              "flex min-h-11 w-full items-center gap-3 px-3 py-2.5 text-left text-[14px] text-ink",
              index > 0 && "border-t border-hairline/30",
              card.answered === option && "bg-raised",
            )}
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-raised text-[11px] font-medium text-ink-secondary">
              {LETTERS[index] ?? index + 1}
            </span>
            <span className="min-w-0 break-words">{option}</span>
          </div>
        ))}
      </div>

      <p className="mt-3 text-[11px] leading-4 text-ink-secondary">
        {card.answered ? `Answered: ${card.answered}` : "Answer this request in the focused panel below."}
      </p>
    </div>
  );
}

function InteractiveOptionCard({ botId, message }: { botId: string; message: Message }) {
  const { answerCard, dismissCard } = useStore();
  const [custom, setCustom] = useState("");
  const [pending, setPending] = useState(false);
  const card = message.card;
  if (!card || card.dismissed) return null;

  const answer = async (text: string) => {
    if (!text.trim() || pending) return;
    setPending(true);
    try {
      await answerCard({ botId, messageId: message.id, answer: text.trim() });
    } catch {
      // The store keeps the card unresolved and presents the error banner.
    } finally {
      setPending(false);
    }
  };

  const dismiss = async () => {
    if (pending) return;
    setPending(true);
    try {
      await dismissCard({ botId, messageId: message.id });
    } catch {
      // The host did not confirm dismissal; keep Needs You visible.
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="w-full max-w-[840px] rounded-2xl border border-hairline/50 bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[16px] font-semibold text-ink">{card.title}</div>
          <div className="mt-0.5 text-[14px] text-ink-secondary">
            {card.subtitle}
          </div>
          {card.tool && <div className="mt-1 font-mono text-[11px] text-ink-secondary">{card.tool}</div>}
        </div>
        <button
          type="button"
          onClick={() => void dismiss()}
          disabled={pending}
          className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink"
          aria-label="Dismiss request"
        >
          <X size={16} />
        </button>
      </div>

      <div className="mt-3 overflow-hidden rounded-lg border border-hairline/40">
        {card.options.map((opt, i) => (
          <button
            key={opt}
            disabled={!!card.answered || pending}
            onClick={() => void answer(opt)}
            className={cn(
              "flex w-full items-center gap-3 px-3 py-3 text-left text-[15px] text-ink",
              i > 0 && "border-t border-hairline/40",
              card.answered === opt
                ? "bg-raised"
                : "hover:bg-raised/60 disabled:hover:bg-transparent",
            )}
          >
            <span className="flex size-6 items-center justify-center rounded-md bg-raised text-[12px] font-medium text-ink-secondary">
              {LETTERS[i]}
            </span>
            {opt}
          </button>
        ))}
      </div>

      {!card.answered && card.requestType !== "permission" && (
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) void answer(custom);
          }}
          disabled={pending}
          placeholder="Type your own answer"
          className="mt-3 w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2.5 text-[15px] text-ink placeholder:text-ink-secondary focus:outline-none focus:border-hairline"
        />
      )}
    </div>
  );
}
