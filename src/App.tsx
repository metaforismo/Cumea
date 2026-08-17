import { useLayoutEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { StoreProvider, useStore } from "@/state/store";
import { Onboarding } from "@/components/Onboarding";
import { onboardingDone } from "@/lib/onboarding";
import { markAfterPaint, markOnce } from "@/lib/performance";
import { Sidebar } from "@/components/Sidebar";
import { ChatView } from "@/components/ChatView";
import { SettingsPanel } from "@/components/SettingsPanel";
import { PluginsPanel } from "@/components/PluginsPanel";
import { ComputerPanel } from "@/components/ComputerPanel";
import { AppSettingsPanel } from "@/components/AppSettingsPanel";
import { WorkPanel } from "@/components/WorkPanel";

function Shell() {
  const { state } = useStore();
  const bot = state.bots.find((b) => b.id === state.selectedId) ?? state.bots[0];
  const shellUsable = state.connected && state.config !== null && Boolean(bot);

  useLayoutEffect(() => {
    markOnce("cumea:renderer:shell-committed");
    return markAfterPaint("cumea:renderer:shell-painted");
  }, []);

  useLayoutEffect(() => {
    if (state.connected) markOnce("cumea:renderer:transport-connected");
  }, [state.connected]);

  useLayoutEffect(() => {
    if (!shellUsable) return;
    markOnce("cumea:renderer:shell-usable-committed");
    return markAfterPaint("cumea:renderer:shell-usable-painted");
  }, [shellUsable]);

  return (
    <div className="relative flex h-full">
      <Sidebar />
      {bot ? (
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
