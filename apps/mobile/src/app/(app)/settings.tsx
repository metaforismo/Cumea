import { Alert, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { PressableScale } from "@/components/pressable-scale";
import { useCumea } from "@/state/cumea-store";
import { theme } from "@/theme";

export default function SettingsScreen() {
  const router = useRouter();
  const { state, actions } = useCumea();
  const enrollment = state.enrollment;
  const disconnect = () => {
    Alert.alert(
      "Disconnect this phone?",
      "The host token will be removed from this phone. You can also revoke the device from Cumea desktop.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: () => void actions.disconnect()
            .then(() => router.replace("/pair"))
            .catch((error) => Alert.alert("Could not disconnect", error instanceof Error ? error.message : String(error))),
        },
      ],
    );
  };
  return (
    <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={{ height: 62, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: theme.hairline, paddingHorizontal: 12 }}>
        <PressableScale accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={{ width: 42, height: 42, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: theme.text, fontSize: 31 }}>‹</Text>
        </PressableScale>
        <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 20, fontWeight: "800" }}>Settings</Text>
      </View>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 18, gap: 18 }}>
        <View style={{ gap: 6 }}>
          <Text style={{ color: theme.textSecondary, fontSize: 12, fontWeight: "700" }}>PROFILE</Text>
          <View style={{ borderRadius: 17, borderCurve: "continuous", backgroundColor: theme.card, padding: 15, gap: 4 }}>
            <Text style={{ color: theme.text, fontSize: 17, fontWeight: "700" }}>{state.profile.name}</Text>
            {state.profile.email ? <Text style={{ color: theme.textSecondary, fontSize: 13 }}>{state.profile.email}</Text> : null}
          </View>
        </View>
        <View style={{ gap: 6 }}>
          <Text style={{ color: theme.textSecondary, fontSize: 12, fontWeight: "700" }}>HOST</Text>
          <View style={{ borderRadius: 17, borderCurve: "continuous", backgroundColor: theme.card, padding: 15, gap: 11 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
              <View style={{ width: 9, height: 9, borderRadius: 9, backgroundColor: state.connection === "online" || state.connection === "demo" ? theme.success : state.connection === "connecting" ? theme.warning : theme.danger }} />
              <Text style={{ color: theme.text, fontSize: 15, fontWeight: "700" }}>{state.connection === "demo" ? "Local demo" : state.connection === "online" ? "Connected" : state.connection === "connecting" ? "Connecting" : "Offline"}</Text>
            </View>
            {enrollment?.mode === "host" ? (
              <>
                {state.hostName ? <Text style={{ color: theme.text, fontSize: 14, fontWeight: "700" }}>{state.hostName}</Text> : null}
                <Text selectable style={{ color: theme.textSecondary, fontSize: 13, lineHeight: 19 }}>{enrollment.hostUrl}</Text>
                <Text selectable style={{ color: theme.textSecondary, fontSize: 11 }}>Device {enrollment.deviceId}</Text>
              </>
            ) : (
              <Text style={{ color: theme.textSecondary, fontSize: 13 }}>Sample data stays on this phone.</Text>
            )}
            <PressableScale accessibilityRole="button" onPress={() => void actions.refresh()} style={{ alignSelf: "flex-start", minHeight: 38, borderRadius: 19, borderWidth: 1, borderColor: theme.hairline, justifyContent: "center", paddingHorizontal: 14 }}>
              <Text style={{ color: theme.text, fontSize: 13, fontWeight: "700" }}>Refresh now</Text>
            </PressableScale>
          </View>
        </View>
        {state.error ? (
          <View accessibilityRole="alert" style={{ borderRadius: 14, backgroundColor: `${theme.danger}1f`, padding: 13, gap: 8 }}>
            <Text style={{ color: theme.danger, fontSize: 13, lineHeight: 19 }}>{state.error}</Text>
            <PressableScale accessibilityRole="button" onPress={actions.clearError} style={{ alignSelf: "flex-start", minHeight: 34, justifyContent: "center" }}>
              <Text style={{ color: theme.text, fontSize: 13, fontWeight: "700" }}>Dismiss</Text>
            </PressableScale>
          </View>
        ) : null}
        <View style={{ borderRadius: 17, borderCurve: "continuous", backgroundColor: theme.card, padding: 15, gap: 6 }}>
          <Text style={{ color: theme.text, fontSize: 15, fontWeight: "700" }}>Self-hosted by design</Text>
          <Text style={{ color: theme.textSecondary, fontSize: 13, lineHeight: 19 }}>Cumea does not provision an always-on computer for you. Provider credentials, apps, browser sessions, and durable work remain on the host you control.</Text>
        </View>
        <PressableScale accessibilityRole="button" onPress={disconnect} style={{ minHeight: 48, borderRadius: 24, borderWidth: 1, borderColor: `${theme.danger}80`, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: theme.danger, fontSize: 15, fontWeight: "700" }}>Disconnect this phone</Text>
        </PressableScale>
      </ScrollView>
    </SafeAreaView>
  );
}
