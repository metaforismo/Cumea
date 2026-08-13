import { memo, useEffect } from "react";
import { Image, View } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { eyeColorFor, SHAPE_PATHS } from "@/avatar/shapes";
import type { AgentPresence, AvatarConfig } from "@/host/types";
import { theme } from "@/theme";

interface MoteAvatarProps {
  config: AvatarConfig;
  size?: number;
  label: string;
  presence?: AgentPresence;
  unread?: boolean;
}

export const MoteAvatar = memo(function MoteAvatar({
  config,
  size = 48,
  label,
  presence = "idle",
  unread = false,
}: MoteAvatarProps) {
  const reduceMotion = useReducedMotion();
  const drift = useSharedValue(0);
  const tilt = useSharedValue(0);
  const gazeX = useSharedValue(0);
  const gazeY = useSharedValue(0);
  const blink = useSharedValue(1);
  const scale = useSharedValue(1);

  useEffect(() => {
    for (const value of [drift, tilt, gazeX, gazeY, blink, scale]) cancelAnimation(value);
    drift.value = 0;
    tilt.value = 0;
    gazeX.value = 0;
    gazeY.value = 0;
    blink.value = 1;
    scale.value = 1;
    if (reduceMotion) return;

    const duration = config.motion === "kinetic" ? 1650 : config.motion === "playful" ? 2600 : 4200;
    drift.value = withRepeat(withSequence(withTiming(-size * 0.035, { duration }), withTiming(0, { duration })), -1);
    tilt.value = withRepeat(withSequence(withTiming(1.2, { duration }), withTiming(-1.2, { duration })), -1, true);

    if (presence === "needs-you") {
      // A waiting bot quietly looks around instead of flashing for attention.
      gazeX.value = withRepeat(
        withSequence(withTiming(-size * 0.055, { duration: 720 }), withDelay(420, withTiming(size * 0.065, { duration: 900 })), withTiming(0, { duration: 620 })),
        -1,
      );
      gazeY.value = withRepeat(
        withSequence(withTiming(size * 0.025, { duration: 900 }), withTiming(-size * 0.02, { duration: 1100 }), withTiming(0, { duration: 600 })),
        -1,
      );
    } else if (presence === "working") {
      gazeX.value = withRepeat(withSequence(withTiming(size * 0.04, { duration: 440 }), withTiming(-size * 0.04, { duration: 440 })), -1, true);
    } else if (presence === "success") {
      scale.value = withSequence(withSpring(1.12, { damping: 13, stiffness: 240 }), withSpring(1));
    } else if (presence === "error") {
      tilt.value = withSequence(withTiming(-5, { duration: 70 }), withTiming(5, { duration: 100 }), withTiming(0, { duration: 100 }));
    }
  }, [config.motion, drift, gazeX, gazeY, presence, reduceMotion, scale, size, tilt, blink]);

  useEffect(() => {
    if (reduceMotion) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        blink.value = withSequence(withTiming(0.08, { duration: 85 }), withTiming(1, { duration: 115 }));
        schedule();
      }, 2600 + Math.random() * 3300);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [blink, reduceMotion]);

  const bodyStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: drift.value },
      { rotate: `${tilt.value}deg` },
      { scale: scale.value },
    ],
  }));
  const eyesStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: gazeX.value }, { translateY: gazeY.value }, { scaleY: blink.value }],
  }));
  const eye = config.eyeColor ?? eyeColorFor(config.color);

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${label}, ${presence === "needs-you" ? "needs your input" : presence}`}
      style={{ width: size, height: size }}
    >
      <Animated.View style={[{ width: size, height: size }, bodyStyle]}>
        {config.kind === "upload" && config.imageDataUrl ? (
          <Image accessible={false} source={{ uri: config.imageDataUrl }} resizeMode="cover" style={{ width: size, height: size, borderRadius: size * 0.3, backgroundColor: config.color }} />
        ) : (
          <>
            <Svg width={size} height={size} viewBox="35 35 250 250" accessibilityElementsHidden>
              <Path d={SHAPE_PATHS[config.shapeId]} fill={config.color} />
            </Svg>
            <Animated.View
              pointerEvents="none"
              style={[
                {
                  position: "absolute",
                  left: size * 0.38,
                  top: size * 0.385,
                  width: size * 0.29,
                  height: size * 0.25,
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                },
                eyesStyle,
              ]}
            >
              <View style={{ width: size * 0.055, height: size * 0.135, borderRadius: size, backgroundColor: eye, transform: [{ rotate: "7deg" }] }} />
              <View style={{ width: size * 0.055, height: size * 0.135, borderRadius: size, backgroundColor: eye, transform: [{ rotate: "7deg" }] }} />
            </Animated.View>
          </>
        )}
      </Animated.View>
      {(unread || presence === "needs-you") && (
        <View
          accessibilityElementsHidden
          style={{
            position: "absolute",
            right: 0,
            bottom: 1,
            width: size * 0.22,
            height: size * 0.22,
            borderRadius: size,
            borderWidth: 2,
            borderColor: theme.background,
            backgroundColor: presence === "needs-you" ? theme.warning : theme.accent,
          }}
        />
      )}
    </View>
  );
});
