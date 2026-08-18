import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ChevronLeft, Code2, Loader2, RefreshCw, X } from "lucide-react";

import { api, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";

interface RuntimeInspectorEntry {
  kind: "runtime";
  at: string;
  type: string;
  provider: string;
  providerInstanceId?: string;
  summary: string;
  detail: Record<string, unknown>;
}

interface NativeInspectorEntry {
  kind: "native";
  at: string;
  dir: "in" | "out";
  source: string;
  payload: unknown;
  payloadTruncated: boolean;
}

interface InspectorSnapshot {
  runtime: RuntimeInspectorEntry[];
  native: NativeInspectorEntry[];
  hasEarlier: { runtime: boolean; native: boolean };
}

type Lens = "events" | "raw";

function timeLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 16) : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function JsonBlock({ value }: { value: unknown }) {
  const text = useMemo(() => {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return "[unserializable diagnostic payload]";
    }
  }, [value]);
  return (
    <pre className="mt-2 max-h-[320px] overflow-auto rounded-lg bg-inset p-2.5 text-[11px] leading-relaxed text-ink-secondary">
      {text}
    </pre>
  );
}

function RuntimeRow({ entry }: { entry: RuntimeInspectorEntry }) {
  return (
    <details className="group rounded-xl border border-hairline/40 bg-card px-3 py-2.5">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <div className="flex items-start gap-2.5">
          <Activity size={14} className="mt-0.5 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[12px] font-medium text-ink">{entry.summary}</span>
              <span className="ml-auto shrink-0 text-[10px] text-ink-secondary">{timeLabel(entry.at)}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-ink-secondary">
              <span className="rounded bg-inset px-1.5 py-0.5">{entry.type}</span>
              <span className="rounded bg-inset px-1.5 py-0.5">{entry.providerInstanceId || entry.provider}</span>
            </div>
          </div>
        </div>
      </summary>
      <JsonBlock value={entry.detail} />
    </details>
  );
}

function NativeRow({ entry }: { entry: NativeInspectorEntry }) {
  return (
    <details className="group rounded-xl border border-hairline/40 bg-card px-3 py-2.5">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <div className="flex items-start gap-2.5">
          <Code2 size={14} className="mt-0.5 shrink-0 text-warning" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase", entry.dir === "in" ? "bg-success/10 text-success" : "bg-accent/10 text-accent")}>
                {entry.dir}
              </span>
              <span className="truncate text-[12px] font-medium text-ink">{entry.source}</span>
              <span className="ml-auto shrink-0 text-[10px] text-ink-secondary">{timeLabel(entry.at)}</span>
            </div>
            {entry.payloadTruncated ? (
              <div className="mt-1 text-[10px] text-warning">Large payload clipped for the inspector.</div>
            ) : null}
          </div>
        </div>
      </summary>
      <JsonBlock value={entry.payload} />
    </details>
  );
}

export function InspectorPanel({ bot, onClose }: { bot: Bot; onClose: () => void }) {
  const [lens, setLens] = useState<Lens>("events");
  const [snapshot, setSnapshot] = useState<InspectorSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const body = await api(`/api/bots/${encodeURIComponent(bot.id)}/inspector?limit=180`);
      setSnapshot(body.inspector as InspectorSnapshot);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [bot.id]);

  useEffect(() => {
    setSnapshot(null);
    setLoading(true);
    setError(null);
    void load();
    const timer = window.setInterval(() => void load(true), 3_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const rows = lens === "events" ? snapshot?.runtime ?? [] : snapshot?.native ?? [];
  const hasEarlier = lens === "events" ? snapshot?.hasEarlier.runtime : snapshot?.hasEarlier.native;

  return (
    <aside className="animate-panel-in flex h-full w-[440px] shrink-0 flex-col border-l border-hairline/40 bg-panel">
      <div className="flex items-center justify-between px-4 py-3">
        <button onClick={onClose} className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink" aria-label="Close inspector">
          <ChevronLeft size={18} />
        </button>
        <div className="min-w-0 text-center">
          <div className="text-[15px] font-semibold text-ink">Runtime inspector</div>
          <div className="max-w-[250px] truncate text-[10px] text-ink-secondary">{bot.name} · local diagnostics</div>
        </div>
        <button onClick={onClose} className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink" aria-label="Close inspector">
          <X size={18} />
        </button>
      </div>

      <div className="px-4 pb-3">
        <div role="tablist" aria-label="Runtime inspector lens" className="grid grid-cols-2 rounded-lg bg-inset p-1">
          {(["events", "raw"] as const).map((value) => (
            <button
              key={value}
              role="tab"
              aria-selected={lens === value}
              onClick={() => setLens(value)}
              className={cn(
                "rounded-md px-3 py-1.5 text-[12px] font-medium capitalize",
                lens === value ? "bg-raised text-ink" : "text-ink-secondary hover:text-ink",
              )}
            >
              {value === "events" ? "Events" : "Raw"}
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2 text-[10px] leading-relaxed text-ink-secondary">
          <span className="flex-1">Reads existing owner-local logs only. Raw diagnostics are never exposed to paired mobile clients.</span>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="rounded-md p-1.5 hover:bg-raised hover:text-ink disabled:opacity-50"
            aria-label="Refresh runtime inspector"
            title="Refresh"
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2.5 text-[12px] text-danger">{error}</div>
        ) : loading && !snapshot ? (
          <div className="flex h-full items-center justify-center gap-2 text-[12px] text-ink-secondary">
            <Loader2 size={14} className="animate-spin" /> Loading diagnostics…
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-hairline/40 bg-card px-3 py-4 text-center text-[12px] text-ink-secondary">
            No {lens === "events" ? "runtime events" : "native protocol records"} have been recorded for this thread yet.
          </div>
        ) : (
          <div className="space-y-2">
            {hasEarlier ? (
              <div className="rounded-lg bg-warning/10 px-2.5 py-1.5 text-[10px] text-warning">Showing only the newest bounded diagnostic window.</div>
            ) : null}
            {lens === "events"
              ? (rows as RuntimeInspectorEntry[]).map((entry, index) => <RuntimeRow key={`${entry.at}:${entry.type}:${index}`} entry={entry} />)
              : (rows as NativeInspectorEntry[]).map((entry, index) => <NativeRow key={`${entry.at}:${entry.source}:${index}`} entry={entry} />)}
          </div>
        )}
      </div>
    </aside>
  );
}
