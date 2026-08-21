import { memo, useEffect, useMemo } from "react";
import { ActivityIndicator, Linking, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { Markdown } from "@believer/react-native-markdown-display";
import type { ChatMessage } from "@/host/types";
import { handoffStatusLabel } from "@/host/handoff";
import { useCumeaTheme, type MobileTheme } from "@/theme";
import { PressableScale } from "./pressable-scale";
import {
  closeUnterminatedMarkdownFence,
  MOBILE_MARKDOWN_LINK_POLICY,
  safeMarkdownExternalUrl,
} from "../../../../shared/markdown-policy";

const markdownStyle = (theme: MobileTheme) => ({
  body: { color: theme.text, fontSize: 16, lineHeight: 22, letterSpacing: -0.18 },
  text: { color: theme.text, fontSize: 16, lineHeight: 22, letterSpacing: -0.18 },
  paragraph: { marginTop: 0, marginBottom: 6 },
  heading1: { color: theme.text, fontSize: 23, lineHeight: 29, fontWeight: "800" as const, marginTop: 8, marginBottom: 8 },
  heading2: { color: theme.text, fontSize: 20, lineHeight: 26, fontWeight: "800" as const, marginTop: 8, marginBottom: 7 },
  heading3: { color: theme.text, fontSize: 18, lineHeight: 24, fontWeight: "700" as const, marginTop: 7, marginBottom: 6 },
  strong: { color: theme.text, fontWeight: "700" as const },
  link: { color: theme.accent, textDecorationLine: "underline" as const },
  bullet_list: { marginTop: 2, marginBottom: 8 },
  ordered_list: { marginTop: 2, marginBottom: 8 },
  list_item: { marginBottom: 3 },
  blockquote: { borderLeftWidth: 3, borderLeftColor: theme.hairline, paddingLeft: 11, opacity: 0.9 },
  code_inline: { color: theme.text, backgroundColor: theme.input, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 },
  fence: { color: theme.text, backgroundColor: theme.input, borderRadius: 12, padding: 12, marginVertical: 7 },
  code_block: { color: theme.text, backgroundColor: theme.input, borderRadius: 12, padding: 12, marginVertical: 7 },
});

function openSafeLink(url: string) {
  const safeUrl = safeMarkdownExternalUrl(url, MOBILE_MARKDOWN_LINK_POLICY);
  if (!safeUrl) return false;
  void Linking.openURL(safeUrl).catch(() => {});
  return false;
}

const AgentMarkdown = memo(function AgentMarkdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const { theme } = useCumeaTheme();
  const style = useMemo(() => markdownStyle(theme), [theme]);
  return (
    <Markdown
      style={style}
      mergeStyle
      onLinkPress={openSafeLink}
    >
      {streaming ? closeUnterminatedMarkdownFence(text) : text}
    </Markdown>
  );
});

function ThinkingDot({ index }: { index: number }) {
  const { theme } = useCumeaTheme();
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(0.3);
  useEffect(() => {
    if (reduceMotion) {
      opacity.value = 0.65;
      return;
    }
    opacity.value = withDelay(index * 160, withRepeat(withSequence(withTiming(1, { duration: 360 }), withTiming(0.3, { duration: 360 })), -1));
  }, [index, opacity, reduceMotion]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[{ width: 6, height: 6, borderRadius: 6, backgroundColor: theme.textSecondary }, style]} />;
}

interface MessageBubbleProps {
  message: ChatMessage;
  editable?: boolean;
  versionIndex?: number;
  versionCount?: number;
  switching?: boolean;
  onEdit?(): void;
  onPreviousVersion?(): void;
  onNextVersion?(): void;
  onCancelQueued?(): void;
  handoffTargetVisible?: boolean;
  onOpenHandoffTarget?(agentId: string): void;
}

const HandoffCard = memo(function HandoffCard({
  message,
  targetVisible,
  onOpenTarget,
}: {
  message: ChatMessage;
  targetVisible: boolean;
  onOpenTarget?(agentId: string): void;
}) {
  const { theme } = useCumeaTheme();
  const handoff = message.handoff;
  if (!handoff) {
    return (
      <View
        accessibilityRole="text"
        accessibilityLabel="Handoff unavailable. One or more agents are no longer visible."
        style={{ width: "100%", borderRadius: 16, borderCurve: "continuous", borderWidth: 1, borderColor: theme.hairline, backgroundColor: theme.card, padding: 14, gap: 5 }}
      >
        <Text selectable style={{ color: theme.text, fontSize: 15, lineHeight: 20, fontWeight: "700" }}>Handoff unavailable</Text>
        <Text selectable style={{ color: theme.text, fontSize: 13, lineHeight: 18 }}>One or more agents are no longer visible.</Text>
      </View>
    );
  }

  const statusLabel = handoffStatusLabel(handoff.status);
  const statusColor = handoff.status === "completed" ? theme.success : handoff.status === "failed" ? theme.danger : theme.warning;
  const routeLabel = `${handoff.fromName} to ${handoff.toName}`;
  const route = (
    <>
      <Text style={{ flexShrink: 1, color: theme.text, fontSize: 15, lineHeight: 20, fontWeight: "700" }}>{handoff.fromName}</Text>
      <Text accessibilityElementsHidden style={{ color: theme.textSecondary, fontSize: 17, lineHeight: 20 }}>→</Text>
      <Text style={{ flexShrink: 1, color: theme.text, fontSize: 15, lineHeight: 20, fontWeight: "700" }}>{handoff.toName}</Text>
      {targetVisible ? <Text accessibilityElementsHidden style={{ marginLeft: "auto", color: theme.textSecondary, fontSize: 18, lineHeight: 20 }}>›</Text> : null}
    </>
  );

  return (
    <View style={{ width: "100%", borderRadius: 16, borderCurve: "continuous", borderWidth: 1, borderColor: theme.hairline, backgroundColor: theme.card, paddingHorizontal: 14, paddingBottom: 14, gap: 12 }}>
      {targetVisible && onOpenTarget ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`Open ${handoff.toName} chat for handoff from ${handoff.fromName}`}
          accessibilityHint="Opens the destination agent chat"
          onPress={() => onOpenTarget(handoff.toAgentId)}
          style={{ minHeight: 44, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 7, paddingTop: 10 }}
        >
          {route}
        </PressableScale>
      ) : (
        <View accessibilityRole="text" accessibilityLabel={`Handoff from ${routeLabel}. Destination agent unavailable.`} style={{ minHeight: 44, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 7, paddingTop: 10 }}>
          {route}
        </View>
      )}
      <View accessibilityRole="text" accessibilityLabel={`Status: ${statusLabel}`} style={{ alignSelf: "flex-start", minHeight: 24, flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 12, backgroundColor: `${statusColor}18`, paddingHorizontal: 9, paddingVertical: 3 }}>
        <View accessibilityElementsHidden style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: statusColor }} />
        <Text style={{ color: theme.text, fontSize: 12, lineHeight: 17, fontWeight: "700" }}>{statusLabel}</Text>
      </View>
      <View style={{ gap: 4 }}>
        <Text style={{ color: theme.text, fontSize: 11, lineHeight: 15, fontWeight: "700", letterSpacing: 0.4 }}>PROMPT</Text>
        <Text selectable style={{ color: theme.text, fontSize: 15, lineHeight: 21 }}>{handoff.prompt}</Text>
      </View>
      {handoff.result ? (
        <View style={{ gap: 4, borderTopWidth: 1, borderTopColor: theme.hairline, paddingTop: 11 }}>
          <Text style={{ color: theme.text, fontSize: 11, lineHeight: 15, fontWeight: "700", letterSpacing: 0.4 }}>RESULT</Text>
          <Text selectable style={{ color: theme.text, fontSize: 15, lineHeight: 21 }}>{handoff.result}</Text>
        </View>
      ) : null}
    </View>
  );
});

export const MessageBubble = memo(function MessageBubble({
  message,
  editable = false,
  versionIndex = 0,
  versionCount = 1,
  switching = false,
  onEdit,
  onPreviousVersion,
  onNextVersion,
  onCancelQueued,
  handoffTargetVisible = false,
  onOpenHandoffTarget,
}: MessageBubbleProps) {
  const { theme } = useCumeaTheme();
  if (message.kind === "context") {
    return (
      <View accessibilityRole="text" accessibilityLabel={`Task context: ${message.text}`} style={{ width: "100%", flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 }}>
        <View style={{ flex: 1, height: 1, backgroundColor: theme.hairline }} />
        <Text selectable style={{ color: theme.textSecondary, fontSize: 11, fontWeight: "700" }}>{message.text}</Text>
        <View style={{ flex: 1, height: 1, backgroundColor: theme.hairline }} />
      </View>
    );
  }
  if (message.kind === "handoff") {
    return <HandoffCard message={message} targetVisible={handoffTargetVisible} onOpenTarget={onOpenHandoffTarget} />;
  }
  if (message.role === "system" || message.kind === "activity") {
    return (
      <View style={{ alignItems: "center", paddingVertical: 4 }}>
        <Text selectable style={{ color: message.status === "error" ? theme.danger : theme.textSecondary, fontSize: 12, textAlign: "center" }}>
          {message.text}
        </Text>
      </View>
    );
  }
  const user = message.role === "user";
  return (
    <View style={{ width: "100%", alignItems: user ? "flex-end" : "flex-start" }}>
      <View
        style={{
          maxWidth: "88%",
          borderRadius: 18,
          borderCurve: "continuous",
          paddingHorizontal: 14,
          paddingVertical: 10,
          backgroundColor: user ? theme.userBubble : theme.card,
          opacity: message.status === "sending" ? 0.72 : 1,
          borderWidth: message.status === "error" ? 1 : 0,
          borderColor: theme.danger,
        }}
      >
        {message.text ? user ? (
          <Text selectable style={{ color: theme.userText, fontSize: 16, lineHeight: 22, letterSpacing: -0.18 }}>{message.text}</Text>
        ) : (
          <AgentMarkdown text={message.text} streaming={message.status === "streaming"} />
        ) : null}
        {message.attachments?.length ? (
          <View style={{ gap: 6, paddingTop: message.text ? 9 : 0 }}>
            {message.attachments.map((attachment) => (
              <View key={attachment.id} style={{ borderRadius: 9, backgroundColor: user ? `${theme.userText}1a` : theme.input, paddingHorizontal: 9, paddingVertical: 7 }}>
                <Text numberOfLines={1} style={{ color: user ? theme.userText : theme.text, fontSize: 12, fontWeight: "600" }}>{attachment.name}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
      {user && message.delivery ? (
        <View style={{ minHeight: 30, flexDirection: "row", alignItems: "center", gap: 4, paddingTop: 2 }}>
          <Text style={{ color: theme.textSecondary, fontSize: 11 }}>
            {message.delivery === "queued" ? "Queued" : message.delivery === "cancelled" ? "Cancelled" : message.delivery === "failed" ? "Couldn’t start" : "Sent"}
          </Text>
          {message.delivery === "queued" && onCancelQueued ? (
            <PressableScale accessibilityRole="button" accessibilityLabel="Cancel queued message" onPress={onCancelQueued} style={{ minWidth: 44, minHeight: 30, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: theme.textSecondary, fontSize: 11, fontWeight: "700" }}>Cancel</Text>
            </PressableScale>
          ) : null}
        </View>
      ) : null}
      {message.status === "error" ? <Text style={{ color: theme.danger, fontSize: 11, paddingTop: 4 }}>Not delivered</Text> : null}
      {user && message.status === "done" && (editable || versionCount > 1) ? (
        <View style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 2, paddingTop: 2 }}>
          {versionCount > 1 ? (
            <>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Previous message version"
                disabled={switching || versionIndex <= 0}
                onPress={onPreviousVersion}
                style={{ width: 44, height: 44, opacity: versionIndex <= 0 ? 0.35 : 1, alignItems: "center", justifyContent: "center" }}
              >
                <Text style={{ color: theme.textSecondary, fontSize: 22 }}>‹</Text>
              </PressableScale>
              <Text accessibilityLabel={`Version ${versionIndex + 1} of ${versionCount}`} style={{ color: theme.textSecondary, fontSize: 11, fontVariant: ["tabular-nums"] }}>
                {versionIndex + 1}/{versionCount}
              </Text>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Next message version"
                disabled={switching || versionIndex >= versionCount - 1}
                onPress={onNextVersion}
                style={{ width: 44, height: 44, opacity: versionIndex >= versionCount - 1 ? 0.35 : 1, alignItems: "center", justifyContent: "center" }}
              >
                <Text style={{ color: theme.textSecondary, fontSize: 22 }}>›</Text>
              </PressableScale>
              {switching ? <ActivityIndicator accessibilityLabel="Switching conversation version" color={theme.textSecondary} size="small" /> : null}
            </>
          ) : null}
          {editable ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Edit and rerun this message"
              disabled={switching}
              onPress={onEdit}
              style={{ minWidth: 44, height: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 }}
            >
              <Text style={{ color: theme.textSecondary, fontSize: 12, fontWeight: "700" }}>Edit</Text>
            </PressableScale>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

export const StreamingBubble = memo(function StreamingBubble({ text }: { text: string }) {
  const { theme } = useCumeaTheme();
  const reduceMotion = useReducedMotion();
  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeIn.duration(160)}
      exiting={reduceMotion ? undefined : FadeOut.duration(120)}
      style={{ width: "100%", alignItems: "flex-start" }}
    >
      <View style={{ maxWidth: "88%", borderRadius: 18, borderCurve: "continuous", backgroundColor: theme.card, paddingHorizontal: 14, paddingVertical: 10 }}>
        {text ? (
          <View>
            <AgentMarkdown text={text} streaming />
            <Text accessibilityElementsHidden style={{ color: theme.textSecondary, fontSize: 16, lineHeight: 18 }}>▍</Text>
          </View>
        ) : (
          <View accessibilityLabel="Agent is thinking" style={{ flexDirection: "row", gap: 5, paddingVertical: 6 }}>
            {[0, 1, 2].map((index) => (
              <ThinkingDot key={index} index={index} />
            ))}
          </View>
        )}
      </View>
    </Animated.View>
  );
});
