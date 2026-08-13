import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Text, View, type ListRenderItem, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChatComposer } from "@/components/chat-composer";
import { MessageBubble, StreamingBubble } from "@/components/message-bubble";
import { MoteAvatar } from "@/components/mote-avatar";
import { PressableScale } from "@/components/pressable-scale";
import type { ChatMessage } from "@/host/types";
import { useCumea } from "@/state/cumea-store";
import { theme } from "@/theme";

const EMPTY_MESSAGES: ChatMessage[] = [];
const MAINTAIN_VISIBLE_CONTENT_POSITION = { minIndexForVisible: 0, autoscrollToTopThreshold: 80 };

function ComputerGlyph() {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: 19, height: 17, alignItems: "center" }}>
      <View style={{ width: 19, height: 13, borderRadius: 3, borderWidth: 1.5, borderColor: theme.text }} />
      <View style={{ width: 6, height: 1.5, backgroundColor: theme.text }} />
      <View style={{ width: 11, height: 1.5, borderRadius: 2, backgroundColor: theme.text }} />
    </View>
  );
}

export default function AgentChatScreen() {
  const router = useRouter();
  const screenFocused = useIsFocused();
  const params = useLocalSearchParams<{ agentId: string }>();
  const agentId = Array.isArray(params.agentId) ? params.agentId[0] : params.agentId;
  const { state, actions } = useCumea();
  const agent = state.agents.find((candidate) => candidate.id === agentId);
  const messages = state.messages[agentId] ?? EMPTY_MESSAGES;
  const paging = state.messagePaging[agentId];
  const working = agent?.presence === "working";
  const stream = state.streaming[agentId] ?? "";
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [newerCount, setNewerCount] = useState(0);
  const previousLatestId = useRef<string | undefined>(messages.at(-1)?.id);
  const reversedMessages = useMemo(() => [...messages].reverse(), [messages]);
  const renderMessage = useCallback<ListRenderItem<ChatMessage>>(
    ({ item }) => <MessageBubble message={item} />,
    [],
  );
  const loadOlder = useCallback(() => {
    if (!paging?.initialized || !paging.hasMore || paging.loading) return;
    void actions.loadOlderMessages(agentId);
  }, [actions, agentId, paging?.hasMore, paging?.initialized, paging?.loading]);

  useEffect(() => {
    if (!agentId) return;
    void actions.ensureMessages(agentId);
  }, [actions, agentId]);

  useEffect(() => {
    if (agent?.unread) actions.markRead(agentId);
  }, [actions, agent?.unread, agentId]);

  useEffect(() => {
    previousLatestId.current = messages.at(-1)?.id;
    setAtBottom(true);
    setNewerCount(0);
  }, [agentId]);

  useEffect(() => {
    const latestId = messages.at(-1)?.id;
    if (!latestId || latestId === previousLatestId.current) return;
    previousLatestId.current = latestId;
    if (atBottom) {
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
      setNewerCount(0);
    } else {
      setNewerCount((count) => count + 1);
    }
  }, [atBottom, messages]);

  const updateBottomState = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    // The list is inverted, so offset zero is the newest edge.
    const nextAtBottom = event.nativeEvent.contentOffset.y <= 80;
    setAtBottom(nextAtBottom);
    if (nextAtBottom) setNewerCount(0);
  }, []);

  if (!agent) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.background, alignItems: "center", justifyContent: "center", gap: 14, padding: 26 }}>
        <Text style={{ color: theme.text, fontSize: 21, fontWeight: "800" }}>This bot is no longer available.</Text>
        <PressableScale accessibilityRole="button" onPress={() => router.replace("/")} style={{ minHeight: 46, paddingHorizontal: 20, justifyContent: "center" }}>
          <Text style={{ color: theme.accent, fontSize: 16 }}>Back to bots</Text>
        </PressableScale>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={{ height: 62, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: theme.hairline, paddingHorizontal: 12 }}>
        <PressableScale accessibilityRole="button" accessibilityLabel="Back to bots" onPress={() => router.back()} style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: theme.text, fontSize: 31, lineHeight: 33 }}>‹</Text>
        </PressableScale>
        <MoteAvatar config={agent.avatar} size={34} label={agent.name} presence={agent.presence} />
        <View style={{ flex: 1, gap: 1 }}>
          <Text numberOfLines={1} accessibilityRole="header" style={{ color: theme.text, fontSize: 17, fontWeight: "700" }}>{agent.name}</Text>
          <Text numberOfLines={1} style={{ color: agent.needsYou ? theme.warning : theme.textSecondary, fontSize: 11 }}>
            {agent.needsYou ? "Needs you" : working ? "Working on it…" : agent.lifecycle ? `Quick · ${agent.role}` : agent.role}
          </Text>
        </View>
        {agent.lifecycle ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={`Quick bot. Expires ${new Date(agent.lifecycle.expiresAt).toLocaleString()}`}
            accessibilityHint="Offers to keep this bot permanently"
            onPress={() => Alert.alert(
              "Keep this bot?",
              `It is currently scheduled to expire ${new Date(agent.lifecycle!.expiresAt).toLocaleString()}.`,
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Keep permanently",
                  onPress: () => void actions.makeAgentPermanent(agent.id).catch((reason) => {
                    Alert.alert("Could not update bot", reason instanceof Error ? reason.message : String(reason));
                  }),
                },
              ],
            )}
            style={{ minHeight: 32, borderRadius: 16, backgroundColor: `${theme.accent}1c`, justifyContent: "center", paddingHorizontal: 9 }}
          >
            <Text style={{ color: theme.accent, fontSize: 10, fontWeight: "800" }}>Quick</Text>
          </PressableScale>
        ) : null}
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Open bot computer"
          accessibilityHint={state.capabilities.computerPreview ? "Opens a read-only preview" : "Explains where the computer view is available"}
          onPress={() => {
            if (state.capabilities.computerPreview && state.enrollment?.mode === "host") {
              router.push({ pathname: "/agents/[agentId]/computer", params: { agentId: agent.id } });
              return;
            }
            Alert.alert(
              "Computer view is on your host",
              state.enrollment?.mode === "host"
                ? "This host does not expose a read-only computer preview to mobile. Open Cumea on the paired desktop or VM."
                : "Pair Cumea with your desktop or own VM to view the bot’s computer.",
            );
          }}
          style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" }}
        >
          <ComputerGlyph />
        </PressableScale>
        {agent.needsYou ? (
          <PressableScale accessibilityRole="button" accessibilityLabel="Open requests that need you" onPress={() => router.push("/needs-you")} style={{ minHeight: 34, borderRadius: 17, backgroundColor: `${theme.warning}20`, justifyContent: "center", paddingHorizontal: 11 }}>
            <Text style={{ color: theme.warning, fontSize: 11, fontWeight: "700" }}>Needs you</Text>
          </PressableScale>
        ) : null}
      </View>

      <KeyboardAvoidingView behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <FlatList
          ref={listRef}
          inverted
          data={reversedMessages}
          keyExtractor={(message) => message.id}
          renderItem={renderMessage}
          ListHeaderComponent={working || stream ? <StreamingBubble text={stream} /> : null}
          ListFooterComponent={paging?.initialized && paging.loading ? (
            <View
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel="Loading older messages"
              style={{ alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 13 }}
            >
              <ActivityIndicator color={theme.textSecondary} size="small" />
              <Text style={{ color: theme.textSecondary, fontSize: 12 }}>Loading earlier messages…</Text>
            </View>
          ) : null}
          contentContainerStyle={{ flexGrow: reversedMessages.length || working || stream ? undefined : 1, gap: 10, paddingHorizontal: 16, paddingVertical: 14 }}
          contentInsetAdjustmentBehavior="automatic"
          maintainVisibleContentPosition={MAINTAIN_VISIBLE_CONTENT_POSITION}
          onEndReached={loadOlder}
          onEndReachedThreshold={0.2}
          onScroll={updateBottomState}
          scrollEventThrottle={80}
          keyboardDismissMode={process.env.EXPO_OS === "ios" ? "interactive" : "on-drag"}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets={false}
          initialNumToRender={22}
          maxToRenderPerBatch={16}
          windowSize={9}
          ListEmptyComponent={working || stream ? null : paging?.loading && !paging.initialized ? (
            <View
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel="Loading conversation"
              style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 9, padding: 28 }}
            >
              <ActivityIndicator color={theme.textSecondary} />
              <Text style={{ color: theme.textSecondary, fontSize: 14 }}>Loading conversation…</Text>
            </View>
          ) : (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 7 }}>
              <Text style={{ color: theme.text, fontSize: 18, fontWeight: "700" }}>Start with a real handoff.</Text>
              <Text style={{ color: theme.textSecondary, fontSize: 14, lineHeight: 20, textAlign: "center" }}>Describe the outcome, where to work, and what should wait for your approval.</Text>
            </View>
          )}
        />
        {!atBottom && newerCount > 0 ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={`${newerCount} new ${newerCount === 1 ? "message" : "messages"}. Jump to latest.`}
            onPress={() => {
              listRef.current?.scrollToOffset({ offset: 0, animated: true });
              setAtBottom(true);
              setNewerCount(0);
            }}
            style={{
              position: "absolute",
              alignSelf: "center",
              bottom: 78,
              minHeight: 42,
              justifyContent: "center",
              borderRadius: 21,
              backgroundColor: theme.accent,
              paddingHorizontal: 16,
              shadowColor: "#000",
              shadowOpacity: 0.25,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 5 },
              elevation: 5,
            }}
          >
            <Text style={{ color: "#fff", fontSize: 13, fontWeight: "800" }}>
              {newerCount} new {newerCount === 1 ? "message" : "messages"} ↓
            </Text>
          </PressableScale>
        ) : null}
        <ChatComposer
          agentName={agent.name}
          working={working}
          screenFocused={screenFocused}
          attachmentsEnabled
          onSend={(text, attachments) => actions.sendMessage(agent.id, text, attachments)}
          onStop={() => actions.interrupt(agent.id)}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
