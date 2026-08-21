import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { OnboardingFrame } from "@/components/onboarding-frame";
import { useCumea } from "@/state/cumea-store";
import { useCumeaTheme } from "@/theme";

const tools = ["Browser", "Terminal", "Email", "Calendar", "CRM", "Files"];

export default function IntegrationsScreen() {
  const { theme } = useCumeaTheme();
  const router = useRouter();
  const { actions } = useCumea();
  const finish = async () => {
    await actions.finishOnboarding();
    router.replace("/pair");
  };
  return (
    <OnboardingFrame
      step={4}
      eyebrow="Open ecosystem"
      title="Bring your models, tools, and logins."
      body="Cumea stays provider-neutral. Connect OpenAI, Anthropic, xAI, local models, MCP tools, and the apps available on your own host."
      actionLabel="Pair my host"
      onContinue={() => void finish()}
      illustration={(
        <View style={{ width: "100%", maxWidth: 340, flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 9 }}>
          {tools.map((tool, index) => (
            <View key={tool} style={{ width: "30%", minWidth: 94, borderRadius: 16, borderCurve: "continuous", borderWidth: 1, borderColor: theme.hairline, backgroundColor: index % 2 ? theme.card : theme.panel, paddingVertical: 18, alignItems: "center", gap: 7 }}>
              <Text style={{ color: theme.text, fontSize: 22 }}>{["◎", ">_", "✉", "◫", "⌘", "▤"][index]}</Text>
              <Text style={{ color: theme.textSecondary, fontSize: 12, fontWeight: "700" }}>{tool}</Text>
            </View>
          ))}
        </View>
      )}
    />
  );
}
