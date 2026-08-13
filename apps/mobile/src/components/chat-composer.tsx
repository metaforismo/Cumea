import { useEffect, useMemo, useState } from "react";
import { Alert, Text, TextInput, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { PendingAttachment } from "@/host/types";
import { useNativeDictation } from "@/speech/use-native-dictation";
import { PressableScale } from "./pressable-scale";
import { theme } from "@/theme";

interface ChatComposerProps {
  agentName: string;
  working: boolean;
  screenFocused?: boolean;
  attachmentsEnabled?: boolean;
  onSend(text: string, attachments: PendingAttachment[]): Promise<void>;
  onStop(): Promise<void>;
}

function MicrophoneGlyph({ color = theme.background }: { color?: string }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: 17, height: 21, alignItems: "center" }}>
      <View style={{ width: 8, height: 13, borderRadius: 5, borderWidth: 2, borderColor: color }} />
      <View style={{ position: "absolute", top: 8, width: 15, height: 9, borderLeftWidth: 2, borderRightWidth: 2, borderBottomWidth: 2, borderColor: color, borderBottomLeftRadius: 8, borderBottomRightRadius: 8 }} />
      <View style={{ position: "absolute", bottom: 0, width: 2, height: 4, backgroundColor: color }} />
    </View>
  );
}

export function ChatComposer({ agentName, working, screenFocused = true, attachmentsEnabled = true, onSend, onStop }: ChatComposerProps) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const dictationContext = useMemo(() => ["Cumea", agentName], [agentName]);
  const dictation = useNativeDictation({
    value: text,
    onChangeText: setText,
    contextualStrings: dictationContext,
    screenFocused,
  });
  const canSend = Boolean(text.trim() || attachments.length);
  const showMicrophone = dictation.active || (!working && !sending && !text.trim() && attachments.length === 0);

  useEffect(() => {
    if ((working || sending) && dictation.active) dictation.abort();
  }, [dictation.active, dictation.abort, sending, working]);

  const pick = async () => {
    if (dictation.active) dictation.abort();
    try {
      const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
      if (result.canceled) return;
      const next = result.assets.map((asset) => ({
        uri: asset.uri,
        name: asset.name,
        mime: asset.mimeType ?? "application/octet-stream",
        size: asset.size ?? 0,
      }));
      if ([...attachments, ...next].length > 10 || next.some((attachment) => attachment.size > 25 * 1024 * 1024)) {
        Alert.alert("Attachment limit", "Add up to 10 files, no larger than 25 MB each.");
        return;
      }
      setAttachments((current) => [...current, ...next]);
    } catch (error) {
      Alert.alert("Could not add file", error instanceof Error ? error.message : String(error));
    }
  };

  const send = async () => {
    if (sending) return;
    if (dictation.active) dictation.abort();
    if (!text.trim() && attachments.length === 0) {
      Alert.alert("Add a message", "Dictate or type what you want the bot to do.");
      return;
    }
    const outgoingText = text;
    const outgoingAttachments = attachments;
    setText("");
    setAttachments([]);
    setSending(true);
    if (process.env.EXPO_OS === "ios") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await onSend(outgoingText, outgoingAttachments);
    } catch (error) {
      Alert.alert("Could not send", error instanceof Error ? error.message : String(error));
      setText(outgoingText);
      setAttachments(outgoingAttachments);
    } finally {
      setSending(false);
    }
  };

  const stop = async () => {
    try {
      await onStop();
    } catch (error) {
      Alert.alert("Could not stop", error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 8), backgroundColor: theme.background }}>
      {dictation.failure ? (
        <View
          accessibilityLiveRegion="assertive"
          style={{ marginHorizontal: 6, marginBottom: 8, flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, borderCurve: "continuous", borderWidth: 1, borderColor: `${theme.danger}66`, backgroundColor: `${theme.danger}14`, paddingHorizontal: 11, paddingVertical: 9 }}
        >
          <Text selectable style={{ flex: 1, color: theme.text, fontSize: 12, lineHeight: 17 }}>{dictation.failure.message}</Text>
          {dictation.failure.canOpenSettings ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Open system settings"
              hitSlop={6}
              onPress={() => void dictation.openSettings()}
              style={{ minHeight: 32, justifyContent: "center", borderRadius: 16, backgroundColor: theme.cardRaised, paddingHorizontal: 11 }}
            >
              <Text style={{ color: theme.text, fontSize: 12, fontWeight: "700" }}>Settings</Text>
            </PressableScale>
          ) : null}
        </View>
      ) : null}
      {dictation.statusLabel ? (
        <View
          accessibilityLiveRegion="polite"
          accessibilityRole="text"
          style={{ marginHorizontal: 7, marginBottom: 7, flexDirection: "row", alignItems: "center", gap: 7 }}
        >
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: theme.danger }} />
          <Text style={{ color: theme.textSecondary, fontSize: 12, fontWeight: "600" }}>{dictation.statusLabel}</Text>
        </View>
      ) : null}
      {attachments.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7, paddingHorizontal: 6, paddingBottom: 8 }}>
          {attachments.map((attachment, index) => (
            <PressableScale
              key={`${attachment.uri}-${index}`}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${attachment.name}`}
              onPress={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}
              style={{ maxWidth: 190, borderRadius: 10, backgroundColor: theme.cardRaised, paddingHorizontal: 10, paddingVertical: 7 }}
            >
              <Text numberOfLines={1} style={{ color: theme.text, fontSize: 12 }}>{attachment.name}  ×</Text>
            </PressableScale>
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={attachmentsEnabled ? "Add attachment" : "Attachments are available from desktop"}
          disabled={!attachmentsEnabled}
          onPress={() => void pick()}
          style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: theme.hairline, opacity: attachmentsEnabled ? 1 : 0.38, alignItems: "center", justifyContent: "center" }}
        >
          <Text style={{ color: theme.text, fontSize: 27, lineHeight: 29 }}>＋</Text>
        </PressableScale>
        <View style={{ flex: 1, minHeight: 46, maxHeight: 140, flexDirection: "row", alignItems: "flex-end", gap: 8, borderRadius: 24, borderCurve: "continuous", borderWidth: 1, borderColor: theme.hairline, backgroundColor: theme.input, paddingLeft: 15, paddingRight: 6, paddingVertical: 5 }}>
          <TextInput
            accessibilityLabel={`Message ${agentName}`}
            value={text}
            onChangeText={dictation.handleTextChange}
            placeholder={dictation.statusLabel ?? `Ask ${agentName}`}
            placeholderTextColor={theme.textSecondary}
            multiline
            maxLength={20_000}
            blurOnSubmit={false}
            style={{ flex: 1, maxHeight: 126, color: theme.text, fontSize: 16, lineHeight: 22, paddingVertical: 7 }}
          />
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={working ? "Stop agent" : dictation.active ? "Stop dictation" : showMicrophone ? "Start dictation" : canSend ? "Send message" : "Add a message before sending attachments"}
            accessibilityHint={showMicrophone && !dictation.active ? "Transcribes speech into this message using the device speech service" : undefined}
            accessibilityState={{ busy: dictation.phase === "requesting" || dictation.phase === "stopping", selected: dictation.active }}
            hitSlop={6}
            disabled={sending || dictation.phase === "stopping"}
            onPress={() => {
              if (working) void stop();
              else if (dictation.active) dictation.stop();
              else if (showMicrophone) void dictation.start();
              else void send();
            }}
            style={{ width: 36, height: 36, borderRadius: 18, opacity: working || canSend || showMicrophone ? 1 : 0.4, alignItems: "center", justifyContent: "center", backgroundColor: dictation.active ? theme.danger : theme.text }}
          >
            {working ? (
              <Text style={{ color: theme.background, fontSize: 16, fontWeight: "800" }}>■</Text>
            ) : showMicrophone ? (
              <MicrophoneGlyph color={dictation.active ? theme.text : theme.background} />
            ) : (
              <Text style={{ color: theme.background, fontSize: 20, fontWeight: "800" }}>↑</Text>
            )}
          </PressableScale>
        </View>
      </View>
    </View>
  );
}
