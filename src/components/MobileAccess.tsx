import {
  Check,
  Copy,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

import { api } from "@/state/store";

interface MobileDevice {
  id: string;
  name: string;
  createdAt: number;
  lastSeenAt: number;
  revokedAt?: number;
}

interface PairingSession {
  id: string;
  secret: string;
  hostUrl: string;
  hostName: string;
  claimUrl: string;
  expiresAt: number;
  verificationCode: string;
  pairingUri: string;
}

function relativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1_000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

export function MobileAccess() {
  const [remoteEnabled, setRemoteEnabled] = useState<boolean | null>(null);
  const [devices, setDevices] = useState<MobileDevice[]>([]);
  const [session, setSession] = useState<PairingSession | null>(null);
  const [now, setNow] = useState(Date.now());
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [health, deviceResponse] = await Promise.all([
        api("/api/health"),
        api("/api/devices"),
      ]);
      setRemoteEnabled(Boolean(health.remoteAccess));
      setDevices(Array.isArray(deviceResponse.devices) ? deviceResponse.devices : []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!session) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [session]);

  const secondsLeft = useMemo(
    () => (session ? Math.max(0, Math.ceil((session.expiresAt - now) / 1_000)) : 0),
    [now, session],
  );

  const createPairing = async () => {
    setCreating(true);
    setError(null);
    setCopied(false);
    try {
      const response = await api("/api/pairing/sessions", {
        method: "POST",
        body: JSON.stringify({}),
      });
      setNow(Date.now());
      setSession(response.session as PairingSession);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      await refresh();
    } finally {
      setCreating(false);
    }
  };

  const copyPairingLink = async () => {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(session.pairingUri);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_800);
    } catch {
      setError("Could not copy the pairing payload. Scan the QR code instead.");
    }
  };

  const revoke = async (device: MobileDevice) => {
    if (!window.confirm(`Revoke ${device.name}? It will need to pair again.`)) return;
    setError(null);
    try {
      await api(`/api/devices/${device.id}`, { method: "DELETE" });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const activeDevices = devices.filter((device) => !device.revokedAt);

  return (
    <section className="mt-4 overflow-hidden rounded-xl bg-card">
      <div className="flex items-start justify-between gap-4 p-4">
        <div>
          <div className="flex items-center gap-2 text-[15px] font-medium text-ink">
            <Smartphone size={17} aria-hidden="true" /> Mobile &amp; hosts
          </div>
          <div className="mt-1 text-[13px] leading-relaxed text-ink-secondary">
            Pair Cumea Mobile with this desktop or a VM you control. The pairing credential and Cumea orchestration stay on that host; configured providers keep their existing local or remote data boundaries.
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="rounded-lg p-2 text-ink-secondary transition-colors hover:bg-raised hover:text-ink disabled:opacity-45"
          aria-label="Refresh mobile host status"
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="border-t border-hairline/40 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[13px] text-ink">
            {remoteEnabled ? (
              <Wifi size={15} className="text-success" aria-hidden="true" />
            ) : (
              <WifiOff size={15} className="text-ink-secondary" aria-hidden="true" />
            )}
            Authenticated mobile listener
          </div>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] ${
              remoteEnabled ? "bg-success/15 text-success" : "bg-raised text-ink-secondary"
            }`}
          >
            {remoteEnabled ? "Ready" : "Off by default"}
          </span>
        </div>
        {!remoteEnabled && !loading ? (
          <div className="mt-2 text-[11px] leading-relaxed text-ink-secondary">
            Enable the separate listener with <code>CUMEA_REMOTE_ACCESS=1</code> and an HTTPS
            <code> CUMEA_REMOTE_PUBLIC_URL</code>, then restart the host. See
            <code> docs/self-hosted-mobile.md</code>. The local desktop API is never exposed.
          </div>
        ) : null}
      </div>

      {remoteEnabled ? (
        <div className="border-t border-hairline/40 p-4">
          {!session || secondsLeft === 0 ? (
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[13px] font-medium text-ink">Pair a phone</div>
                <div className="mt-0.5 text-[11px] text-ink-secondary">
                  The QR expires in five minutes and works once.
                </div>
              </div>
              <button
                type="button"
                onClick={() => void createPairing()}
                disabled={creating}
                className="flex min-h-9 items-center gap-2 rounded-lg bg-ink px-3 py-2 text-[12px] font-medium text-app transition-transform duration-150 active:scale-[0.97] disabled:opacity-50"
              >
                {creating ? <Loader2 size={14} className="animate-spin" /> : <Smartphone size={14} />}
                {session ? "New code" : "Create pairing"}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-[176px_1fr] gap-4">
              <div className="rounded-xl bg-white p-1.5">
                <QRCodeSVG
                  value={session.pairingUri}
                  size={164}
                  bgColor="#ffffff"
                  fgColor="#090909"
                  level="M"
                  title="Cumea mobile pairing QR code"
                />
              </div>
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-ink">Scan with Cumea Mobile</div>
                <div className="mt-1 truncate text-[11px] text-ink-secondary" title={session.hostUrl}>
                  {session.hostName} · {session.hostUrl}
                </div>
                <div className="mt-4 text-[10px] font-medium uppercase tracking-[0.1em] text-ink-secondary">
                  Verify on both screens
                </div>
                <div className="mt-1 font-mono text-[24px] font-semibold tracking-[0.16em] text-ink">
                  {formatCode(session.verificationCode)}
                </div>
                <div className="mt-1 text-[11px] text-ink-secondary">Expires in {secondsLeft}s</div>
                <button
                  type="button"
                  onClick={() => void copyPairingLink()}
                  className="mt-3 flex min-h-9 items-center gap-2 rounded-lg bg-raised px-3 py-2 text-[12px] text-ink transition-colors hover:bg-inset"
                >
                  {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                  {copied ? "Copied" : "Copy pairing payload"}
                </button>
                <div className="mt-2 text-[10px] leading-relaxed text-ink-secondary">
                  Scan inside Cumea Mobile or paste explicitly. Do not open this secret as a system link.
                </div>
              </div>
            </div>
          )}
        </div>
      ) : null}

      <div className="border-t border-hairline/40 p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[13px] font-medium text-ink">Paired devices</div>
          <div className="text-[11px] text-ink-secondary">{activeDevices.length}</div>
        </div>
        {activeDevices.length ? (
          <div className="space-y-1.5">
            {activeDevices.map((device) => (
              <div key={device.id} className="flex items-center gap-3 rounded-lg bg-inset px-3 py-2.5">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-raised text-ink-secondary">
                  <Smartphone size={15} aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-ink">{device.name}</div>
                  <div className="text-[11px] text-ink-secondary">Seen {relativeTime(device.lastSeenAt)}</div>
                </div>
                <button
                  type="button"
                  onClick={() => void revoke(device)}
                  className="rounded-md p-2 text-ink-secondary transition-colors hover:bg-danger/10 hover:text-danger"
                  aria-label={`Revoke ${device.name}`}
                  title="Revoke device"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-lg bg-inset px-3 py-2.5 text-[11px] text-ink-secondary">
            <ShieldCheck size={15} aria-hidden="true" /> No phone has access to this host.
          </div>
        )}
        {error ? <div role="alert" className="mt-3 text-[12px] leading-relaxed text-danger">{error}</div> : null}
      </div>
    </section>
  );
}
