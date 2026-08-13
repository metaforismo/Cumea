import { useState } from "react";
import { Alert, Text, TextInput, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { PendingAttachment } from "@/host/types";
import { PressableScale } from "./pressable-scale";
import { theme } from "@/theme";

interface ChatComposerProps {
  agentName: string;
  working: boolean;
  attachmentsEnabled?: boolean;
  onSend(text: string, attachments: PendingAttachment[]): Promise<void>;
  onStop(): Promise<void>;
}

function MicrophoneGlyph() {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: 17, height: 21, alignItems: "center" }}>
      <View style={{ width: 8, height: 13, borderRadius: 5, borderWidth: 2, borderColor: theme.background }} />
      <View style={{ position: "absolute", top: 8, width: 15, height: 9, borderLeftWidth: 2, borderRightWidth: 2, borderBottomWidth: 2, borderColor: theme.background, borderBottomLeftRadius: 8, borderBottomRightRadius: 8 }} />
      <View style={{ position: "absolute", bottom: 0, width: 2, height: 4, backgroundColor: theme.background }} />
    </View>
  );
}

export function ChatComposer({ agentName, working, attachmentsEnabled = true, onSend, onStop }: ChatComposerProps) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const canSend = Boolean(text.trim());
  const showMicrophone = !working && !sending && !text.trim() && attachments.length === 0;

  const pick = async () => {
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
    if (!text.trim()) {
      Alert.alert("Add a message", "Tell the bot what to do with the attached files before sending.");
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
            onChangeText={setText}
            placeholder={`Ask ${agentName}`}
            placeholderTextColor={theme.textSecondary}
            multiline
            maxLength={20_000}
            blurOnSubmit={false}
            style={{ flex: 1, maxHeight: 126, color: theme.text, fontSize: 16, lineHeight: 22, paddingVertical: 7 }}
          />
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={working ? "Stop agent" : showMicrophone ? "Voice input unavailable" : canSend ? "Send message" : "Add a message before sending attachments"}
            accessibilityHint={showMicrophone ? "Voice input is not enabled in this build" : undefined}
            disabled={sending}
            onPress={() => {
              if (working) void stop();
              else if (showMicrophone) Alert.alert("Voice input isn’t enabled yet", "Use the keyboard to message this bot.");
              else void send();
            }}
            style={{ width: 36, height: 36, borderRadius: 18, opacity: working || canSend || showMicrophone ? 1 : 0.4, alignItems: "center", justifyContent: "center", backgroundColor: theme.text }}
          >
            {working ? (
              <Text style={{ color: theme.background, fontSize: 16, fontWeight: "800" }}>■</Text>
            ) : showMicrophone ? (
              <MicrophoneGlyph />
            ) : (
              <Text style={{ color: theme.background, fontSize: 20, fontWeight: "800" }}>↑</Text>
            )}
          </PressableScale>
        </View>
      </View>
    </View>
  );
}
