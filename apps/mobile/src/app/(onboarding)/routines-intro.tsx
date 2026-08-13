import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { MoteAvatar } from "@/components/mote-avatar";
import { OnboardingFrame } from "@/components/onboarding-frame";
import { theme } from "@/theme";

const avatar = { version: 1 as const, kind: "mote" as const, shapeId: "soft" as const, color: "#2f8de3", motion: "calm" as const };

export default function RoutinesIntroScreen() {
  const router = useRouter();
  return (
    <OnboardingFrame
      step={3}
      eyebrow="Routines"
      title="Recurring work, visible and under your control."
      body="Your host can run scheduled tasks and keep the durable history. Mobile shows what is next and when a bot needs your attention."
      onContinue={() => router.push("/integrations")}
      illustration={(
        <View style={{ width: "100%", maxWidth: 350, gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 13, borderRadius: 18, borderCurve: "continuous", backgroundColor: theme.card, padding: 15 }}>
            <MoteAvatar config={avatar} size={48} label="Inbox Manager" presence="working" />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={{ color: theme.text, fontSize: 16, fontWeight: "700" }}>Inbox cleanup</Text>
              <Text style={{ color: theme.textSecondary, fontSize: 13 }}>Every 6 hours</Text>
            </View>
            <View style={{ width: 40, height: 24, borderRadius: 20, backgroundColor: theme.success, padding: 3, alignItems: "flex-end" }}>
              <View style={{ width: 18, height: 18, borderRadius: 18, backgroundColor: theme.text }} />
            </View>
          </View>
          <View style={{ alignSelf: "center", borderRadius: 12, backgroundColor: `${theme.warning}22`, paddingHorizontal: 11, paddingVertical: 7 }}>
            <Text style={{ color: theme.warning, fontSize: 12, fontWeight: "700" }}>Needs you · approval requested</Text>
          </View>
        </View>
      )}
    />
  );
}
