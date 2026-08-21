import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { MoteAvatar } from "@/components/mote-avatar";
import { PressableScale } from "@/components/pressable-scale";
import { useCumea } from "@/state/cumea-store";
import { useCumeaTheme } from "@/theme";

const preview = { version: 1 as const, kind: "mote" as const, shapeId: "orb" as const, color: "#19ae7a", motion: "playful" as const };

export default function NewAgentScreen() {
  const { theme } = useCumeaTheme();
  const router = useRouter();
  const { state, actions } = useCumea();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [saving, setSaving] = useState(false);
  const [temporary, setTemporary] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hostMode = state.enrollment?.mode === "host";

  const create = async () => {
    if (!name.trim() || !role.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const agent = await actions.createAgent(name.trim(), role.trim(), { temporary });
      router.replace({ pathname: "/agents/[agentId]", params: { agentId: agent.id } });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={{ height: 62, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: theme.hairline, paddingHorizontal: 12 }}>
        <PressableScale accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={{ width: 42, height: 42, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: theme.text, fontSize: 31 }}>‹</Text>
        </PressableScale>
        <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 20, fontWeight: "800" }}>New bot</Text>
      </View>
      <KeyboardAvoidingView behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, padding: 20, gap: 20 }}>
          <View style={{ alignItems: "center", gap: 12, paddingVertical: 15 }}>
            <MoteAvatar config={preview} size={82} label="New bot preview" />
            <Text style={{ color: theme.textSecondary, fontSize: 13 }}>One teammate, one clear job</Text>
          </View>
          <View style={{ gap: 15 }}>
            <View style={{ gap: 7 }}>
              <Text style={{ color: theme.textSecondary, fontSize: 12, fontWeight: "700" }}>NAME</Text>
              <TextInput accessibilityLabel="Bot name" value={name} onChangeText={setName} placeholder="Research Agent" placeholderTextColor={theme.textSecondary} maxLength={80} style={{ minHeight: 51, borderRadius: 15, borderCurve: "continuous", borderWidth: 1, borderColor: theme.hairline, backgroundColor: theme.input, color: theme.text, fontSize: 16, paddingHorizontal: 14 }} />
            </View>
            <View style={{ gap: 7 }}>
              <Text style={{ color: theme.textSecondary, fontSize: 12, fontWeight: "700" }}>ROLE</Text>
              <TextInput accessibilityLabel="Bot role" value={role} onChangeText={setRole} placeholder="Research and synthesis" placeholderTextColor={theme.textSecondary} maxLength={120} style={{ minHeight: 51, borderRadius: 15, borderCurve: "continuous", borderWidth: 1, borderColor: theme.hairline, backgroundColor: theme.input, color: theme.text, fontSize: 16, paddingHorizontal: 14 }} />
            </View>
            <View style={{ minHeight: 68, flexDirection: "row", alignItems: "center", gap: 14, borderRadius: 15, borderCurve: "continuous", borderWidth: 1, borderColor: theme.hairline, backgroundColor: theme.card, paddingHorizontal: 14, paddingVertical: 10 }}>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={{ color: theme.text, fontSize: 15, fontWeight: "700" }}>Quick bot</Text>
                <Text style={{ color: theme.textSecondary, fontSize: 12, lineHeight: 17 }}>
                  Expires after 24 hours, but waits while working, awaiting approval, or owning a routine.
                </Text>
              </View>
              <Switch
                accessibilityLabel="Create as a quick bot"
                accessibilityHint="Quick bots expire after 24 hours when safely idle"
                accessibilityState={{ checked: temporary }}
                value={temporary}
                onValueChange={setTemporary}
                trackColor={{ false: theme.cardRaised, true: theme.accent }}
              />
            </View>
            {hostMode ? (
              <Text style={{ color: theme.textSecondary, fontSize: 13, lineHeight: 19 }}>
                This creates the bot on your paired host. Model and avatar details can be adjusted from desktop.
              </Text>
            ) : null}
            {error ? <Text accessibilityRole="alert" style={{ color: theme.danger, fontSize: 13 }}>{error}</Text> : null}
            <PressableScale accessibilityRole="button" accessibilityLabel={temporary ? "Create quick bot" : hostMode ? "Create bot on host" : "Create demo bot"} disabled={saving || !name.trim() || !role.trim()} onPress={() => void create()} style={{ minHeight: 52, borderRadius: 26, backgroundColor: theme.text, opacity: name.trim() && role.trim() ? 1 : 0.4, alignItems: "center", justifyContent: "center" }}>
              {saving ? <ActivityIndicator color={theme.background} /> : <Text style={{ color: theme.background, fontSize: 16, fontWeight: "800" }}>{temporary ? "Create quick bot" : hostMode ? "Create bot" : "Create demo bot"}</Text>}
            </PressableScale>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
