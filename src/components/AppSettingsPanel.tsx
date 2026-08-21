import {
  Bot,
  CheckCircle2,
  ChevronRight,
  Cpu,
  Info,
  Laptop,
  Link2,
  Puzzle,
  ShieldCheck,
  Smartphone,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ComponentType } from "react";
import { useStore } from "@/state/store";
import { ApiKeyRow } from "./ApiKeys";
import { MobileAccess } from "./MobileAccess";
import { AcpProfiles } from "./AcpProfiles";
import { InitialsAvatar } from "./Avatar";
import { McpServers } from "./McpServers";
import { LocalVmSection } from "./LocalVmSection";
import { BackupRestore } from "./BackupRestore";
import { LocalSkills } from "./LocalSkills";
import { PrivacyDataFlows } from "./PrivacyDataFlows";

type SettingsTab = "profile" | "models" | "connections" | "mobile" | "data" | "about";

const NAV: Array<{ id: SettingsTab; label: string; icon: ComponentType<{ size?: number }> }> = [
  { id: "profile", label: "Profile", icon: UserRound },
  { id: "models", label: "Models & ACP", icon: Cpu },
  { id: "connections", label: "Integrations", icon: Link2 },
  { id: "mobile", label: "Mobile & hosts", icon: Smartphone },
  { id: "data", label: "Privacy & data", icon: ShieldCheck },
  { id: "about", label: "About & diagnostics", icon: Info },
];

function initials(profile: { name?: string; email?: string } | undefined) {
  const label = profile?.name?.trim() || profile?.email?.trim() || "You";
  return label.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function ProfileFields() {
  const { state, dispatch } = useStore();
  const [name, setName] = useState(state.config?.profile?.name ?? "");
  const [email, setEmail] = useState(state.config?.profile?.email ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setName(state.config?.profile?.name ?? "");
    setEmail(state.config?.profile?.email ?? "");
  }, [state.config?.profile?.name, state.config?.profile?.email]);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const response = await fetch("/api/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profile: { name: name.trim(), email: email.trim().toLowerCase() } }),
      });
      if (!response.ok) throw new Error("save failed");
      dispatch({ type: "configStatus", config: await response.json() });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1600);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-4">
      <label className="grid gap-1.5">
        <span className="text-[12px] font-medium text-ink-secondary">Name</span>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" className="settings-input" />
      </label>
      <label className="grid gap-1.5">
        <span className="text-[12px] font-medium text-ink-secondary">Email <span className="font-normal opacity-70">· optional</span></span>
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" className="settings-input" />
      </label>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11.5px] leading-4 text-ink-secondary">Stored in your local Cumea configuration. Never used for analytics.</p>
        <button type="button" onClick={() => void save()} disabled={saving} className="settings-primary shrink-0">
          {saved ? <><CheckCircle2 size={14} /> Saved</> : saving ? "Saving…" : "Save profile"}
        </button>
      </div>
    </div>
  );
}

function SectionHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <header className="mb-6">
      <div className="text-[11px] font-semibold uppercase tracking-[0.13em] text-ink-secondary">{eyebrow}</div>
      <h2 className="mt-2 text-[25px] font-semibold tracking-[-0.035em] text-ink">{title}</h2>
      <p className="mt-2 max-w-[620px] text-[13.5px] leading-5 text-ink-secondary">{description}</p>
    </header>
  );
}

function InfoRow({ label, value, good = false }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-hairline/30 py-3 last:border-0">
      <span className="text-[13px] text-ink-secondary">{label}</span>
      <span className={`text-right text-[13px] font-medium ${good ? "text-success" : "text-ink"}`}>{value}</span>
    </div>
  );
}

export function AppSettingsPanel() {
  const { state, dispatch } = useStore();
  const modalRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const activeTab = state.appSettingsTab as SettingsTab;

  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const modal = modalRef.current;
    modal?.querySelector<HTMLElement>("[data-settings-close]")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dispatch({ type: "toggleAppSettings", open: false });
        return;
      }
      if (event.key !== "Tab" || !modal) return;
      const controls = [...modal.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (!controls.length) return;
      const first = controls[0];
      const last = controls.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      returnFocusRef.current?.focus();
    };
  }, [dispatch]);

  return (
    <div className="settings-modal-backdrop fixed inset-0 z-40 flex items-center justify-center p-7" onMouseDown={(event) => {
      if (event.target === event.currentTarget) dispatch({ type: "toggleAppSettings", open: false });
    }}>
      <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="app-settings-title" className="settings-modal flex h-[min(760px,calc(100vh-56px))] w-[min(1040px,calc(100vw-56px))] min-w-0 overflow-hidden">
        <aside className="flex w-[230px] shrink-0 flex-col border-r border-hairline/35 bg-panel/85 p-3">
          <div className="flex items-center gap-3 px-3 pb-5 pt-3">
            <InitialsAvatar initials={initials(state.config?.profile)} size={38} />
            <div className="min-w-0">
              <div className="truncate text-[14px] font-semibold text-ink">{state.config?.profile?.name?.trim() || "Your Cumea"}</div>
              <div className="truncate text-[11.5px] text-ink-secondary">Local workspace</div>
            </div>
          </div>
          <nav className="grid gap-1" aria-label="Settings sections">
            {NAV.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" onClick={() => dispatch({ type: "toggleAppSettings", open: true, tab: id })} className={`settings-nav-item ${activeTab === id ? "settings-nav-item--active" : ""}`} aria-current={activeTab === id ? "page" : undefined}>
                <Icon size={16} /><span>{label}</span>
              </button>
            ))}
          </nav>
          <div className="mt-auto rounded-xl border border-hairline/35 bg-card/60 p-3">
            <div className="flex items-center gap-2 text-[12px] font-medium text-ink"><ShieldCheck size={14} className="text-success" /> Self-hosted control</div>
            <p className="mt-1 text-[10.5px] leading-4 text-ink-secondary">Local records stay on your host. Selected providers, tools and paired devices may receive the data needed for requested work.</p>
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col bg-app">
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-hairline/30 px-6">
            <h1 id="app-settings-title" className="text-[14px] font-semibold text-ink">Cumea Settings</h1>
            <button data-settings-close type="button" onClick={() => dispatch({ type: "toggleAppSettings", open: false })} className="settings-icon-button" aria-label="Close settings"><X size={18} /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-8 py-7">
            {activeTab === "profile" ? (
              <>
                <SectionHeader eyebrow="Profile" title="How Cumea knows you" description="Your profile is stored on this host. Its display name may identify the host during explicit mobile pairing; Cumea does not use it for analytics." />
                <div className="settings-card max-w-[660px]"><ProfileFields /></div>
                <div className="mt-4 grid max-w-[660px] gap-3 sm:grid-cols-2">
                  <div className="settings-card"><Bot size={18} className="text-ink-secondary" /><div className="mt-3 text-[14px] font-medium text-ink">{state.bots.length} agents</div><p className="mt-1 text-[12px] leading-4 text-ink-secondary">Persistent identities, each with its own conversation and model.</p></div>
                  <div className="settings-card"><Laptop size={18} className="text-ink-secondary" /><div className="mt-3 text-[14px] font-medium text-ink">This host</div><p className="mt-1 text-[12px] leading-4 text-ink-secondary">Desktop and your own VM remain the execution boundary.</p></div>
                </div>
              </>
            ) : null}

            {activeTab === "models" ? (
              <>
                <SectionHeader eyebrow="Models & ACP" title="One team, different engines" description="Give each agent a different CLI subscription, model or ACP-compatible harness. They can still hand work to one another." />
                <div className="grid gap-3 md:grid-cols-2">
                  {state.instances.map((instance) => (
                    <div key={instance.instanceId} className="settings-card flex items-start gap-3">
                      <span className={`mt-0.5 size-2.5 shrink-0 rounded-full ${instance.snapshot.state === "available" ? "bg-success" : "bg-ink-secondary/30"}`} />
                      <div className="min-w-0"><div className="truncate text-[14px] font-medium text-ink">{instance.displayName}</div><div className="mt-1 text-[11.5px] text-ink-secondary">{instance.snapshot.state === "available" ? instance.snapshot.authenticated === false ? "Installed · sign-in needed" : "Available" : "Not detected on this host"}</div></div>
                    </div>
                  ))}
                </div>
                <div className="mt-5"><AcpProfiles /></div>
              </>
            ) : null}

            {activeTab === "connections" ? (
              <>
                <SectionHeader eyebrow="Integrations" title="Tools your agents can use" description="Plugins bring skills, MCP servers and connectors together behind one clear permission surface." />
                <button type="button" onClick={() => { dispatch({ type: "toggleAppSettings", open: false }); dispatch({ type: "togglePlugins", open: true }); }} className="settings-card flex w-full items-center gap-3 text-left hover:bg-raised/70">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-raised text-ink-secondary"><Puzzle size={18} /></span>
                  <span className="min-w-0 flex-1"><span className="block text-[14px] font-medium text-ink">Browse integrations</span><span className="mt-1 block text-[12px] text-ink-secondary">See what is available, connected or needs setup.</span></span><ChevronRight size={17} className="text-ink-secondary" />
                </button>
                <div className="settings-card mt-4">
                  <div className="text-[14px] font-medium text-ink">Shared credentials</div>
                  <p className="mt-1 text-[12px] leading-5 text-ink-secondary">Keys are stored locally, never shown again, and sent only to the service you explicitly use.</p>
                  <div className="mt-5 grid gap-5"><ApiKeyRow section="composio" /><ApiKeyRow section="composioApi" /><ApiKeyRow section="box" /></div>
                </div>
                <McpServers />
                <LocalSkills />
                <LocalVmSection />
              </>
            ) : null}

            {activeTab === "mobile" ? (
              <>
                <SectionHeader eyebrow="Mobile & hosts" title="Carry your agents with you" description="Pair the mobile companion with this desktop or your own always-on VM. Cumea does not provide or control the host." />
                <MobileAccess />
              </>
            ) : null}

            {activeTab === "data" ? (
              <>
                <SectionHeader eyebrow="Privacy & data" title="Know every configured boundary" description="See which local processes, providers, services and devices can receive data from this host. Tokens, endpoints, paths, prompts and identities are never included here." />
                <div className="max-w-[720px]"><PrivacyDataFlows /></div>
                <div className="my-7 max-w-[720px] border-t border-hairline/35" />
                <div className="max-w-[720px]"><BackupRestore /></div>
              </>
            ) : null}

            {activeTab === "about" ? (
              <>
                <SectionHeader eyebrow="About & diagnostics" title="A transparent local runtime" description="A quick, non-sensitive view of this Cumea host. Detailed paths, tokens and provider errors are intentionally omitted." />
                <div className="settings-card max-w-[680px]">
                  <InfoRow label="Agent server" value={state.connected ? "Connected" : "Offline"} good={state.connected} />
                  <InfoRow label="Platform" value={window.cumea?.platform === "darwin" ? "macOS" : window.cumea?.platform ?? "Web browser"} />
                  <InfoRow label="AI engines detected" value={`${state.instances.filter((instance) => instance.snapshot.state === "available").length} of ${state.instances.length}`} />
                  <InfoRow label="Remote access" value="Off unless you enable your own host" />
                </div>
                <div className="mt-4 grid max-w-[680px] gap-3 md:grid-cols-2">
                  <div className="settings-card"><ShieldCheck size={18} className="text-success" /><div className="mt-3 text-[14px] font-medium text-ink">Privacy boundary</div><p className="mt-1 text-[12px] leading-5 text-ink-secondary">Provider system prompts, internal reasoning, raw errors and hidden agents are not projected to paired mobile devices.</p></div>
                  <div className="settings-card"><Info size={18} className="text-ink-secondary" /><div className="mt-3 text-[14px] font-medium text-ink">Open source</div><p className="mt-1 text-[12px] leading-5 text-ink-secondary">Cumea is independent, self-hostable software. Third-party foundations and licenses are documented in the repository.</p></div>
                </div>
              </>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
