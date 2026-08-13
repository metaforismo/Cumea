import { ScrollView, Switch, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { MoteAvatar } from "@/components/mote-avatar";
import { PressableScale } from "@/components/pressable-scale";
import type { AvatarConfig } from "@/host/types";
import { useCumea } from "@/state/cumea-store";
import { theme } from "@/theme";

const fallback: AvatarConfig = { version: 1, kind: "mote", shapeId: "soft", color: "#2f8de3", motion: "calm" };

function nextLabel(timestamp: number | null): string {
  if (!timestamp) return "No next run";
  return `Next ${new Date(timestamp).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`;
}

export default function RoutinesScreen() {
  const router = useRouter();
  const { state, actions } = useCumea();
  const readOnly = state.enrollment?.mode === "host";
  return (
    <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={{ height: 62, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: theme.hairline, paddingHorizontal: 12 }}>
        <PressableScale accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={{ width: 42, height: 42, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: theme.text, fontSize: 31 }}>‹</Text>
        </PressableScale>
        <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 20, fontWeight: "800" }}>Routines</Text>
      </View>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ flexGrow: 1, padding: 17, gap: 11 }}>
        {readOnly ? (
          <View style={{ borderRadius: 14, backgroundColor: theme.card, padding: 13 }}>
            <Text style={{ color: theme.textSecondary, fontSize: 12, lineHeight: 18 }}>Schedules are shown here but changed on the paired desktop or VM. The current remote API is intentionally least-privilege.</Text>
          </View>
        ) : null}
        {state.routines.length ? state.routines.map((routine) => {
          const agent = state.agents.find((candidate) => candidate.id === routine.agentId);
          return (
            <View key={routine.id} style={{ minHeight: 84, flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 18, borderCurve: "continuous", backgroundColor: theme.card, padding: 14 }}>
              <MoteAvatar config={agent?.avatar ?? fallback} size={46} label={routine.agentName} presence={routine.lastStatus === "running" ? "working" : "idle"} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text numberOfLines={1} style={{ color: theme.text, fontSize: 16, fontWeight: "700" }}>{routine.name}</Text>
                <Text numberOfLines={1} style={{ color: theme.textSecondary, fontSize: 12 }}>{routine.schedule}</Text>
                <Text numberOfLines={1} style={{ color: routine.lastStatus === "failed" ? theme.danger : theme.textSecondary, fontSize: 11 }}>
                  {nextLabel(routine.nextRunAt)}{routine.lastStatus ? ` · ${routine.lastStatus}` : ""}
                </Text>
              </View>
              <Switch
                accessibilityLabel={`${routine.enabled ? "Pause" : "Enable"} ${routine.name}`}
                disabled={readOnly}
                value={routine.enabled}
                onValueChange={() => void actions.toggleRoutine(routine)}
                trackColor={{ false: theme.hairline, true: theme.success }}
                thumbColor={theme.text}
              />
            </View>
          );
        }) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 9, padding: 30 }}>
            <Text style={{ color: theme.text, fontSize: 20, fontWeight: "800" }}>No routines yet.</Text>
            <Text style={{ color: theme.textSecondary, fontSize: 14, lineHeight: 20, textAlign: "center" }}>Teach or create a routine on your Cumea host and it will appear here.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
