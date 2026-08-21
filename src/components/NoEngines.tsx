import { useState } from "react";
import { Loader2, RefreshCw, Settings2 } from "lucide-react";
import { useStore } from "@/state/store";
import { EngineSetup, installCommandFor } from "./EngineSetup";

export function NoEngines() {
  const { state, dispatch, refreshInstances } = useStore();
  const [checking, setChecking] = useState(false);
  const engines = [...state.instances]
    .filter((instance) => instance.install)
    .sort((left, right) => Number(!installCommandFor(left.install)) - Number(!installCommandFor(right.install)));

  const recheck = async () => {
    setChecking(true);
    try {
      await refreshInstances();
    } finally {
      setChecking(false);
    }
  };

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col overflow-y-auto bg-app">
      <div className="mx-auto w-full max-w-[620px] px-6 py-12">
        <h1 className="text-[21px] font-semibold tracking-[-0.02em] text-ink">Connect an AI engine</h1>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-secondary">
          Cumea runs agents through tools installed on this computer or through an explicitly configured provider.
          Set up one engine, sign in with its own CLI, then check again.
        </p>

        {engines.length ? (
          <div className="mt-6 flex flex-col gap-2.5">
            {engines.map((instance) => (
              <section key={instance.instanceId} className="rounded-xl border border-hairline/40 bg-card p-3.5">
                <h2 className="text-[14px] font-medium text-ink">{instance.displayName}</h2>
                <EngineSetup instance={instance} className="mt-0.5" />
              </section>
            ))}
          </div>
        ) : (
          <p className="mt-6 rounded-xl border border-hairline/40 bg-card p-3.5 text-[13px] text-ink-secondary">
            No installable engine is configured. Add an ACP profile or configure a provider in settings.
          </p>
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void recheck()}
            disabled={checking}
            className="flex items-center gap-2 rounded-lg bg-raised px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-60"
          >
            {checking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {checking ? "Checking…" : "Check again"}
          </button>
          <button
            type="button"
            onClick={() => dispatch({ type: "toggleAppSettings", open: true, tab: "models" })}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-ink-secondary hover:bg-raised hover:text-ink"
          >
            <Settings2 size={14} /> Model settings
          </button>
        </div>
      </div>
    </main>
  );
}
