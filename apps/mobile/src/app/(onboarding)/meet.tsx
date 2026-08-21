import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { MoteAvatar } from "@/components/mote-avatar";
import { OnboardingFrame } from "@/components/onboarding-frame";
import { useCumeaTheme } from "@/theme";

const avatars = [
  { version: 1 as const, kind: "mote" as const, shapeId: "drop" as const, color: "#f56a16", motion: "playful" as const },
  { version: 1 as const, kind: "mote" as const, shapeId: "peak" as const, color: "#d72879", motion: "calm" as const },
  { version: 1 as const, kind: "mote" as const, shapeId: "ripple" as const, color: "#19ae7a", motion: "kinetic" as const },
];

export default function MeetScreen() {
  const { theme } = useCumeaTheme();
  const router = useRouter();
  return (
    <OnboardingFrame
      step={1}
      eyebrow="Meet Cumea"
      title="AI teammates you can actually hand work to."
      body="Create named bots for different jobs, keep their conversations separate, and step in only when a decision needs you."
      onContinue={() => router.push("/host")}
      illustration={(
        <View style={{ alignItems: "center", gap: 24 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 12 }}>
            <MoteAvatar config={avatars[1]} size={74} label="Executive Assistant" />
            <MoteAvatar config={avatars[0]} size={104} label="Chief of Staff" />
            <MoteAvatar config={avatars[2]} size={74} label="Research Agent" />
          </View>
          <View style={{ borderRadius: 20, borderCurve: "continuous", backgroundColor: theme.card, paddingHorizontal: 18, paddingVertical: 12 }}>
            <Text style={{ color: theme.text, fontSize: 15, fontWeight: "700" }}>Three teammates. One private host.</Text>
          </View>
        </View>
      )}
    />
  );
}
