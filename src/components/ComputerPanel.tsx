// The bot's computer, in the right-side slot. Where it runs decides the
// whole flow: cloud → provision the box on open (idempotent) and preview
// via SSE frames or a ~4s screenshot poll; local ("This Mac") → frames
// come from the Electron main process (desktopCapturer over the preload
// bridge — box endpoints are never touched); off → parked. Auto (unset)
// prefers the cloud box when one exists, else local inside the app.
import { useEffect, useRef, useState } from "react";
import {
  CalendarClock,
  ExternalLink,
  Loader2,
  Monitor,
  Moon,
  Power,
  Settings,
  X,
} from "lucide-react";
import { useStore, type Bot } from "@/state/store";
import { ApiKeyRow } from "./ApiKeys";
import { cn } from "@/lib/cn";
import { openExternalUrl } from "@/lib/external-url";

async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(path, { headers: { "content-type": "application/json" }, ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  return body;
}

type Phase =
  | "checking"
  | "unconfigured"
  | "starting"
  | "ready"
  | "vm"
  | "vm-unavailable"
  | "local"
  | "local-needs-permissions"
  | "local-unavailable"
  | "off"
  | "error";

type AutoSleepStatus = {
  enabled: boolean;
  idleMs: number | null;
  state: "off" | "idle" | "checking" | "blocked" | "sleeping" | "sleep-requested" | "error";
  deadlineAt: number | null;
};

export function ComputerPanel({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const [phase, setPhase] = useState<Phase>("checking");
  const [boxState, setBoxState] = useState<string | null>(null);
  const [polledFrame, setPolledFrame] = useState<{ png: string; mime: string } | null>(null);
  const [localFrame, setLocalFrame] = useState<string | null>(null);
  const [vmFrame, setVmFrame] = useState<string | null>(null);
  const [vmViewerUrl, setVmViewerUrl] = useState<string | null>(null);
  const [pending, setPending] = useState<"join" | "sleep" | null>(null);
  const [localPending, setLocalPending] = useState<"request" | "retry" | null>(null);
  const [localStatus, setLocalStatus] = useState<CuaPublicStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoSleep, setAutoSleep] = useState<AutoSleepStatus | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [policyPending, setPolicyPending] = useState(false);
  // bumped when a Box token is saved inline, to re-run the spin-up flow
  const [retry, setRetry] = useState(0);

  // resolve the mode on open; box endpoints are only ever hit on the
  // cloud path, so local/off can never render a JSON error as an image
  useEffect(() => {
    let alive = true;
    setPhase("checking");
    setPolledFrame(null);
    setLocalFrame(null);
    setVmFrame(null);
    setVmViewerUrl(null);
    setLocalStatus(null);
    setError(null);
    const resolveLocal = async () => {
      if (!window.cumea?.cuaStatus) {
        if (alive) setPhase("local-unavailable");
        return;
      }
      try {
        const status = await window.cumea.cuaStatus();
        if (!alive) return;
        setLocalStatus(status);
        if (status.state === "ready") setPhase("local");
        else if (status.state === "needs-permissions") setPhase("local-needs-permissions");
        else {
          setError(status.reason);
          setPhase("local-unavailable");
        }
      } catch (cause) {
        if (!alive) return;
        setError(cause instanceof Error ? cause.message : "Could not check local computer status");
        setPhase("local-unavailable");
      }
    };
    if (bot.computer === "off") {
      setPhase("off");
      return;
    }
    if (bot.computer === "local") {
      void resolveLocal();
      return () => {
        alive = false;
      };
    }
    if (bot.computer === "vm") {
      void api("/api/local-vm")
        .then((status) => {
          if (!alive) return;
          setVmViewerUrl(typeof status.viewerUrl === "string" ? status.viewerUrl : null);
          if (status.ready) setPhase("vm");
          else {
            setError(status.problem ?? "The Local VM is not ready");
            setPhase("vm-unavailable");
          }
        })
        .catch((cause) => {
          if (!alive) return;
          setError(cause instanceof Error ? cause.message : "Could not check the Local VM");
          setPhase("vm-unavailable");
        });
      return () => { alive = false; };
    }
    // cloud, or auto (cloud box wins when one exists, else local in-app)
    api(`/api/bots/${bot.id}/computer`)
      .then((status) => {
        if (!alive) return;
        const autoLocal = bot.computer !== "cloud" && Boolean(window.cumea?.cuaStatus);
        if (!status.configured) {
          if (autoLocal) return resolveLocal();
          setPhase("unconfigured");
          return;
        }
        if (!status.box && autoLocal) {
          return resolveLocal();
        }
        setAutoSleep(status.autoSleep ?? null);
        setPhase("starting");
        return api(`/api/bots/${bot.id}/computer/provision`, { method: "POST" }).then((r) => {
          if (!alive) return;
          setBoxState(r.state ?? null);
          setPhase("ready");
        });
      })
      .catch((e) => {
        if (!alive) return;
        setError(e.message);
        setPhase("error");
      });
    return () => {
      alive = false;
    };
  }, [bot.id, bot.computer, retry]);

  // cloud preview: SSE frames win while the bot works; otherwise poll
  const live = state.screens[bot.id];
  const sseFlowing = Boolean(bot.busy && live);
  const inFlight = useRef(false);
  useEffect(() => {
    if (phase !== "ready" || sseFlowing) return;
    let alive = true;
    const shoot = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const { png, format, autoSleep: policy } = await api(`/api/bots/${bot.id}/computer/screenshot`, { method: "POST" });
        if (alive && policy) setAutoSleep(policy);
        if (alive) setPolledFrame({ png, mime: format === "jpeg" ? "image/jpeg" : "image/png" });
      } catch {
        /* box mid-command or asleep — next tick */
      } finally {
        inFlight.current = false;
      }
    };
    void shoot();
    const timer = setInterval(shoot, 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [phase, sseFlowing, bot.id]);

  // The deadline is host-owned. The client only renders an approximate local
  // countdown; screenshot responses carry refreshed policy state without an
  // additional provider-status polling loop.
  useEffect(() => {
    if (phase !== "ready" || bot.computer !== "cloud") return;
    const clockTimer = setInterval(() => setClockNow(Date.now()), 1_000);
    return () => clearInterval(clockTimer);
  }, [phase, bot.id, bot.computer]);

  // local preview: frames from the Electron main process. The FIRST capture
  // attempt is what makes macOS show the Screen Recording prompt (there is
  // no reliable pre-grant flow on macOS 15+), so repeated empty frames mean
  // the user denied — surface the Settings repair path instead of spinning.
  const [localMisses, setLocalMisses] = useState(0);
  useEffect(() => {
    if (phase !== "local" || !window.cumea) return;
    let alive = true;
    setLocalMisses(0);
    const shoot = async () => {
      try {
        const url = await window.cumea!.screenFrame();
        if (alive && url) setLocalFrame(url);
        else if (alive) setLocalMisses((n) => n + 1);
      } catch {
        if (alive) setLocalMisses((n) => n + 1);
      }
    };
    void shoot();
    const timer = setInterval(shoot, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [phase]);

  // Local VM preview: the host asks the official Cua driver in the isolated
  // desktop for one complete frame. Live SSE frames still win during a turn.
  useEffect(() => {
    if (phase !== "vm" || sseFlowing) return;
    let alive = true;
    const shoot = async () => {
      try {
        const { image } = await api("/api/local-vm/screenshot", { method: "POST", body: "{}" });
        if (alive && typeof image === "string" && /^data:image\/(?:png|jpeg);base64,/.test(image)) setVmFrame(image);
      } catch {
        // The desktop can be between frames; the next bounded poll retries.
      }
    };
    void shoot();
    const timer = setInterval(shoot, 4000);
    return () => { alive = false; clearInterval(timer); };
  }, [phase, sseFlowing]);

  const lastScreenMessage = [...bot.messages].reverse().find((m) => m.kind === "screen" && m.png);
  const cloudFrame =
    live ??
    polledFrame ??
    (lastScreenMessage ? { png: lastScreenMessage.png!, mime: lastScreenMessage.mime ?? "image/png" } : null);
  const frameSrc =
    phase === "local"
      ? localFrame
      : phase === "vm"
        ? (live ? `data:${live.mime};base64,${live.png}` : vmFrame ?? (cloudFrame && `data:${cloudFrame.mime};base64,${cloudFrame.png}`))
      : phase === "ready" || phase === "starting"
        ? cloudFrame && `data:${cloudFrame.mime};base64,${cloudFrame.png}`
        : null;

  const run = (kind: "join" | "sleep") => {
    setPending(kind);
    setError(null);
    api(`/api/bots/${bot.id}/computer/${kind}`, { method: "POST" })
      .then((result) => {
        // the join URL's stream token rotates — always freshly minted, never cached
        if (kind === "join" && result.joinUrl && !openExternalUrl(result.joinUrl)) {
          throw new Error("The computer URL was blocked because it is not a trusted web URL.");
        }
        if (kind === "sleep") setBoxState("sleep-requested");
        if (result.autoSleep) setAutoSleep(result.autoSleep);
      })
      .catch((e) => setError(e.message))
      .finally(() => setPending(null));
  };

  const setAutoSleepPolicy = async (minutes: false | 10 | 30 | 60) => {
    setPolicyPending(true);
    setError(null);
    try {
      await api("/api/config", {
        method: "PATCH",
        body: JSON.stringify({ box: { autoSleepMinutes: minutes } }),
      });
      const status = await api(`/api/bots/${bot.id}/computer`);
      setAutoSleep(status.autoSleep ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update auto-sleep");
    } finally {
      setPolicyPending(false);
    }
  };

  const refreshLocal = async (kind: "request" | "retry") => {
    const bridge = window.cumea;
    if (!bridge) return;
    setLocalPending(kind);
    setError(null);
    try {
      const status = kind === "request" ? await bridge.cuaRequestPermissions() : await bridge.cuaRetry();
      setLocalStatus(status);
      if (status.state === "ready") setPhase("local");
      else if (status.state === "needs-permissions") setPhase("local-needs-permissions");
      else {
        setError(status.reason);
        setPhase("local-unavailable");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not refresh local computer access");
      setPhase("local-unavailable");
    } finally {
      setLocalPending(null);
    }
  };

  const emptyState: Record<Exclude<Phase, "ready" | "local" | "vm">, string> = {
    checking: "Checking…",
    starting: "Starting your bot's computer…",
    unconfigured: "No cloud computer configured",
    "local-needs-permissions": "This Mac needs permission before the local computer can start",
    "local-unavailable": localStatus?.reason ?? "Local computer control is unavailable in this environment",
    "vm-unavailable": "The Local VM needs setup before this agent can use it",
    off: "This bot's computer is off",
    error: "Couldn't reach the computer",
  };

  return (
    <aside className="animate-panel-in flex h-full w-[400px] shrink-0 flex-col border-l border-hairline/40 bg-panel">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <button
          onClick={() => dispatch({ type: "toggleSettings", open: true })}
          className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink"
          title="Bot settings"
        >
          <Settings size={18} />
        </button>
        <span className="text-[15px] font-semibold text-ink">Computer</span>
        <button
          onClick={() => dispatch({ type: "toggleComputer", open: false })}
          className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-5">
        {/* Screen preview */}
        <div className="mb-1.5 mt-2 flex items-center justify-between text-[13px] text-ink-secondary">
          <span>{bot.name}'s screen</span>
          {phase === "local" && <span className="text-[11px]">this Mac</span>}
          {phase === "vm" && <span className="text-[11px]">Local VM</span>}
        </div>
        <div className="flex aspect-[16/10] w-full items-center justify-center overflow-hidden rounded-xl bg-card">
          {frameSrc ? (
            <img src={frameSrc} alt={`${bot.name}'s screen`} className="h-full w-full object-contain" />
          ) : (
            <div className="flex flex-col items-center gap-2 px-6 text-center text-ink-secondary">
              {phase === "checking" || phase === "starting" || phase === "local" || phase === "vm" ? (
                <Loader2 size={18} className="animate-spin" />
              ) : phase === "off" ? (
                <Power size={22} />
              ) : (
                <Monitor size={22} />
              )}
              <span className="text-[12px]">
                {phase === "ready"
                  ? "Waiting for the first frame…"
                  : phase === "local"
                    ? localMisses >= 3
                      ? "No frames yet — the preview needs Screen Recording permission. After granting, relaunch the app (macOS applies it on next launch)."
                      : "Capturing this Mac's screen…"
                    : phase === "vm"
                      ? "Capturing the isolated desktop…"
                    : emptyState[phase]}
              </span>
              {phase === "local" && localMisses >= 3 && (
                <button
                  onClick={() => window.cumea?.permOpenSettings?.("screen")}
                  className="mt-1 rounded-lg bg-raised px-3 py-1.5 text-[12px] text-ink hover:bg-raised-hover"
                >
                  Open Settings
                </button>
              )}
              {phase === "local-needs-permissions" && (
                <div className="mt-1 flex flex-col items-center gap-2">
                  <div className="text-[11px] text-ink-secondary">
                    {!localStatus?.permissions?.accessibility && "Accessibility is off. "}
                    {!localStatus?.permissions?.screenRecording && "Screen Recording is off."}
                  </div>
                  <div className="flex flex-wrap justify-center gap-2">
                    <button
                      onClick={() => void refreshLocal("request")}
                      disabled={localPending !== null}
                      className="rounded-lg bg-raised px-3 py-1.5 text-[12px] text-ink hover:bg-raised-hover disabled:opacity-50"
                    >
                      {localPending === "request" ? "Requesting…" : "Enable"}
                    </button>
                    <button
                      onClick={() => void refreshLocal("retry")}
                      disabled={localPending !== null}
                      className="rounded-lg bg-raised px-3 py-1.5 text-[12px] text-ink hover:bg-raised-hover disabled:opacity-50"
                    >
                      {localPending === "retry" ? "Checking…" : "Check again"}
                    </button>
                  </div>
                  <div className="flex flex-wrap justify-center gap-2">
                    {!localStatus?.permissions?.accessibility && (
                      <button
                        onClick={() => window.cumea?.cuaOpenSettings("accessibility")}
                        className="text-[11px] text-ink-secondary underline hover:text-ink"
                      >
                        Accessibility settings
                      </button>
                    )}
                    {!localStatus?.permissions?.screenRecording && (
                      <button
                        onClick={() => window.cumea?.cuaOpenSettings("screenRecording")}
                        className="text-[11px] text-ink-secondary underline hover:text-ink"
                      >
                        Screen Recording settings
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="mt-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
            {error}
          </div>
        )}
        {phase === "unconfigured" && (
          <div className="mt-3 rounded-xl bg-card p-4">
            <div className="mb-3 text-[13px] text-ink-secondary">
              Add a third-party cloud-computer token to provision a remote desktop. Usage may incur charges;
              the help icon explains where the token goes before you save it.
            </div>
            <ApiKeyRow
              section="box"
              onSaved={(configured) => configured && setRetry((n) => n + 1)}
            />
          </div>
        )}

        {phase === "vm-unavailable" && (
          <button
            type="button"
            onClick={() => dispatch({ type: "toggleAppSettings", open: true, tab: "connections" })}
            className="mt-3 w-full rounded-lg bg-raised py-2 text-[12px] text-ink hover:bg-raised-hover"
          >
            Open Local VM setup
          </button>
        )}

        {phase === "vm" && vmViewerUrl ? (
          <button
            type="button"
            onClick={() => {
              if (!openExternalUrl(vmViewerUrl)) setError("The Local VM viewer URL was blocked.");
            }}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-raised py-2 text-[13px] text-ink hover:bg-raised-hover"
          >
            <ExternalLink size={14} /> Open Local VM desktop
          </button>
        ) : null}

        {/* Cloud-only actions */}
        {phase === "ready" && (
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => run("join")}
              disabled={pending === "join"}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-raised py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50"
            >
              {pending === "join" ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
              Open desktop
            </button>
            {boxState !== "archived" && boxState !== "sleep-requested" && (
              <button
                onClick={() => run("sleep")}
                disabled={pending === "sleep"}
                className="flex items-center justify-center gap-2 rounded-lg bg-raised px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50"
                title="Put the computer to sleep"
              >
                {pending === "sleep" ? <Loader2 size={14} className="animate-spin" /> : <Moon size={14} />}
                Sleep
              </button>
            )}
          </div>
        )}

        {phase === "ready" && bot.computer === "cloud" && autoSleep && (
          <div className="mt-3 rounded-xl border border-hairline/40 bg-card px-3 py-2.5" aria-live="polite">
            <div className="text-[12px] font-medium text-ink">Cloud cost guard</div>
            <div className="mt-0.5 text-[11px] leading-4 text-ink-secondary">
              {!autoSleep.enabled || autoSleep.state === "off"
                ? "Auto-sleep is off in this host's configuration."
                : autoSleep.state === "sleep-requested"
                  ? "The provider accepted the sleep request. Current archive state has not been re-checked yet."
                  : autoSleep.state === "error"
                    ? "The sleep request could not be confirmed. It will only retry after new computer activity."
                    : autoSleep.state === "sleeping"
                      ? "Requesting sleep from the provider…"
                      : autoSleep.state === "checking" || autoSleep.state === "blocked"
                        ? "Waiting for active work and previews to finish before requesting sleep."
                        : autoSleep.deadlineAt
                          ? `A sleep request is scheduled after ${Math.round((autoSleep.idleMs ?? 0) / 60_000)} minutes of inactivity · about ${Math.max(0, Math.ceil((autoSleep.deadlineAt - clockNow) / 60_000))} min remaining.`
                          : `A sleep request is scheduled after ${Math.round((autoSleep.idleMs ?? 0) / 60_000)} minutes of inactivity.`}
            </div>
            <fieldset className="mt-2">
              <legend className="sr-only">Cloud auto-sleep interval</legend>
              <div className="flex overflow-hidden rounded-lg border border-hairline/40">
              {([false, 10, 30, 60] as const).map((value, index) => {
                const selected = value === false ? !autoSleep.enabled : autoSleep.enabled && autoSleep.idleMs === value * 60_000;
                return (
                  <button
                    key={String(value)}
                    type="button"
                    disabled={policyPending}
                    aria-pressed={selected}
                    onClick={() => void setAutoSleepPolicy(value)}
                    className={cn(
                      "min-h-11 flex-1 px-1 text-[11px] disabled:opacity-50",
                      index > 0 && "border-l border-hairline/40",
                      selected ? "bg-raised text-ink" : "text-ink-secondary hover:bg-raised/60 hover:text-ink",
                    )}
                  >
                    {value === false ? "Off" : `${value}m`}
                  </button>
                );
              })}
              </div>
            </fieldset>
          </div>
        )}

        {/* Computer source */}
        <div className="mt-4 rounded-xl bg-card p-4">
          <div className="text-[15px] font-medium text-ink">Runs on</div>
          <div className="mt-0.5 text-[13px] text-ink-secondary">
            {bot.computer ? "" : "Auto: the cloud box when one exists, else this Mac when it is ready. "}Pick where this bot's
            computer lives.
          </div>
          <div className="mt-3 flex overflow-hidden rounded-lg border border-hairline/40">
            {(
              [
                ["cloud", "Cloud box"],
                ["vm", "Local VM"],
                ["local", "This Mac"],
                ["off", "Off"],
              ] as const
            ).map(([mode, label], i) => (
              <button
                key={mode}
                onClick={() => dispatch({ type: "updateBot", botId: bot.id, patch: { computer: mode } })}
                className={cn(
                  "flex-1 py-1.5 text-[13px]",
                  i > 0 && "border-l border-hairline/40",
                  bot.computer === mode
                    ? "bg-raised text-ink"
                    : "text-ink-secondary hover:bg-raised/60 hover:text-ink",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Routines */}
        <div className="mt-4 rounded-xl bg-card p-4">
          <div className="flex items-center gap-2 text-[15px] font-medium text-ink">
            <CalendarClock size={16} className="text-ink-secondary" />
            Routines
          </div>
          <div className="mt-0.5 text-[13px] text-ink-secondary">
            Routines are recurring tasks this agent runs on a schedule.
          </div>
          <button
            onClick={() => dispatch({ type: "toggleWork", open: true, tab: "routines" })}
            className="mt-3 w-full rounded-lg bg-raised py-2 text-[13px] text-ink hover:bg-raised-hover"
          >
            Create Routine
          </button>
        </div>
      </div>
    </aside>
  );
}
