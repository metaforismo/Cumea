import { memo, useEffect } from "react";
import { Linking, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { Markdown } from "@believer/react-native-markdown-display";
import type { ChatMessage } from "@/host/types";
import { theme } from "@/theme";

const markdownStyle = {
  body: { color: theme.text, fontSize: 16, lineHeight: 23 },
  text: { color: theme.text, fontSize: 16, lineHeight: 23 },
  paragraph: { marginTop: 0, marginBottom: 8 },
  heading1: { color: theme.text, fontSize: 23, lineHeight: 29, fontWeight: "800" as const, marginTop: 8, marginBottom: 8 },
  heading2: { color: theme.text, fontSize: 20, lineHeight: 26, fontWeight: "800" as const, marginTop: 8, marginBottom: 7 },
  heading3: { color: theme.text, fontSize: 18, lineHeight: 24, fontWeight: "700" as const, marginTop: 7, marginBottom: 6 },
  strong: { color: theme.text, fontWeight: "800" as const },
  link: { color: theme.accent, textDecorationLine: "underline" as const },
  bullet_list: { marginTop: 2, marginBottom: 8 },
  ordered_list: { marginTop: 2, marginBottom: 8 },
  list_item: { marginBottom: 3 },
  blockquote: { borderLeftWidth: 3, borderLeftColor: theme.hairline, paddingLeft: 11, opacity: 0.9 },
  code_inline: { color: theme.text, backgroundColor: theme.input, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 },
  fence: { color: theme.text, backgroundColor: theme.input, borderRadius: 12, padding: 12, marginVertical: 7 },
  code_block: { color: theme.text, backgroundColor: theme.input, borderRadius: 12, padding: 12, marginVertical: 7 },
};

function openSafeLink(url: string) {
  if (!/^https:\/\//i.test(url) && !/^mailto:/i.test(url)) return false;
  void Linking.openURL(url);
  return false;
}

const AgentMarkdown = memo(function AgentMarkdown({ text }: { text: string }) {
  return (
    <Markdown
      style={markdownStyle}
      mergeStyle
      onLinkPress={openSafeLink}
    >
      {text}
    </Markdown>
  );
});

function ThinkingDot({ index }: { index: number }) {
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

export const MessageBubble = memo(function MessageBubble({ message }: { message: ChatMessage }) {
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
          maxWidth: "82%",
          borderRadius: 20,
          borderCurve: "continuous",
          paddingHorizontal: 15,
          paddingVertical: 11,
          backgroundColor: user ? theme.userBubble : theme.card,
          opacity: message.status === "sending" ? 0.72 : 1,
          borderWidth: message.status === "error" ? 1 : 0,
          borderColor: theme.danger,
        }}
      >
        {message.text ? user ? (
          <Text selectable style={{ color: theme.userText, fontSize: 16, lineHeight: 23 }}>{message.text}</Text>
        ) : (
          <AgentMarkdown text={message.text} />
        ) : null}
        {message.attachments?.length ? (
          <View style={{ gap: 6, paddingTop: message.text ? 9 : 0 }}>
            {message.attachments.map((attachment) => (
              <View key={attachment.id} style={{ borderRadius: 9, backgroundColor: user ? "#d3d3cf" : theme.input, paddingHorizontal: 9, paddingVertical: 7 }}>
                <Text numberOfLines={1} style={{ color: user ? theme.userText : theme.text, fontSize: 12, fontWeight: "600" }}>{attachment.name}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
      {message.status === "queued" ? <Text style={{ color: theme.textSecondary, fontSize: 11, paddingTop: 4 }}>Queued · sends after the current turn</Text> : null}
      {message.status === "error" ? <Text style={{ color: theme.danger, fontSize: 11, paddingTop: 4 }}>Not delivered</Text> : null}
    </View>
  );
});

export const StreamingBubble = memo(function StreamingBubble({ text }: { text: string }) {
  return (
    <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={{ width: "100%", alignItems: "flex-start" }}>
      <View style={{ maxWidth: "82%", borderRadius: 20, borderCurve: "continuous", backgroundColor: theme.card, paddingHorizontal: 15, paddingVertical: 11 }}>
        {text ? (
          <View>
            <AgentMarkdown text={text} />
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
