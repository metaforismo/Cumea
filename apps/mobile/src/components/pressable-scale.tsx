import type { ReactNode } from "react";
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

interface PressableScaleProps extends Omit<PressableProps, "children" | "style"> {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  pressedScale?: number;
}

export function PressableScale({ children, style, pressedScale = 0.97, ...props }: PressableScaleProps) {
  const reduceMotion = useReducedMotion();
  return (
    <Pressable
      {...props}
      style={({ pressed }) => [
        style,
        pressed && {
          opacity: 0.78,
          ...(reduceMotion ? {} : { transform: [{ scale: pressedScale }] }),
        },
      ]}
    >
      {children}
    </Pressable>
  );
}
