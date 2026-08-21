import { createContext, createElement, use, useMemo, type ReactNode } from "react";
import { useColorScheme } from "react-native";

export const darkTheme = {
  background: "#0a0a0a",
  panel: "#111111",
  card: "#252526",
  cardRaised: "#303033",
  input: "#202023",
  text: "#f2f2f2",
  textSecondary: "#99999f",
  hairline: "#343438",
  accent: "#0a84ff",
  success: "#26b37c",
  warning: "#ee9e18",
  danger: "#f35d64",
  userBubble: "#ecece8",
  userText: "#141414",
  control: "#1b1b1c",
  chrome: "#0a0a0af2",
} as const;

export const lightTheme: MobileTheme = {
  background: "#fbfbfa",
  panel: "#f5f5f3",
  card: "#f0f0ee",
  cardRaised: "#e9e9e6",
  input: "#efefed",
  text: "#111112",
  textSecondary: "#88888e",
  hairline: "#dededb",
  accent: "#087ff5",
  success: "#168e62",
  warning: "#b76a00",
  danger: "#d63d4c",
  userBubble: "#151516",
  userText: "#ffffff",
  control: "#ffffff",
  chrome: "#fbfbfaf2",
};

export type MobileTheme = { [Key in keyof typeof darkTheme]: string };
export type MobileColorScheme = "light" | "dark";

const ThemeContext = createContext<{ theme: MobileTheme; colorScheme: MobileColorScheme } | null>(null);

export function CumeaThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const colorScheme: MobileColorScheme = systemScheme === "light" ? "light" : "dark";
  const value = useMemo(() => ({
    colorScheme,
    theme: colorScheme === "light" ? lightTheme : darkTheme,
  }), [colorScheme]);
  return createElement(ThemeContext, { value }, children);
}

export function useCumeaTheme() {
  const context = use(ThemeContext);
  if (!context) throw new Error("useCumeaTheme must be used inside CumeaThemeProvider");
  return context;
}

/** Backward-compatible dark tokens for static, non-rendered helpers. New UI
 * should call useCumeaTheme so system appearance changes are reactive. */
export const theme = darkTheme;

export const hitSlop = { top: 10, right: 10, bottom: 10, left: 10 } as const;
