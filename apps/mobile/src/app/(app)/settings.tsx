import { Alert, Linking, ScrollView, Switch, Text, View } from "react-native";
import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { PressableScale } from "@/components/pressable-scale";
import { useCumea } from "@/state/cumea-store";
import { useCumeaTheme } from "@/theme";
import {
  disablePushNotifications,
  enablePushNotifications,
  pushRegistrationState,
  type PushRegistrationState,
} from "@/notifications/push";

export default function SettingsScreen() {
  const { theme } = useCumeaTheme();
  const router = useRouter();
  const { state, actions } = useCumea();
  const enrollment = state.enrollment;
  const [pushState, setPushState] = useState<PushRegistrationState>("disabled");
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void pushRegistrationState(enrollment)
      .then((value) => active && setPushState(value))
      .catch(() => active && setPushState("unavailable"));
    return () => { active = false; };
  }, [enrollment]);

  const togglePush = async (enabled: boolean) => {
    if (pushBusy) return;
    setPushBusy(true);
    try {
      if (enabled) {
        const next = await enablePushNotifications(enrollment);
        setPushState(next);
        if (next === "denied") {
          Alert.alert("Notifications are disabled", "Allow notifications for Cumea in system settings.", [
            { text: "Cancel", style: "cancel" },
            { text: "Open Settings", onPress: () => void Linking.openSettings() },
          ]);
        }
      } else {
        await disablePushNotifications(enrollment);
        setPushState("disabled");
      }
    } catch (error) {
      Alert.alert("Could not update notifications", error instanceof Error ? error.message : String(error));
    } finally {
      setPushBusy(false);
    }
  };
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
          <Text style={{ color: theme.textSecondary, fontSize: 12, fontWeight: "700" }}>WORK</Text>
          <View style={{ overflow: "hidden", borderRadius: 17, borderCurve: "continuous", backgroundColor: theme.card }}>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`${state.attention.length} items need you`}
              onPress={() => router.push("/needs-you")}
              style={{ minHeight: 52, flexDirection: "row", alignItems: "center", paddingHorizontal: 15 }}
            >
              <Text style={{ color: theme.text, fontSize: 15, fontWeight: "700" }}>Needs you</Text>
              <Text style={{ marginLeft: "auto", color: state.attention.length ? theme.warning : theme.textSecondary, fontSize: 13, fontWeight: "700" }}>{state.attention.length || "None"}  ›</Text>
            </PressableScale>
            <View style={{ height: 1, marginLeft: 15, backgroundColor: theme.hairline }} />
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="View routines"
              onPress={() => router.push("/routines")}
              style={{ minHeight: 52, flexDirection: "row", alignItems: "center", paddingHorizontal: 15 }}
            >
              <Text style={{ color: theme.text, fontSize: 15, fontWeight: "700" }}>Routines</Text>
              <Text style={{ marginLeft: "auto", color: theme.textSecondary, fontSize: 13 }}>{state.routines.filter((routine) => routine.enabled).length} active  ›</Text>
            </PressableScale>
          </View>
        </View>
        <View style={{ gap: 6 }}>
          <Text style={{ color: theme.textSecondary, fontSize: 12, fontWeight: "700" }}>NOTIFICATIONS</Text>
          <View style={{ minHeight: 70, borderRadius: 17, borderCurve: "continuous", backgroundColor: theme.card, paddingHorizontal: 15, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={{ color: theme.text, fontSize: 15, fontWeight: "700" }}>Agent updates</Text>
              <Text style={{ color: theme.textSecondary, fontSize: 12, lineHeight: 17 }}>
                {pushState === "enabled"
                  ? "Completion and Needs-you alerts. Message content is never included."
                  : pushState === "denied"
                    ? "Disabled in system settings."
                    : pushState === "unavailable"
                      ? "Unavailable in this build or connection."
                      : "Off. Cumea will ask before enabling."}
              </Text>
            </View>
            <Switch
              accessibilityLabel="Agent update notifications"
              value={pushState === "enabled"}
              disabled={pushBusy || pushState === "unavailable"}
              onValueChange={(value) => void togglePush(value)}
              trackColor={{ false: theme.hairline, true: `${theme.success}80` }}
              thumbColor={pushState === "enabled" ? theme.success : theme.textSecondary}
            />
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
