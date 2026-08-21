import { Container, Copy, ExternalLink, Loader2, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { openExternalUrl } from "@/lib/external-url";
import { api } from "@/state/store";

type LocalVmAction = "pull" | "run" | "start" | "stop" | "remove";

interface LocalVmStatus {
  runtime: "docker" | "podman" | "container" | null;
  available: string[];
  daemonUp: boolean;
  image: boolean;
  imageMatches: boolean;
  managed: boolean;
  container: "running" | "stopped" | "missing";
  network: "loopback" | "unsafe" | "unknown";
  security: "hardened" | "unsafe" | "unknown";
  desktopReady: boolean;
  ready: boolean;
  problem: string | null;
  driverVersion: string;
  viewerUrl: string;
  commands: Record<string, string | null>;
}

function CommandHint({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2 flex min-w-0 items-center gap-2 rounded-lg bg-inset px-3 py-2">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[10.5px] text-ink-secondary">{value}</code>
      <button
        type="button"
        onClick={() => void navigator.clipboard.writeText(value).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1200); })}
        className="shrink-0 rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink"
        aria-label="Copy setup command"
      >
        {copied ? <span className="text-[9px]">Copied</span> : <Copy size={13} />}
      </button>
    </div>
  );
}

export function LocalVmSection() {
  const [status, setStatus] = useState<LocalVmStatus | null>(null);
  const [pending, setPending] = useState<LocalVmAction | "refresh" | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setPending("refresh");
    setError(null);
    try {
      setStatus(await api("/api/local-vm"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPending(null);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (action: LocalVmAction) => {
    if (action === "remove" && !confirmingRemove) {
      setConfirmingRemove(true);
      return;
    }
    setPending(action);
    setError(null);
    try {
      setStatus(await api(`/api/local-vm/${action}`, { method: "POST", body: "{}" }));
      setConfirmingRemove(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPending(null);
    }
  };

  const action = !status?.runtime || !status.daemonUp
    ? null
    : !status.image
      ? ({ kind: "pull", label: "Prepare pinned image" } as const)
      : status.container === "missing"
        ? ({ kind: "run", label: "Create Local VM" } as const)
        : status.container === "stopped" && status.imageMatches && status.managed && status.network === "loopback" && status.security === "hardened"
          ? ({ kind: "start", label: "Start Local VM" } as const)
          : null;

  return (
    <section className="settings-card mt-4" aria-labelledby="local-vm-title">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-raised text-ink-secondary"><Container size={18} /></span>
        <span className="min-w-0 flex-1">
          <span id="local-vm-title" className="block text-[14px] font-medium text-ink">Local VM · optional</span>
          <span className="mt-1 block text-[12px] leading-5 text-ink-secondary">
            A shared Linux desktop on this host, driven by official Cua tools. It is isolated from your personal desktop and limited to one agent at a time.
          </span>
        </span>
        <button type="button" onClick={() => void load()} disabled={pending !== null} className="settings-icon-button" aria-label="Refresh Local VM status">
          <RefreshCw size={15} className={pending === "refresh" ? "animate-spin" : ""} />
        </button>
      </div>

      {status ? (
        <div className="mt-4">
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-lg bg-inset px-3 py-2"><span className="text-ink-secondary">Runtime</span><span className="ml-2 font-medium text-ink">{status.runtime ?? "Not found"}</span></div>
            <div className="rounded-lg bg-inset px-3 py-2"><span className="text-ink-secondary">Desktop</span><span className={`ml-2 font-medium ${status.ready ? "text-success" : "text-ink"}`}>{status.ready ? "Ready" : status.container}</span></div>
          </div>
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-hairline/35 bg-inset px-3 py-2.5">
            <ShieldCheck size={14} className={status.network === "loopback" && status.security === "hardened" ? "mt-0.5 text-success" : "mt-0.5 text-ink-secondary"} />
            <p className="text-[11px] leading-4 text-ink-secondary">
              {status.ready
                ? `Cua ${status.driverVersion}; loopback-only viewer; 4 GB RAM, 2 CPU and bounded process/capability profile.`
                : status.problem}
            </p>
          </div>

          {!status.runtime && status.commands.install ? <CommandHint value={status.commands.install} /> : null}
          {status.runtime && !status.daemonUp && status.commands.runtimeStart ? <CommandHint value={status.commands.runtimeStart} /> : null}

          <div className="mt-3 flex flex-wrap gap-2">
            {action ? (
              <button type="button" disabled={pending !== null} onClick={() => void act(action.kind)} className="settings-primary">
                {pending === action.kind ? <Loader2 size={14} className="animate-spin" /> : null}{pending === action.kind ? "Working…" : action.label}
              </button>
            ) : null}
            {status.ready ? (
              <>
                <button type="button" onClick={() => openExternalUrl(status.viewerUrl)} className="settings-primary"><ExternalLink size={14} /> Open desktop</button>
                <button type="button" disabled={pending !== null} onClick={() => void act("stop")} className="rounded-lg bg-raised px-3 py-2 text-[12px] text-ink hover:bg-raised-hover disabled:opacity-40">{pending === "stop" ? "Stopping…" : "Stop"}</button>
              </>
            ) : null}
            {status.container !== "missing" ? (
              <button
                type="button"
                disabled={pending !== null}
                onClick={() => void act("remove")}
                onBlur={() => setConfirmingRemove(false)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] disabled:opacity-40 ${confirmingRemove ? "bg-danger/15 text-danger" : "bg-raised text-ink-secondary hover:text-danger"}`}
              >
                <Trash2 size={13} /> {pending === "remove" ? "Removing…" : confirmingRemove ? "Confirm remove" : "Remove"}
              </button>
            ) : null}
          </div>
          {pending === "pull" ? <p className="mt-2 text-[10.5px] leading-4 text-ink-secondary">The pinned base image and verified Cua wheel can take several minutes to download and build.</p> : null}
        </div>
      ) : pending === "refresh" ? <div className="mt-4 flex items-center gap-2 text-[12px] text-ink-secondary"><Loader2 size={14} className="animate-spin" /> Checking runtimes…</div> : null}

      {error ? <p role="alert" className="mt-3 text-[11.5px] text-danger">{error}</p> : null}
      <p className="mt-3 text-[10.5px] leading-4 text-ink-secondary">Preparing or removing the VM is always a user action. Cumea never installs a container runtime or exposes the viewer beyond loopback.</p>
    </section>
  );
}
