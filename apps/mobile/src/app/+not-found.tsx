import { Text, View } from "react-native";
import { Link } from "expo-router";
import { theme } from "@/theme";

export default function NotFoundScreen() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 28, backgroundColor: theme.background }}>
      <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 26, fontWeight: "800" }}>That screen is not here.</Text>
      <Link href="/" style={{ color: theme.accent, fontSize: 17 }}>Return to your bots</Link>
    </View>
  );
}
