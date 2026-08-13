import { useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { MoteAvatar } from "@/components/mote-avatar";
import { PressableScale } from "@/components/pressable-scale";
import type { AttentionItem, AvatarConfig } from "@/host/types";
import { useCumea } from "@/state/cumea-store";
import { theme } from "@/theme";

const fallback: AvatarConfig = { version: 1, kind: "mote", shapeId: "orb", color: "#ee9e18", motion: "calm" };

export default function NeedsYouScreen() {
  const router = useRouter();
  const { state, actions } = useCumea();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const respond = async (item: AttentionItem, choice: string) => {
    if (!choice.trim()) return;
    setSubmitting(item.id);
    setError(null);
    try {
      await actions.respondAttention(item, choice.trim());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={{ height: 62, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: theme.hairline, paddingHorizontal: 12 }}>
        <PressableScale accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={{ width: 42, height: 42, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: theme.text, fontSize: 31 }}>‹</Text>
        </PressableScale>
        <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 20, fontWeight: "800" }}>Needs you</Text>
        <View style={{ marginLeft: 9, minWidth: 26, height: 26, borderRadius: 13, backgroundColor: `${theme.warning}22`, alignItems: "center", justifyContent: "center", paddingHorizontal: 7 }}>
          <Text style={{ color: theme.warning, fontSize: 12, fontWeight: "800" }}>{state.attention.length}</Text>
        </View>
      </View>

      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, padding: 17, gap: 12 }}>
        {error ? (
          <View accessibilityRole="alert" style={{ borderRadius: 13, backgroundColor: `${theme.danger}20`, padding: 12 }}>
            <Text style={{ color: theme.danger, fontSize: 13 }}>{error}</Text>
          </View>
        ) : null}
        {state.attention.length ? state.attention.map((item) => {
          const agent = state.agents.find((candidate) => candidate.id === item.agentId);
          const questionNeedsText = item.requestType === "question" && item.choices.length === 0;
          return (
            <View key={item.id} style={{ borderRadius: 20, borderCurve: "continuous", borderWidth: 1, borderColor: theme.hairline, backgroundColor: theme.card, padding: 16, gap: 14 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 11 }}>
                <MoteAvatar config={agent?.avatar ?? fallback} size={43} label={item.agentName} presence="needs-you" />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: theme.text, fontSize: 15, fontWeight: "700" }}>{item.agentName}</Text>
                  <Text style={{ color: theme.warning, fontSize: 11, fontWeight: "700" }}>{item.requestType === "permission" ? "Approval" : "Question"}</Text>
                </View>
              </View>
              <View style={{ gap: 7 }}>
                <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 19, lineHeight: 24, fontWeight: "800" }}>{item.title}</Text>
                <Text selectable style={{ color: theme.textSecondary, fontSize: 14, lineHeight: 21 }}>{item.summary}</Text>
              </View>
              {questionNeedsText ? (
                <View style={{ gap: 9 }}>
                  <TextInput
                    accessibilityLabel={`Answer ${item.agentName}`}
                    value={answers[item.id] ?? ""}
                    onChangeText={(value) => setAnswers((current) => ({ ...current, [item.id]: value }))}
                    placeholder="Type your answer"
                    placeholderTextColor={theme.textSecondary}
                    multiline
                    maxLength={4_000}
                    style={{ minHeight: 92, borderRadius: 15, borderCurve: "continuous", backgroundColor: theme.input, color: theme.text, fontSize: 15, lineHeight: 21, padding: 13, textAlignVertical: "top" }}
                  />
                  <PressableScale
                    accessibilityRole="button"
                    disabled={submitting === item.id || !(answers[item.id] ?? "").trim()}
                    onPress={() => void respond(item, answers[item.id] ?? "")}
                    style={{ minHeight: 46, borderRadius: 23, backgroundColor: theme.text, opacity: (answers[item.id] ?? "").trim() ? 1 : 0.4, alignItems: "center", justifyContent: "center" }}
                  >
                    {submitting === item.id ? <ActivityIndicator color={theme.background} /> : <Text style={{ color: theme.background, fontSize: 15, fontWeight: "800" }}>Send answer</Text>}
                  </PressableScale>
                </View>
              ) : (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {item.choices.map((choice) => {
                    const destructive = ["Deny", "Never"].includes(choice);
                    return (
                      <PressableScale
                        key={choice}
                        accessibilityRole="button"
                        disabled={submitting === item.id}
                        onPress={() => void respond(item, choice)}
                        style={{ minHeight: 42, borderRadius: 21, borderWidth: 1, borderColor: destructive ? `${theme.danger}70` : theme.hairline, backgroundColor: choice === "Allow once" ? theme.text : theme.input, justifyContent: "center", paddingHorizontal: 15 }}
                      >
                        {submitting === item.id ? <ActivityIndicator size="small" color={theme.textSecondary} /> : (
                          <Text style={{ color: choice === "Allow once" ? theme.background : destructive ? theme.danger : theme.text, fontSize: 13, fontWeight: "700" }}>{choice}</Text>
                        )}
                      </PressableScale>
                    );
                  })}
                </View>
              )}
            </View>
          );
        }) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 28 }}>
            <Text style={{ color: theme.success, fontSize: 32 }}>✓</Text>
            <Text style={{ color: theme.text, fontSize: 20, fontWeight: "800" }}>Nothing is waiting.</Text>
            <Text style={{ color: theme.textSecondary, fontSize: 14, textAlign: "center" }}>Your bots will appear here when a question or approval needs your judgment.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
