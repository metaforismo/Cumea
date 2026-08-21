import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, Check, Loader2, LockKeyhole, Mic, Monitor, Sparkles } from "lucide-react";
import { CumeaAvatar } from "./Avatar";
import { setOnboardingDone } from "@/lib/onboarding";
import type { BotAvatarConfig, MoteShapeId } from "@/lib/mote";

type InstanceRow = {
  instanceId: string;
  driverKind: string;
  displayName: string;
  snapshot: { state: "available" | "unavailable"; reason?: string; version?: string | null; authenticated?: boolean };
};

type MotePlacement = {
  shapeId: MoteShapeId;
  color: string;
  size: number;
  className: string;
  delay: string;
  duration: string;
};

const MOTES: MotePlacement[] = [
  { shapeId: "tile", color: "#2f8de3", size: 118, className: "left-[7%] top-[9%] -rotate-6", delay: "-4.2s", duration: "11.8s" },
  { shapeId: "orb", color: "#ee9e18", size: 144, className: "left-[36%] -top-7 rotate-3", delay: "-1.5s", duration: "13.6s" },
  { shapeId: "drop", color: "#7651d6", size: 96, className: "right-[8%] top-[18%] rotate-6", delay: "-7.1s", duration: "12.2s" },
  { shapeId: "gem", color: "#f56a16", size: 132, className: "-left-10 top-[38%] -rotate-12", delay: "-2.6s", duration: "14.4s" },
  { shapeId: "ripple", color: "#19ae7a", size: 112, className: "-right-8 top-[46%] rotate-12", delay: "-8.4s", duration: "13.1s" },
  { shapeId: "soft", color: "#16a79d", size: 100, className: "-left-5 bottom-[13%] rotate-6", delay: "-5.2s", duration: "11.4s" },
  { shapeId: "capsule", color: "#d72879", size: 126, className: "right-[5%] bottom-[11%] -rotate-6", delay: "-3.4s", duration: "14.7s" },
  { shapeId: "orb", color: "#dc2944", size: 148, className: "left-[9%] -bottom-12 rotate-3", delay: "-9.1s", duration: "15.2s" },
  { shapeId: "soft", color: "#8b633d", size: 94, className: "left-[41%] -bottom-8 -rotate-3", delay: "-6.3s", duration: "12.8s" },
];

const hasNativeDictationPermissions = window.cumea?.platform === "darwin";
const hasCuaBridge = Boolean(window.cumea?.cuaStatus);

function friendlyCuaReason(reason: string | null | undefined) {
  if (!reason) return null;
  if (/app\.asar|node_modules|dlopen|library open failed|errno=/i.test(reason)) {
    return "Local computer support could not start. Reinstall Cumea or try again.";
  }
  return reason.length > 180 ? `${reason.slice(0, 177)}…` : reason;
}

function MoteField() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {MOTES.map((mote, index) => {
        const avatar: BotAvatarConfig = { kind: "mote", shapeId: mote.shapeId, color: mote.color, motion: "playful" };
        return (
          <div
            key={`${mote.shapeId}-${mote.color}`}
            className={`onboarding-mote absolute ${mote.className}`}
            style={{ animationDelay: mote.delay, animationDuration: mote.duration, zIndex: index % 2 }}
          >
            <CumeaAvatar avatar={avatar} size={mote.size} state="idle" expression="friendly" ambient />
          </div>
        );
      })}
      <div className="onboarding-vignette absolute inset-0" />
    </div>
  );
}

function Progress({ step }: { step: number }) {
  return (
    <div className="flex items-center justify-center gap-1.5" aria-label={`Setup step ${step + 1} of 4`}>
      {[0, 1, 2, 3].map((value) => (
        <span key={value} className={`h-1 rounded-full transition-all ${value === step ? "w-5 bg-ink" : "w-1 bg-ink/25"}`} />
      ))}
    </div>
  );
}

function StatusRow({ ok, title, detail }: { ok: boolean; title: string; detail: string }) {
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-2xl border border-hairline/35 bg-card/80 p-4">
      <span className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${ok ? "bg-success/12 text-success" : "bg-warning/10 text-warning"}`}>
        {ok ? <Check size={14} /> : <AlertTriangle size={14} />}
      </span>
      <div className="min-w-0">
        <div className="text-[14px] font-medium text-ink">{title}</div>
        <div className="mt-1 text-[12.5px] leading-[18px] text-ink-secondary">{detail}</div>
      </div>
    </div>
  );
}

function SetupCard({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <section className={`onboarding-card relative z-10 mx-auto w-[calc(100%-48px)] ${wide ? "max-w-[720px]" : "max-w-[520px]"}`}>
      {children}
    </section>
  );
}

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [instances, setInstances] = useState<InstanceRow[] | null>(null);
  const [perms, setPerms] = useState<{ mic: string } | null>(null);
  const [cua, setCua] = useState<CuaPublicStatus | null>(null);
  const [cuaPending, setCuaPending] = useState<"request" | "retry" | null>(null);
  const valid = !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());

  const byKind = useMemo(() => (kind: string) => instances?.find((instance) => instance.driverKind === kind), [instances]);
  const claude = byKind("claudeAgent");
  const codex = byKind("codex");
  const grok = byKind("grokAgent");

  useEffect(() => {
    if (step === 2 && !instances) {
      fetch("/api/instances")
        .then((response) => response.json())
        .then((data) => setInstances(data.instances ?? []))
        .catch(() => setInstances([]));
    }
    if (step !== 3) return undefined;
    if (hasCuaBridge) void window.cumea?.cuaStatus().then(setCua).catch(() => {});
    if (!hasNativeDictationPermissions) return undefined;
    const poll = () => window.cumea?.permStatus?.().then(setPerms).catch(() => {});
    poll();
    const timer = window.setInterval(poll, 2000);
    return () => window.clearInterval(timer);
  }, [step, instances]);

  const saveProfile = () => {
    void fetch("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: { name: name.trim(), email: email.trim().toLowerCase() } }),
    }).catch(() => {});
    setStep(2);
  };

  const finish = () => {
    setOnboardingDone();
    onDone();
  };

  const refreshCua = async (kind: "request" | "retry") => {
    if (!window.cumea) return;
    setCuaPending(kind);
    try {
      setCua(kind === "request" ? await window.cumea.cuaRequestPermissions() : await window.cumea.cuaRetry());
    } catch {
      setCua({ state: "error", mode: "error", permissions: null, reason: "Local computer support could not start. Try again.", driverVersion: null });
    } finally {
      setCuaPending(null);
    }
  };

  return (
    <div className="onboarding-scene fixed inset-0 z-50 flex min-h-0 flex-col overflow-hidden bg-app text-ink">
      <MoteField />
      <header className="relative z-20 flex h-16 shrink-0 items-center justify-between px-6">
        <button
          type="button"
          onClick={() => setStep((current) => Math.max(0, current - 1))}
          className={`onboarding-icon-button ${step === 0 ? "pointer-events-none opacity-0" : ""}`}
          aria-label="Back"
          tabIndex={step === 0 ? -1 : 0}
        >
          <ArrowLeft size={18} />
        </button>
        <Progress step={step} />
        <button type="button" onClick={finish} className="rounded-full px-3 py-1.5 text-[12px] text-ink-secondary hover:bg-white/[0.06] hover:text-ink">
          Skip setup
        </button>
      </header>

      <main className="relative z-10 flex min-h-0 flex-1 items-center justify-center overflow-y-auto py-8">
        {step === 0 ? (
          <div className="onboarding-intro mx-auto flex w-[calc(100%-48px)] max-w-[600px] flex-col items-center text-center">
            <div className="mb-6 flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-[12px] text-ink-secondary backdrop-blur-xl">
              <Sparkles size={13} /> Open source · your models · your computer
            </div>
            <h1 className="text-[clamp(42px,6vw,68px)] font-semibold leading-none tracking-[-0.055em]">Meet Cumea</h1>
            <p className="mt-5 max-w-[520px] text-[18px] leading-7 tracking-[-0.02em] text-ink-secondary">
              Your open-source team of agents that finishes the work — on a computer you control.
            </p>
            <button type="button" onClick={() => setStep(1)} className="onboarding-primary mt-9 min-w-44">
              Meet your team
            </button>
            <p className="mt-4 flex items-center gap-1.5 text-[11.5px] text-ink-secondary/75">
              <LockKeyhole size={12} /> No Cumea-managed cloud required. Providers and tools use the consent mode you configure.
            </p>
          </div>
        ) : null}

        {step === 1 ? (
          <SetupCard>
            <div className="text-[12px] font-medium uppercase tracking-[0.14em] text-ink-secondary">Your space</div>
            <h1 className="mt-2 text-[28px] font-semibold tracking-[-0.035em] text-ink">Make Cumea yours</h1>
            <p className="mt-2 text-[14px] leading-5 text-ink-secondary">Stored on this host and editable in Settings. Your display name may label the host during explicit mobile pairing.</p>
            <div className="mt-6 space-y-3">
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-ink-secondary">Name</span>
                <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="How should Cumea address you?" className="onboarding-input" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-ink-secondary">Email <span className="font-normal opacity-70">· optional</span></span>
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} onKeyDown={(event) => event.key === "Enter" && valid && saveProfile()} placeholder="you@example.com" className="onboarding-input" />
              </label>
            </div>
            {!valid ? <p className="mt-2 text-[12px] text-danger">Enter a valid email or leave it blank.</p> : null}
            <button type="button" onClick={saveProfile} disabled={!valid} className="onboarding-primary mt-6 w-full">Continue</button>
          </SetupCard>
        ) : null}

        {step === 2 ? (
          <SetupCard wide>
            <div className="text-[12px] font-medium uppercase tracking-[0.14em] text-ink-secondary">Bring your subscriptions</div>
            <h1 className="mt-2 text-[28px] font-semibold tracking-[-0.035em] text-ink">Use the AI tools you already have</h1>
            <p className="mt-2 text-[14px] leading-5 text-ink-secondary">Each agent can use a different CLI, model or ACP harness. Cumea found these on this Mac.</p>
            <div className="mt-6 grid gap-3 md:grid-cols-3">
              {!instances ? (
                <div className="col-span-full flex items-center justify-center gap-2 py-12 text-ink-secondary"><Loader2 size={16} className="animate-spin" /> Checking this Mac…</div>
              ) : (
                <>
                  <StatusRow ok={claude?.snapshot.state === "available"} title="Claude Code" detail={claude?.snapshot.state === "available" ? (claude.snapshot.authenticated ? "Installed and signed in." : "Installed — sign in once from Terminal.") : "Optional · Anthropic subscription"} />
                  <StatusRow ok={codex?.snapshot.state === "available"} title="Codex" detail={codex?.snapshot.state === "available" ? "Installed and ready for agents." : "Optional · OpenAI subscription"} />
                  <StatusRow ok={grok?.snapshot.state === "available"} title="Grok Build" detail={grok?.snapshot.state === "available" ? (grok.snapshot.authenticated ? "Installed and signed in." : "Installed — sign in once from Terminal.") : "Optional · xAI subscription"} />
                </>
              )}
            </div>
            <p className="mt-4 text-[11.5px] leading-5 text-ink-secondary">More ACP-compatible harnesses can be added later. Cumea never bundles your subscription credentials.</p>
            <button type="button" onClick={() => (hasNativeDictationPermissions || hasCuaBridge ? setStep(3) : finish())} className="onboarding-primary mt-6 w-full">Continue</button>
          </SetupCard>
        ) : null}

        {step === 3 ? (
          <SetupCard wide>
            <div className="text-[12px] font-medium uppercase tracking-[0.14em] text-ink-secondary">Optional capabilities</div>
            <h1 className="mt-2 text-[28px] font-semibold tracking-[-0.035em] text-ink">You stay in control</h1>
            <p className="mt-2 text-[14px] leading-5 text-ink-secondary">Enable a capability only when you want it. Local computer control stays off until every required permission is granted.</p>
            <div className="mt-6 space-y-3">
              {hasNativeDictationPermissions ? (
                <div className="onboarding-permission-row">
                  <span className="onboarding-permission-icon"><Mic size={18} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-medium text-ink">Microphone & Apple Speech</div>
                    <div className="mt-1 text-[12.5px] leading-[18px] text-ink-secondary">Used only while you dictate. Apple may process audio online when on-device recognition is unavailable.</div>
                  </div>
                  {perms?.mic === "granted" ? <Check size={17} className="shrink-0 text-success" /> : (
                    <button type="button" onClick={() => perms?.mic === "denied" || perms?.mic === "restricted" ? window.cumea?.permOpenSettings?.("mic") : window.cumea?.permRequestMic?.().then(() => window.cumea?.permStatus?.().then(setPerms))} className="onboarding-secondary">
                      {perms?.mic === "denied" || perms?.mic === "restricted" ? "Open Settings" : "Enable"}
                    </button>
                  )}
                </div>
              ) : null}
              {hasCuaBridge ? (
                <div className="onboarding-permission-row items-start">
                  <span className="onboarding-permission-icon"><Monitor size={18} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-medium text-ink">This Mac</div>
                    <div className="mt-1 text-[12.5px] leading-[18px] text-ink-secondary">Accessibility and Screen Recording let an agent use this Mac only when you ask. The driver remains stopped otherwise.</div>
                    {cua?.state === "needs-permissions" ? (
                      <div className="mt-2 flex flex-wrap gap-3 text-[11.5px] text-ink-secondary">
                        {!cua.permissions?.accessibility ? <button type="button" onClick={() => window.cumea?.cuaOpenSettings("accessibility")} className="underline underline-offset-2 hover:text-ink">Accessibility settings</button> : null}
                        {!cua.permissions?.screenRecording ? <button type="button" onClick={() => window.cumea?.cuaOpenSettings("screenRecording")} className="underline underline-offset-2 hover:text-ink">Screen Recording settings</button> : null}
                      </div>
                    ) : null}
                    {friendlyCuaReason(cua?.reason) && cua?.state !== "needs-permissions" && cua?.state !== "ready" ? <p className="mt-2 max-w-[460px] text-[11.5px] leading-4 text-warning">{friendlyCuaReason(cua?.reason)}</p> : null}
                  </div>
                  {cua?.state === "ready" ? <Check size={17} className="mt-1 shrink-0 text-success" /> : (
                    <div className="flex shrink-0 flex-col items-stretch gap-1.5">
                      <button type="button" onClick={() => void refreshCua("request")} disabled={cuaPending !== null || cua?.state === "starting"} className="onboarding-secondary">{cuaPending === "request" ? "Requesting…" : "Enable"}</button>
                      <button type="button" onClick={() => void refreshCua("retry")} disabled={cuaPending !== null || cua?.state === "starting"} className="rounded-md px-2 py-1 text-[11px] text-ink-secondary hover:text-ink disabled:opacity-40">{cuaPending === "retry" ? "Checking…" : "Check again"}</button>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
            <button type="button" onClick={finish} className="onboarding-primary mt-6 w-full">Start using Cumea</button>
          </SetupCard>
        ) : null}
      </main>
    </div>
  );
}
