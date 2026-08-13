import { useMemo, useState } from "react";
import { FlatList, RefreshControl, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { AgentRow } from "@/components/agent-row";
import { PressableScale } from "@/components/pressable-scale";
import { useCumea } from "@/state/cumea-store";
import { theme } from "@/theme";

export default function AgentsScreen() {
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
      <View style={{ minHeight: 70, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 18, paddingVertical: 10 }}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Open settings"
          onPress={() => router.push("/settings")}
          style={{ width: 42, height: 42, borderRadius: 21, borderWidth: 1, borderColor: theme.hairline, backgroundColor: theme.card, alignItems: "center", justifyContent: "center" }}
        >
          <Text style={{ color: theme.text, fontSize: 14, fontWeight: "800" }}>{initials}</Text>
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
              style={{ height: 42, borderRadius: 15, borderCurve: "continuous", backgroundColor: theme.input, color: theme.text, fontSize: 16, paddingHorizontal: 14 }}
            />
          ) : (
            <View style={{ gap: 2 }}>
              <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 20, fontWeight: "800", letterSpacing: -0.35 }}>Your bots</Text>
              <Text style={{ color: theme.textSecondary, fontSize: 11 }}>
                {state.connection === "demo" ? "Local demo" : state.connection === "online" ? state.hostName || "Host online" : state.connection === "connecting" ? "Connecting…" : "Host offline"}
              </Text>
            </View>
          )}
        </View>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={searching ? "Close search" : "Search bots"}
          onPress={() => { setSearching((value) => !value); if (searching) setQuery(""); }}
          style={{ width: 42, height: 42, borderRadius: 21, borderWidth: 1, borderColor: theme.hairline, alignItems: "center", justifyContent: "center" }}
        >
          <Text style={{ color: theme.text, fontSize: searching ? 22 : 25 }}>{searching ? "×" : "⌕"}</Text>
        </PressableScale>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Add a bot"
          onPress={() => router.push("/new-agent")}
          style={{ width: 42, height: 42, borderRadius: 21, borderWidth: 1, borderColor: theme.hairline, alignItems: "center", justifyContent: "center" }}
        >
          <Text style={{ color: theme.text, fontSize: 27, lineHeight: 29 }}>＋</Text>
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
        contentContainerStyle={{ paddingBottom: 24, flexGrow: agents.length ? undefined : 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={theme.textSecondary} />}
        ItemSeparatorComponent={() => <View style={{ height: 1, marginLeft: 81, backgroundColor: `${theme.hairline}80` }} />}
        ListEmptyComponent={(
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 9, padding: 30 }}>
            <Text style={{ color: theme.text, fontSize: 19, fontWeight: "700" }}>{query ? "No matching bots" : "No bots yet"}</Text>
            <Text style={{ color: theme.textSecondary, fontSize: 14, lineHeight: 20, textAlign: "center" }}>
              {query ? "Try a different name or role." : "Tap + to create your first teammate on your paired host."}
            </Text>
          </View>
        )}
        ListFooterComponent={state.routines.length ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="View routines"
            onPress={() => router.push("/routines")}
            style={{ marginHorizontal: 18, marginTop: 18, minHeight: 48, borderRadius: 15, backgroundColor: theme.card, flexDirection: "row", alignItems: "center", paddingHorizontal: 14 }}
          >
            <Text style={{ color: theme.text, fontSize: 15, fontWeight: "700" }}>Routines</Text>
            <Text style={{ marginLeft: "auto", color: theme.textSecondary, fontSize: 13 }}>{state.routines.filter((routine) => routine.enabled).length} active  ›</Text>
          </PressableScale>
        ) : null}
      />
    </SafeAreaView>
  );
}
