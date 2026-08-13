import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { OnboardingFrame } from "@/components/onboarding-frame";
import { theme } from "@/theme";

export default function HostScreen() {
  const router = useRouter();
  return (
    <OnboardingFrame
      step={2}
      eyebrow="Your computer"
      title="You choose where the work runs."
      body="Pair this phone with Cumea on your desktop or your own authenticated HTTPS VM. Scan its QR inside this app, paste the payload, or enter the fields manually; links opened by the operating system are never used for pairing. The host runs with your laptop off only if you provide an always-on machine."
      onContinue={() => router.push("/routines-intro")}
      illustration={(
        <View style={{ width: "100%", maxWidth: 340, alignItems: "center" }}>
          <View style={{ width: "88%", aspectRatio: 1.55, borderRadius: 19, borderCurve: "continuous", borderWidth: 1, borderColor: theme.hairline, backgroundColor: theme.card, padding: 14 }}>
            <View style={{ flexDirection: "row", gap: 5, paddingBottom: 11 }}>
              {["#f35d64", "#ee9e18", "#26b37c"].map((color) => <View key={color} style={{ width: 7, height: 7, borderRadius: 7, backgroundColor: color }} />)}
            </View>
            <View style={{ flex: 1, borderRadius: 11, backgroundColor: theme.input, alignItems: "center", justifyContent: "center", gap: 8 }}>
              <Text style={{ color: theme.text, fontSize: 28 }}>⌁</Text>
              <Text style={{ color: theme.textSecondary, fontSize: 12 }}>Cumea host online</Text>
            </View>
          </View>
          <View style={{ marginTop: -22, width: 92, height: 132, borderRadius: 22, borderCurve: "continuous", borderWidth: 3, borderColor: theme.text, backgroundColor: theme.background, alignItems: "center", justifyContent: "center" }}>
            <View style={{ width: 48, height: 2, backgroundColor: theme.success }} />
            <Text style={{ marginTop: 9, color: theme.textSecondary, fontSize: 10 }}>Paired</Text>
          </View>
        </View>
      )}
    />
  );
}
