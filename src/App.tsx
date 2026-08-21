import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { StoreProvider, useStore } from "@/state/store";
import { Onboarding } from "@/components/Onboarding";
import { onboardingDone } from "@/lib/onboarding";
import { Sidebar } from "@/components/Sidebar";
import { ChatView } from "@/components/ChatView";
import { SettingsPanel } from "@/components/SettingsPanel";
import { PluginsPanel } from "@/components/PluginsPanel";
import { ComputerPanel } from "@/components/ComputerPanel";
import { AppSettingsPanel } from "@/components/AppSettingsPanel";
import { WorkPanel } from "@/components/WorkPanel";
import { NoEngines } from "@/components/NoEngines";
import { installProviderFocusRefresh } from "@/lib/provider-focus-refresh";

function Shell() {
  const { state, refreshInstances } = useStore();
  const bot = state.bots.find((b) => b.id === state.selectedId) ?? state.bots[0];
  const hasReadyEngine = state.instances.some(
    (instance) => instance.snapshot.state === "available" && instance.snapshot.authenticated !== false,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    return installProviderFocusRefresh({
      target: window,
      refresh: refreshInstances,
    });
  }, [refreshInstances]);

  return (
    <div className="relative flex h-full">
      <Sidebar />
      {state.connected && state.instancesLoaded && !hasReadyEngine ? (
        <NoEngines />
      ) : bot ? (
        <ChatView bot={bot} />
      ) : (
        <main className="flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-app text-ink-secondary">
          <Loader2 size={20} className="animate-spin" />
          <div className="text-[14px]">
            {state.connected ? "No bots yet" : "Connecting to the bot server…"}
          </div>
          {!state.connected && (
            <div className="text-[12px]">
              Start it with <code className="rounded bg-raised px-1.5 py-0.5">pnpm dev:server</code>
            </div>
          )}
        </main>
      )}
      {state.settingsOpen && bot && <SettingsPanel bot={bot} />}
      {state.computerOpen && bot && <ComputerPanel bot={bot} />}
      {state.appSettingsOpen && <AppSettingsPanel />}
      {state.workOpen && <WorkPanel />}
      {state.pluginsOpen && <PluginsPanel />}
    </div>
  );
}

export default function App() {
  const [gated, setGated] = useState(() => !onboardingDone());
  return (
    <StoreProvider>
      <Shell />
      {gated && <Onboarding onDone={() => setGated(false)} />}
    </StoreProvider>
  );
}
