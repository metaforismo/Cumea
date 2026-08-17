// App-level settings, in the right-side slot: who you are + credentials
// shared by all bots. Per-bot settings (name, persona, model, computer)
// live in SettingsPanel; contextual Box-token entry stays in ComputerPanel.
import { ChevronRight, Puzzle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useStore } from "@/state/store";
import { ApiKeyRow } from "./ApiKeys";
import { MobileAccess } from "./MobileAccess";

/** Name + email, persisted to /api/config {profile} on blur. Prefilled from
 * the current config (the values are echoed back — they're not secrets). */
function ProfileFields() {
  const { state, dispatch } = useStore();
  const [name, setName] = useState(state.config?.profile?.name ?? "");
  const [email, setEmail] = useState(state.config?.profile?.email ?? "");
  // adopt late-arriving config exactly once per open (config loads async)
  useEffect(() => {
    setName(state.config?.profile?.name ?? "");
    setEmail(state.config?.profile?.email ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.config?.profile?.name, state.config?.profile?.email]);

  const save = () => {
    void fetch("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: { name: name.trim(), email: email.trim().toLowerCase() } }),
    })
      .then((r) => r.json())
      .then((config) => dispatch({ type: "configStatus", config }))
      .catch(() => {});
  };

  const inputClass =
    "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none";
  return (
    <div className="flex flex-col gap-3">
      <input value={name} onChange={(e) => setName(e.target.value)} onBlur={save} placeholder="Your name" className={inputClass} />
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onBlur={save}
        placeholder="you@example.com"
        className={inputClass}
      />
    </div>
  );
}

export function AppSettingsPanel() {
  const { dispatch } = useStore();

  return (
    <aside className="animate-panel-in flex h-full w-[400px] shrink-0 flex-col border-l border-hairline/40 bg-panel">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="w-6" />
        <span className="text-[15px] font-semibold text-ink">App Settings</span>
        <button
          onClick={() => dispatch({ type: "toggleAppSettings", open: false })}
          className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-5">
        <div className="mt-2 rounded-xl bg-card p-4">
          <div className="text-[15px] font-medium text-ink">Profile</div>
          <div className="mt-0.5 text-[13px] text-ink-secondary">Shown in the sidebar. Saved as you go.</div>
          <div className="mt-4">
            <ProfileFields />
          </div>
        </div>

        <button
          type="button"
          onClick={() => dispatch({ type: "togglePlugins", open: true })}
          className="mt-4 flex w-full items-center gap-3 rounded-xl bg-card p-4 text-left hover:bg-raised/70"
          aria-label="Open integrations"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-raised text-ink-secondary">
            <Puzzle size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-medium text-ink">Integrations</span>
            <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-secondary">
              Connect and manage the apps your bots can use.
            </span>
          </span>
          <ChevronRight size={17} className="shrink-0 text-ink-secondary" />
        </button>

        <div className="mt-4 rounded-xl bg-card p-4">
          <div className="text-[15px] font-medium text-ink">Connections</div>
          <div className="mt-0.5 text-[13px] text-ink-secondary">
            Shared by all bots. Values are write-only and never shown again. The packaged app uses the
            operating-system credential store; open each help icon for its exact data and billing boundary.
          </div>
          <div className="mt-4 flex flex-col gap-4">
            <ApiKeyRow section="xai" />
            <ApiKeyRow section="composio" />
            <ApiKeyRow section="composioApi" />
            <ApiKeyRow section="box" />
          </div>
        </div>

        <MobileAccess />
      </div>
    </aside>
  );
}
