import "react-native-gesture-handler";

import { useEffect } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { CumeaProvider, useCumea } from "@/state/cumea-store";
import { theme } from "@/theme";

function NavigationGate() {
  const { state } = useCumea();
  const router = useRouter();
  const segments = useSegments();
  const expectedGroup = state.phase === "onboarding" ? "(onboarding)" : state.phase === "pairing" ? "(pairing)" : state.phase === "ready" ? "(app)" : null;
  const transitioning = state.phase === "booting" || (expectedGroup !== null && segments[0] !== expectedGroup);

  useEffect(() => {
    if (state.phase === "booting") return;
    const group = segments[0];
    if (state.phase === "onboarding" && group !== "(onboarding)") router.replace("/meet");
    if (state.phase === "pairing" && group !== "(pairing)") router.replace("/pair");
    if (state.phase === "ready" && group !== "(app)") router.replace("/");
  }, [router, segments, state.phase]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.background }, animation: "fade" }} />
      {transitioning ? (
        <View
          accessibilityLabel="Loading Cumea"
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", gap: 14, backgroundColor: theme.background }}
        >
          <ActivityIndicator color={theme.text} />
          <Text style={{ color: theme.textSecondary, fontSize: 14 }}>{state.phase === "booting" ? "Opening your team…" : "One moment…"}</Text>
        </View>
      ) : null}
    </View>
  );
}

export default function RootLayout() {
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(theme.background);
  }, []);
  return (
    <SafeAreaProvider>
      <CumeaProvider>
        <StatusBar style="light" />
        <NavigationGate />
      </CumeaProvider>
    </SafeAreaProvider>
  );
}
