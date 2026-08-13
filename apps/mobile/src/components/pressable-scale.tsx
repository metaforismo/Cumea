import type { ReactNode } from "react";
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";

interface PressableScaleProps extends Omit<PressableProps, "children" | "style"> {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  pressedScale?: number;
}

export function PressableScale({ children, style, pressedScale = 0.97, ...props }: PressableScaleProps) {
  return (
    <Pressable
      {...props}
      style={({ pressed }) => [style, pressed && { opacity: 0.78, transform: [{ scale: pressedScale }] }]}
    >
      {children}
    </Pressable>
  );
}
