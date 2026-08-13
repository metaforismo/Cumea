import { Text, View } from "react-native";
import type { AgentSummary } from "@/host/types";
import { MoteAvatar } from "./mote-avatar";
import { PressableScale } from "./pressable-scale";
import { theme } from "@/theme";

function relativeTime(timestamp: number): string {
  const elapsed = Math.max(0, Date.now() - timestamp);
  if (elapsed < 60_000) return "Now";
  if (elapsed < 60 * 60_000) return `${Math.floor(elapsed / 60_000)}m`;
  if (elapsed < 24 * 60 * 60_000) return new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return new Date(timestamp).toLocaleDateString([], { weekday: "short" });
}

export function AgentRow({ agent, onPress }: { agent: AgentSummary; onPress(): void }) {
  const quickLabel = agent.lifecycle
    ? `Quick bot, expires ${new Date(agent.lifecycle.expiresAt).toLocaleString()}. `
    : "";
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${agent.name}, ${agent.role}. ${quickLabel}${agent.needsYou ? "Needs you. " : ""}${agent.preview}`}
      onPress={onPress}
      style={{ flexDirection: "row", alignItems: "center", gap: 13, paddingHorizontal: 20, paddingVertical: 11, minHeight: 72 }}
    >
      <MoteAvatar config={agent.avatar} size={48} label={agent.name} presence={agent.presence} unread={agent.unread} />
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text numberOfLines={1} style={{ flexShrink: 1, color: theme.text, fontSize: 17, fontWeight: "700", letterSpacing: -0.2 }}>
            {agent.name}
          </Text>
          {agent.lifecycle ? (
            <View style={{ backgroundColor: `${theme.accent}1c`, borderRadius: 7, paddingHorizontal: 7, paddingVertical: 3 }}>
              <Text style={{ color: theme.accent, fontSize: 10, fontWeight: "800" }}>Quick</Text>
            </View>
          ) : null}
          <View style={{ maxWidth: 128, backgroundColor: theme.cardRaised, borderRadius: 7, paddingHorizontal: 7, paddingVertical: 3 }}>
            <Text numberOfLines={1} style={{ color: theme.textSecondary, fontSize: 11, fontWeight: "600" }}>{agent.role}</Text>
          </View>
          <Text style={{ marginLeft: "auto", color: theme.textSecondary, fontSize: 12, fontVariant: ["tabular-nums"] }}>
            {relativeTime(agent.updatedAt)}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
          <Text numberOfLines={1} style={{ flex: 1, color: theme.textSecondary, fontSize: 14 }}>{agent.preview}</Text>
          {agent.needsYou ? (
            <View style={{ borderRadius: 9, backgroundColor: `${theme.warning}22`, paddingHorizontal: 7, paddingVertical: 3 }}>
              <Text style={{ color: theme.warning, fontSize: 10, fontWeight: "700" }}>Needs you</Text>
            </View>
          ) : agent.unread ? (
            <View accessibilityLabel="Unread" style={{ width: 8, height: 8, borderRadius: 8, backgroundColor: theme.accent }} />
          ) : null}
        </View>
      </View>
    </PressableScale>
  );
}
