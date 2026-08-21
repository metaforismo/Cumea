import { RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

const FLOW_IDS = new Set([
  "provider.cli.claude", "provider.cli.codex", "provider.cli.gemini", "provider.cli.grok",
  "provider.cli.custom-acp", "provider.api.xai", "provider.config.unknown", "service.box",
  "service.composio", "service.expo-push", "device.paired-mobile", "process.local-mcp", "vm.local-cua",
]);
const DESTINATIONS = new Set(["local_process", "ai_provider", "cloud_service", "paired_device", "local_vm"]);
const DATA_CATEGORIES = new Set(["prompts", "transcripts", "files", "screenshots", "tool_args", "notification_metadata"]);
const ROW_KEYS = ["available", "caveat", "consent", "dataCategories", "destinationCategory", "destinationName", "enabled", "id", "storageBoundary", "trigger"];

export interface PrivacyFlowRow {
  id: string;
  enabled: boolean;
  available: boolean;
  destinationCategory: string;
  destinationName: string;
  dataCategories: string[];
  trigger: string;
  consent: string;
  storageBoundary: string;
  caveat: string | null;
}

export interface PrivacyInventory { version: 1; rows: PrivacyFlowRow[] }

function safeCopy(value: unknown, nullable = false): value is string | null {
  return (nullable && value === null) || (typeof value === "string" && value.length > 0 && value.length <= 500 && !/[\u0000-\u001f\u007f]/.test(value));
}

export function decodePrivacyInventory(value: unknown): PrivacyInventory {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Privacy inventory is unavailable.");
  const document = value as Record<string, unknown>;
  if (document.version !== 1 || !Array.isArray(document.rows) || document.rows.length !== FLOW_IDS.size) throw new Error("Privacy inventory is unavailable.");
  const ids = new Set<string>();
  const rows = document.rows.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("Privacy inventory is unavailable.");
    const row = candidate as Record<string, unknown>;
    if (Object.keys(row).sort().join("\0") !== ROW_KEYS.join("\0") ||
      typeof row.id !== "string" || !FLOW_IDS.has(row.id) || ids.has(row.id) ||
      typeof row.enabled !== "boolean" || typeof row.available !== "boolean" ||
      typeof row.destinationCategory !== "string" || !DESTINATIONS.has(row.destinationCategory) ||
      !safeCopy(row.destinationName) || !safeCopy(row.trigger) || !safeCopy(row.consent) || !safeCopy(row.storageBoundary) || !safeCopy(row.caveat, true) ||
      !Array.isArray(row.dataCategories) || row.dataCategories.length < 1 || row.dataCategories.length > DATA_CATEGORIES.size ||
      row.dataCategories.some((category) => typeof category !== "string" || !DATA_CATEGORIES.has(category)) ||
      new Set(row.dataCategories).size !== row.dataCategories.length) {
      throw new Error("Privacy inventory is unavailable.");
    }
    ids.add(row.id);
    return row as unknown as PrivacyFlowRow;
  });
  if (ids.size !== FLOW_IDS.size) throw new Error("Privacy inventory is unavailable.");
  return { version: 1, rows };
}

const categoryLabels: Record<string, string> = {
  local_process: "Local process",
  ai_provider: "AI provider",
  cloud_service: "Cloud service",
  paired_device: "Paired device",
  local_vm: "Local VM",
};

const dataLabels: Record<string, string> = {
  prompts: "Prompt & system context",
  transcripts: "Transcript context",
  files: "Files or file contents",
  screenshots: "Screenshots",
  tool_args: "Tool arguments",
  notification_metadata: "Notification metadata",
};

export function privacyFlowStatus(row: Pick<PrivacyFlowRow, "enabled" | "available">) {
  if (row.enabled && row.available) return { label: "Enabled", className: "bg-success/10 text-success" };
  if (row.enabled) return { label: "Enabled · unavailable", className: "bg-warning/10 text-warning" };
  if (row.available) return { label: "Available · off", className: "bg-raised text-ink-secondary" };
  return { label: "Not available", className: "bg-inset text-ink-secondary" };
}

export function PrivacyDataFlows() {
  const [inventory, setInventory] = useState<PrivacyInventory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/privacy/data-flows");
      if (!response.ok) throw new Error("Privacy inventory is unavailable.");
      setInventory(decodePrivacyInventory(await response.json()));
    } catch (cause) {
      setInventory(null);
      setError(cause instanceof Error ? cause.message : "Privacy inventory is unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <section aria-labelledby="privacy-data-flow-title">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2"><ShieldCheck size={17} className="text-ink-secondary" aria-hidden="true" /><h3 id="privacy-data-flow-title" className="text-[14px] font-semibold text-ink">Where data can go</h3></div>
          <p className="mt-1 max-w-[650px] text-[12px] leading-5 text-ink-secondary">Live host status, not a promise that all processing is local. “Available” means local prerequisites are detected; it does not verify a third party's network or account. “Enabled” means configuration or device state permits use.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="settings-secondary shrink-0" aria-label="Refresh privacy data flows">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} aria-hidden="true" /> Refresh
        </button>
      </div>

      <div aria-live="polite" className="mt-4">
        {loading && !inventory ? <div className="settings-card text-[12px] text-ink-secondary">Checking current integrations…</div> : null}
        {error ? <div role="alert" className="settings-card border-danger/30 text-[12px] text-danger">{error}</div> : null}
        {inventory ? (
          <div className="grid gap-2">
            {inventory.rows.map((row) => {
              const state = privacyFlowStatus(row);
              return (
                <details key={row.id} className="settings-card group p-0">
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-border">
                    <span className={`size-2 shrink-0 rounded-full ${row.enabled && row.available ? "bg-success" : row.enabled ? "bg-warning" : "bg-ink-secondary/25"}`} aria-hidden="true" />
                    <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium text-ink">{row.destinationName}</span><span className="mt-0.5 block text-[10.5px] uppercase tracking-[0.08em] text-ink-secondary">{categoryLabels[row.destinationCategory]}</span></span>
                    <span className={`rounded-full px-2 py-1 text-[10.5px] font-medium ${state.className}`}>{state.label}</span>
                  </summary>
                  <div className="border-t border-hairline/30 px-4 py-3 text-[11.5px] leading-5 text-ink-secondary">
                    <div className="flex flex-wrap gap-1.5">{row.dataCategories.map((category) => <span key={category} className="rounded-md bg-inset px-2 py-0.5 text-[10.5px] text-ink">{dataLabels[category]}</span>)}</div>
                    <dl className="mt-3 grid gap-2">
                      <div><dt className="font-medium text-ink">Trigger</dt><dd>{row.trigger}</dd></div>
                      <div><dt className="font-medium text-ink">Consent</dt><dd>{row.consent}</dd></div>
                      <div><dt className="font-medium text-ink">Storage boundary</dt><dd>{row.storageBoundary}</dd></div>
                      {row.caveat ? <div><dt className="font-medium text-ink">What Cumea cannot guarantee</dt><dd>{row.caveat}</dd></div> : null}
                    </dl>
                  </div>
                </details>
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}
