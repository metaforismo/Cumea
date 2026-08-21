import type { ReactNode } from "react";
import { ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PressableScale } from "./pressable-scale";
import { useCumeaTheme } from "@/theme";

interface OnboardingFrameProps {
  step: number;
  eyebrow: string;
  title: string;
  body: string;
  illustration: ReactNode;
  actionLabel?: string;
  onContinue(): void;
  secondaryLabel?: string;
  onSecondary?(): void;
}

export function OnboardingFrame({
  step,
  eyebrow,
  title,
  body,
  illustration,
  actionLabel = "Continue",
  onContinue,
  secondaryLabel,
  onSecondary,
}: OnboardingFrameProps) {
  const { theme } = useCumeaTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const compact = width < 390;
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={{
        flexGrow: 1,
        paddingTop: Math.max(insets.top, 20) + 12,
        paddingBottom: Math.max(insets.bottom, 16),
        paddingHorizontal: compact ? 22 : 30,
        justifyContent: "space-between",
        gap: 28,
      }}
    >
      <View style={{ flexDirection: "row", gap: 6 }} accessibilityLabel={`Onboarding step ${step} of 4`}>
        {[1, 2, 3, 4].map((value) => (
          <View
            key={value}
            style={{
              width: value === step ? 24 : 7,
              height: 7,
              borderRadius: 20,
              backgroundColor: value <= step ? theme.text : theme.hairline,
            }}
          />
        ))}
      </View>

      <View style={{ alignItems: "center", justifyContent: "center", minHeight: compact ? 220 : 300 }}>
        {illustration}
      </View>

      <View style={{ gap: 12 }}>
        <Text selectable style={{ color: theme.textSecondary, fontSize: 13, fontWeight: "700", letterSpacing: 1.1, textTransform: "uppercase" }}>
          {eyebrow}
        </Text>
        <Text selectable accessibilityRole="header" style={{ color: theme.text, fontSize: compact ? 32 : 38, lineHeight: compact ? 37 : 43, fontWeight: "800", letterSpacing: -1.2 }}>
          {title}
        </Text>
        <Text selectable style={{ color: theme.textSecondary, fontSize: 17, lineHeight: 25 }}>
          {body}
        </Text>
      </View>

      <View style={{ gap: 10 }}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onContinue}
          style={{ minHeight: 54, borderRadius: 27, backgroundColor: theme.text, alignItems: "center", justifyContent: "center", paddingHorizontal: 22 }}
        >
          <Text style={{ color: theme.background, fontSize: 17, fontWeight: "700" }}>{actionLabel}</Text>
        </PressableScale>
        {secondaryLabel && onSecondary ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={secondaryLabel}
            onPress={onSecondary}
            style={{ minHeight: 46, alignItems: "center", justifyContent: "center" }}
          >
            <Text style={{ color: theme.textSecondary, fontSize: 15, fontWeight: "600" }}>{secondaryLabel}</Text>
          </PressableScale>
        ) : null}
      </View>
    </ScrollView>
  );
}
