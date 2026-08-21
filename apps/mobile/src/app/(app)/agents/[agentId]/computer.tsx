import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, AppState, Image, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { PressableScale } from "@/components/pressable-scale";
import { HostClient } from "@/host/host-client";
import type { ComputerPreview } from "@/host/types";
import { useCumea } from "@/state/cumea-store";
import { useCumeaTheme } from "@/theme";

export default function ComputerPreviewScreen() {
  const { theme } = useCumeaTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ agentId: string }>();
  const agentId = Array.isArray(params.agentId) ? params.agentId[0] : params.agentId;
  const { state } = useCumea();
  const agent = state.agents.find((candidate) => candidate.id === agentId);
  const enrollment = state.enrollment?.mode === "host" ? state.enrollment : null;
  const client = useMemo(() => enrollment ? new HostClient(enrollment) : null, [enrollment]);
  const [preview, setPreview] = useState<ComputerPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client || !agentId) return;
    try {
      const next = await client.computerPreview(agentId);
      setPreview(next);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [agentId, client]);

  useEffect(() => {
    if (!state.capabilities.computerPreview || !client) {
      setLoading(false);
      return;
    }
    let active = AppState.currentState === "active";
    let timer: ReturnType<typeof setTimeout> | null = null;
    let running = false;
    let cancelled = false;
    const poll = async () => {
      if (!active || cancelled || running) return;
      running = true;
      try {
        await load();
      } finally {
        running = false;
        if (active && !cancelled) timer = setTimeout(() => void poll(), 4_000);
      }
    };
    const begin = () => {
      if (!active || timer) return;
      void poll();
    };
    const stop = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const subscription = AppState.addEventListener("change", (nextState) => {
      active = nextState === "active";
      if (active) begin();
      else stop();
    });
    begin();
    return () => {
      cancelled = true;
      stop();
      subscription.remove();
    };
  }, [client, load, state.capabilities.computerPreview]);

  return (
    <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={{ height: 62, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: theme.hairline, paddingHorizontal: 12 }}>
        <PressableScale accessibilityRole="button" accessibilityLabel="Back to chat" onPress={() => router.back()} style={{ width: 42, height: 42, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: theme.text, fontSize: 31 }}>‹</Text>
        </PressableScale>
        <View style={{ flex: 1 }}>
          <Text accessibilityRole="header" numberOfLines={1} style={{ color: theme.text, fontSize: 18, fontWeight: "800" }}>{agent?.name ?? "Bot"} computer</Text>
          <Text style={{ color: theme.textSecondary, fontSize: 11 }}>Read-only preview · refreshes every 4 seconds</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 16, justifyContent: "center" }}>
        {!state.capabilities.computerPreview || !enrollment ? (
          <View style={{ alignItems: "center", gap: 9, padding: 24 }}>
            <Text style={{ color: theme.text, fontSize: 19, fontWeight: "800", textAlign: "center" }}>Computer preview is not enabled</Text>
            <Text style={{ color: theme.textSecondary, fontSize: 14, lineHeight: 21, textAlign: "center" }}>Open Cumea on the paired desktop or VM to view and control this bot’s computer.</Text>
          </View>
        ) : loading && !preview ? (
          <View accessibilityLabel="Loading computer preview" style={{ alignItems: "center", gap: 12 }}>
            <ActivityIndicator color={theme.text} />
            <Text style={{ color: theme.textSecondary }}>Loading preview…</Text>
          </View>
        ) : preview?.available ? (
          <View style={{ gap: 11 }}>
            <View style={{ overflow: "hidden", borderRadius: 18, borderCurve: "continuous", borderWidth: 1, borderColor: theme.hairline, backgroundColor: theme.card }}>
              <Image accessibilityLabel={`Read-only computer preview for ${agent?.name ?? "bot"}`} source={{ uri: preview.dataUrl }} resizeMode="contain" style={{ width: "100%", aspectRatio: 16 / 10 }} />
            </View>
            <Text style={{ color: theme.textSecondary, fontSize: 12, textAlign: "center" }}>Captured {new Date(preview.capturedAt).toLocaleTimeString()}</Text>
          </View>
        ) : (
          <View style={{ alignItems: "center", gap: 9, padding: 24 }}>
            <Text style={{ color: theme.text, fontSize: 19, fontWeight: "800", textAlign: "center" }}>No preview yet</Text>
            <Text style={{ color: theme.textSecondary, fontSize: 14, lineHeight: 21, textAlign: "center" }}>The host has not captured a screen for this bot. Keep this view open while it works.</Text>
          </View>
        )}
        {error ? (
          <View accessibilityRole="alert" style={{ marginTop: 16, borderRadius: 13, backgroundColor: `${theme.danger}18`, padding: 13 }}>
            <Text style={{ color: theme.danger, fontSize: 13, textAlign: "center" }}>{error}</Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
