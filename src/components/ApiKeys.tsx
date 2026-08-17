// Write-only credential rows. A packaged Electron app uses the operating-
// system credential store through a narrow IPC bridge and restarts the local
// harness with a fresh bootstrap. Browser/source mode retains the documented
// owner-only config-file fallback because no Electron credential store exists.
import { useState } from "react";
import { Check, CircleHelp, ExternalLink, Loader2, ShieldCheck, TriangleAlert } from "lucide-react";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { cn } from "@/lib/cn";
import { openExternalUrl } from "@/lib/external-url";

export type ConfigSection = "composio" | "composioApi" | "box";

const SECTIONS: Record<
  ConfigSection,
  { body: (value: string) => unknown; flag: (config: ConfigStatus) => boolean }
> = {
  composio: { body: (v) => ({ composio: { key: v } }), flag: (c) => c.composio.configured },
  composioApi: {
    body: (v) => ({ composio: { apiKey: v } }),
    flag: (c) => c.composio.apiKeyConfigured ?? false,
  },
  box: { body: (v) => ({ box: { token: v } }), flag: (c) => c.box.configured },
};

interface CredentialGuide {
  label: string;
  placeholder: string;
  docsUrl: string;
  obtain: string;
  dataFlow: string;
  warning: string;
  optional?: boolean;
}

const CREDENTIALS: Record<ConfigSection, CredentialGuide> = {
  composio: {
    label: "Composio Connect API key",
    placeholder: "Paste your Connect API key",
    docsUrl: "https://docs.composio.dev/docs/composio-connect",
    obtain: "In the Composio dashboard, open AI Clients, select a client, and copy its API key.",
    dataFlow: "Sent to connect.composio.dev when an agent discovers, connects, or uses an app.",
    warning: "Composio and each connected app have their own terms, plan limits, and possible usage charges.",
  },
  composioApi: {
    label: "Composio project API key",
    placeholder: "ak_…",
    docsUrl: "https://docs.composio.dev/reference/authenticating-to-composio",
    obtain: "In Composio, open Settings → Project Settings → API Keys. Prefer a scoped key with only the access Cumea needs.",
    dataFlow: "Sent to backend.composio.dev only to load the full connected-app catalog.",
    warning: "A default project key can have broad project access. Create and rotate it in Composio.",
    optional: true,
  },
  box: {
    label: "Cloud computer token",
    placeholder: "Token from box.ascii.dev",
    docsUrl: "https://box.ascii.dev",
    obtain: "Create or copy a token from the Box dashboard.",
    dataFlow: "Sent to box.ascii.dev only when you inspect, provision, join, or use a cloud computer.",
    warning: "Cloud-computer usage can incur charges after any trial. Check the provider's current terms before provisioning.",
  },
};

function CredentialHelp({ guide }: { guide: CredentialGuide }) {
  return (
    <details className="group relative ml-auto">
      <summary
        className="flex cursor-pointer list-none items-center rounded p-0.5 text-ink-secondary hover:bg-raised hover:text-ink [&::-webkit-details-marker]:hidden"
        aria-label={`How to configure ${guide.label}`}
      >
        <CircleHelp size={14} />
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-72 rounded-xl border border-hairline/50 bg-panel p-3 text-[12px] leading-relaxed text-ink-secondary shadow-2xl">
        <div className="font-medium text-ink">Where to get it</div>
        <div className="mt-1">{guide.obtain}</div>
        <button
          type="button"
          className="mt-2 flex items-center gap-1 text-ink underline underline-offset-2"
          onClick={() => openExternalUrl(guide.docsUrl)}
        >
          Official provider page <ExternalLink size={11} />
        </button>
        <div className="mt-3 font-medium text-ink">Where it goes</div>
        <div className="mt-1">{guide.dataFlow}</div>
        <div className="mt-2 rounded-lg bg-warning/10 px-2 py-1.5 text-warning">{guide.warning}</div>
      </div>
    </details>
  );
}

async function persistCredential(
  section: ConfigSection,
  value: string,
): Promise<ConfigStatus> {
  const desktop = window.cumea;
  const mode = desktop?.credentialStorageMode ?? "file";
  if (mode === "os") {
    const result = await desktop!.credentialSet({
      section,
      value: value.trim() || null,
    });
    return result.config as ConfigStatus;
  }
  if (mode === "blocked" || mode === "performance-fixture") {
    const status = await desktop?.credentialsStatus().catch(() => null);
    throw new Error(
      status?.reason ||
        "Secure credential storage is unavailable. Cumea will not save this key in plaintext.",
    );
  }
  return api("/api/config", {
    method: "PUT",
    body: JSON.stringify(SECTIONS[section].body(value.trim())),
  });
}

function StorageBadge() {
  const mode = window.cumea?.credentialStorageMode ?? "file";
  if (mode === "os") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded bg-success/10 px-1.5 py-0.5 text-[10px] text-success"
        title="Encrypted by the operating-system credential store"
      >
        <ShieldCheck size={10} /> OS protected
      </span>
    );
  }
  if (mode === "blocked") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning"
        title="Cumea will not fall back to plaintext storage in the packaged app"
      >
        <TriangleAlert size={10} /> Storage unavailable
      </span>
    );
  }
  return null;
}

export function ApiKeyRow({
  section,
  onSaved,
}: {
  section: ConfigSection;
  /** Called after a successful save with the section's new configured flag. */
  onSaved?: (configured: boolean) => void;
}) {
  const { state, dispatch } = useStore();
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const configured = state.config ? SECTIONS[section].flag(state.config) : false;
  const clearing = !value.trim() && configured;
  const guide = CREDENTIALS[section];

  const save = () => {
    if (saving || (!value.trim() && !configured)) return;
    setSaving(true);
    setError(null);
    persistCredential(section, value)
      .then((status) => {
        dispatch({ type: "configStatus", config: status });
        setValue("");
        onSaved?.(SECTIONS[section].flag(status));
      })
      .catch((error) => setError(error instanceof Error ? error.message : String(error)))
      .finally(() => setSaving(false));
  };

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2 text-[13px] text-ink-secondary">
        <span className={cn("size-1.5 rounded-full", configured ? "bg-success" : "bg-raised-hover")} />
        {guide.label}
        {guide.optional && <span className="rounded bg-raised px-1.5 py-0.5 text-[10px] text-ink-secondary">Optional</span>}
        {configured && <span className="text-[11px] text-success">Connected</span>}
        <StorageBadge />
        <CredentialHelp guide={guide} />
      </div>
      <div className="flex gap-2">
        <input
          type="password"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && save()}
          placeholder={configured ? "••••••••  (paste to replace)" : guide.placeholder}
          autoComplete="off"
          className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none"
        />
        <button
          onClick={save}
          disabled={saving || (!value.trim() && !configured)}
          className={cn(
            "flex w-[72px] shrink-0 items-center justify-center gap-1.5 rounded-lg py-2 text-[13px]",
            clearing
              ? "bg-raised text-danger hover:bg-raised-hover"
              : "bg-raised text-ink hover:bg-raised-hover",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
          title={clearing ? "Remove the saved key" : "Save"}
        >
          {saving ? (
            <Loader2 size={13} className="animate-spin" />
          ) : clearing ? (
            "Clear"
          ) : (
            <>
              <Check size={13} /> Save
            </>
          )}
        </button>
      </div>
      {error && <div className="mt-1 text-[12px] text-danger">{error}</div>}
    </div>
  );
}
