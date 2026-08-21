import { useMemo, useState } from "react";
import { FlatList, RefreshControl, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { AgentRow } from "@/components/agent-row";
import { PressableScale } from "@/components/pressable-scale";
import { useCumea } from "@/state/cumea-store";
import { useCumeaTheme } from "@/theme";

function SearchGlyph({ color }: { color: string }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: 22, height: 22 }}>
      <View style={{ width: 15, height: 15, borderRadius: 10, borderWidth: 2.2, borderColor: color }} />
      <View style={{ position: "absolute", right: 1, bottom: 2, width: 8, height: 2.2, borderRadius: 2, backgroundColor: color, transform: [{ rotate: "45deg" }] }} />
    </View>
  );
}

export default function AgentsScreen() {
  const { theme } = useCumeaTheme();
  const router = useRouter();
  const { state, actions } = useCumea();
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const initials = state.profile.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "C";
  const agents = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return state.agents;
    return state.agents.filter((agent) => `${agent.name} ${agent.role} ${agent.preview}`.toLowerCase().includes(needle));
  }, [query, state.agents]);

  const refresh = async () => {
    setRefreshing(true);
    await actions.refresh();
    setRefreshing(false);
  };

  return (
    <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={{ minHeight: 82, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 27, paddingVertical: 12 }}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Open settings"
          onPress={() => router.push("/settings")}
          style={{ width: 48, height: 48, borderRadius: 24, borderWidth: 1, borderColor: theme.hairline, backgroundColor: theme.control, alignItems: "center", justifyContent: "center", boxShadow: "0 8px 24px rgba(0,0,0,0.08)" }}
        >
          <Text style={{ color: theme.textSecondary, fontSize: 17, fontWeight: "600" }}>{initials}</Text>
        </PressableScale>
        <View style={{ flex: 1 }}>
          {searching ? (
            <TextInput
              autoFocus
              accessibilityLabel="Search bots"
              value={query}
              onChangeText={setQuery}
              placeholder="Search bots"
              placeholderTextColor={theme.textSecondary}
              returnKeyType="search"
              style={{ height: 46, borderRadius: 23, borderCurve: "continuous", backgroundColor: theme.input, color: theme.text, fontSize: 16, paddingHorizontal: 16 }}
            />
          ) : (
            <View />
          )}
        </View>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={searching ? "Close search" : "Search bots"}
          onPress={() => { setSearching((value) => !value); if (searching) setQuery(""); }}
          style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: theme.control, alignItems: "center", justifyContent: "center", boxShadow: "0 8px 24px rgba(0,0,0,0.08)" }}
        >
          {searching ? <Text style={{ color: theme.text, fontSize: 25, lineHeight: 27 }}>×</Text> : <SearchGlyph color={theme.text} />}
        </PressableScale>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Add a bot"
          onPress={() => router.push("/new-agent")}
          style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: theme.control, alignItems: "center", justifyContent: "center", boxShadow: "0 8px 24px rgba(0,0,0,0.08)" }}
        >
          <Text style={{ color: theme.text, fontSize: 31, lineHeight: 32, fontWeight: "300" }}>＋</Text>
        </PressableScale>
      </View>

      {state.attention.length ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`${state.attention.length} items need you`}
          onPress={() => router.push("/needs-you")}
          style={{ marginHorizontal: 18, marginBottom: 6, minHeight: 43, borderRadius: 13, borderCurve: "continuous", backgroundColor: `${theme.warning}1c`, flexDirection: "row", alignItems: "center", paddingHorizontal: 13, gap: 9 }}
        >
          <View style={{ width: 8, height: 8, borderRadius: 8, backgroundColor: theme.warning }} />
          <Text style={{ flex: 1, color: theme.warning, fontSize: 13, fontWeight: "700" }}>{state.attention.length} {state.attention.length === 1 ? "item needs" : "items need"} you</Text>
          <Text style={{ color: theme.warning, fontSize: 18 }}>›</Text>
        </PressableScale>
      ) : null}

      <FlatList
        data={agents}
        keyExtractor={(agent) => agent.id}
        renderItem={({ item }) => (
          <AgentRow
            agent={item}
            onPress={() => {
              actions.markRead(item.id);
              router.push({ pathname: "/agents/[agentId]", params: { agentId: item.id } });
            }}
          />
        )}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: 34, paddingTop: 5, flexGrow: agents.length ? undefined : 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={theme.textSecondary} />}
        ListEmptyComponent={(
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 9, padding: 30 }}>
            <Text style={{ color: theme.text, fontSize: 19, fontWeight: "700" }}>{query ? "No matching bots" : "No bots yet"}</Text>
            <Text style={{ color: theme.textSecondary, fontSize: 14, lineHeight: 20, textAlign: "center" }}>
              {query ? "Try a different name or role." : "Tap + to create your first teammate on your paired host."}
            </Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}
