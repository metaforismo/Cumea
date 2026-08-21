import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking } from "react-native";
import * as Haptics from "expo-haptics";
import type {
  ExpoSpeechRecognitionErrorEvent,
  ExpoSpeechRecognitionResultEvent,
} from "expo-speech-recognition";
import {
  dictationFailureForCode,
  isMissingNativeSpeechModule,
  mergeDictationTranscript,
  preferredSpeechLocale,
  shouldAbortDictationForScreenFocus,
  type DictationFailure,
} from "./dictation";

type SpeechModule = typeof import("expo-speech-recognition")["ExpoSpeechRecognitionModule"];
type SpeechSubscription = { remove(): void };
type DictationPhase = "idle" | "requesting" | "listening" | "stopping";

interface UseNativeDictationOptions {
  value: string;
  onChangeText(value: string): void;
  contextualStrings?: string[];
  screenFocused?: boolean;
}

let speechModulePromise: Promise<SpeechModule> | null = null;

async function loadSpeechModule() {
  if (!speechModulePromise) {
    speechModulePromise = import("expo-speech-recognition")
      .then(({ ExpoSpeechRecognitionModule }) => ExpoSpeechRecognitionModule)
      .catch((error) => {
        speechModulePromise = null;
        throw error;
      });
  }
  return speechModulePromise;
}

export function useNativeDictation({
  value,
  onChangeText,
  contextualStrings = [],
  screenFocused = true,
}: UseNativeDictationOptions) {
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const [failure, setFailure] = useState<DictationFailure | null>(null);
  const mountedRef = useRef(true);
  const phaseRef = useRef<DictationPhase>("idle");
  const sessionRef = useRef(0);
  const moduleRef = useRef<SpeechModule | null>(null);
  const subscriptionsRef = useRef<SpeechSubscription[]>([]);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef(value);
  const onChangeTextRef = useRef(onChangeText);
  const baseTextRef = useRef("");

  valueRef.current = value;
  onChangeTextRef.current = onChangeText;

  const updatePhase = useCallback((next: DictationPhase) => {
    phaseRef.current = next;
    if (mountedRef.current) setPhase(next);
  }, []);

  const removeListeners = useCallback(() => {
    for (const subscription of subscriptionsRef.current.splice(0)) {
      try {
        subscription.remove();
      } catch {
        // A native teardown can race an app-background or route change.
      }
    }
  }, []);

  const clearStopTimer = useCallback(() => {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    stopTimerRef.current = null;
  }, []);

  const finishSession = useCallback((session: number) => {
    if (sessionRef.current !== session) return;
    clearStopTimer();
    removeListeners();
    moduleRef.current = null;
    updatePhase("idle");
  }, [clearStopTimer, removeListeners, updatePhase]);

  const abort = useCallback(() => {
    sessionRef.current += 1;
    clearStopTimer();
    removeListeners();
    const speechModule = moduleRef.current;
    moduleRef.current = null;
    try {
      speechModule?.abort();
    } catch {
      // Best-effort privacy teardown; the session token ignores late events.
    }
    updatePhase("idle");
  }, [clearStopTimer, removeListeners, updatePhase]);

  const stop = useCallback(() => {
    if (phaseRef.current === "requesting") {
      abort();
      return;
    }
    const speechModule = moduleRef.current;
    if (!speechModule || phaseRef.current === "idle" || phaseRef.current === "stopping") return;
    const session = sessionRef.current;
    updatePhase("stopping");
    try {
      speechModule.stop();
      stopTimerRef.current = setTimeout(() => {
        if (sessionRef.current !== session) return;
        finishSession(session);
        try {
          speechModule.abort();
        } catch {}
      }, 4_000);
    } catch {
      finishSession(session);
      if (mountedRef.current) {
        setFailure({ message: "Dictation could not be stopped cleanly.", canOpenSettings: false });
      }
    }
  }, [abort, finishSession, updatePhase]);

  const start = useCallback(async () => {
    if (!screenFocused || phaseRef.current !== "idle") return;
    const session = sessionRef.current + 1;
    sessionRef.current = session;
    baseTextRef.current = valueRef.current;
    setFailure(null);
    updatePhase("requesting");
    if (process.env.EXPO_OS === "ios") {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    try {
      const speechModule = await loadSpeechModule();
      if (!mountedRef.current || sessionRef.current !== session) return;
      if (!speechModule.isRecognitionAvailable()) {
        finishSession(session);
        setFailure({
          message: "No speech-recognition service is enabled on this device.",
          canOpenSettings: true,
        });
        return;
      }

      let permission = await speechModule.getPermissionsAsync();
      if (!mountedRef.current || sessionRef.current !== session) return;
      if (!permission.granted) permission = await speechModule.requestPermissionsAsync();
      if (!mountedRef.current || sessionRef.current !== session) return;
      if (!permission.granted) {
        finishSession(session);
        setFailure({
          message: "Microphone and Speech Recognition access are needed for dictation.",
          canOpenSettings: true,
        });
        return;
      }

      moduleRef.current = speechModule;
      subscriptionsRef.current = [
        speechModule.addListener("start", () => {
          if (sessionRef.current !== session) return;
          updatePhase("listening");
        }),
        speechModule.addListener("result", (event: ExpoSpeechRecognitionResultEvent) => {
          if (sessionRef.current !== session) return;
          const transcript = event.results[0]?.transcript;
          if (!transcript) return;
          onChangeTextRef.current(mergeDictationTranscript(baseTextRef.current, transcript));
        }),
        speechModule.addListener("error", (event: ExpoSpeechRecognitionErrorEvent) => {
          if (sessionRef.current !== session) return;
          const nextFailure = dictationFailureForCode(event.error);
          if (nextFailure && mountedRef.current) setFailure(nextFailure);
          finishSession(session);
          try {
            speechModule.abort();
          } catch {
            // The native recognizer may already have torn itself down.
          }
        }),
        speechModule.addListener("end", () => finishSession(session)),
      ];

      speechModule.start({
        lang: preferredSpeechLocale(),
        interimResults: true,
        continuous: false,
        maxAlternatives: 1,
        contextualStrings: [...new Set(contextualStrings.filter(Boolean))].slice(0, 30),
        addsPunctuation: true,
        iosTaskHint: "dictation",
        recordingOptions: { persist: false },
      });
    } catch (error) {
      if (sessionRef.current !== session) return;
      finishSession(session);
      if (!mountedRef.current) return;
      setFailure(
        isMissingNativeSpeechModule(error)
          ? {
              message: "Dictation needs a Cumea development build; Expo Go does not include its native speech module.",
              canOpenSettings: false,
            }
          : { message: "Dictation could not start. Please try again.", canOpenSettings: false },
      );
    }
  }, [contextualStrings, finishSession, screenFocused, updatePhase]);

  const handleTextChange = useCallback((next: string) => {
    if (phaseRef.current !== "idle") abort();
    setFailure(null);
    onChangeTextRef.current(next);
  }, [abort]);

  const openSettings = useCallback(async () => {
    try {
      await Linking.openSettings();
    } catch {
      setFailure({
        message: "Open system Settings to enable Microphone and Speech Recognition for Cumea.",
        canOpenSettings: false,
      });
    }
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active" && phaseRef.current !== "idle") abort();
    });
    return () => subscription.remove();
  }, [abort]);

  useEffect(() => {
    if (shouldAbortDictationForScreenFocus(screenFocused, phaseRef.current !== "idle")) {
      abort();
    }
  }, [abort, screenFocused]);

  useEffect(() => {
    // React Strict Mode mounts effects twice in development. Restore the flag
    // so a valid second mount can still receive native callbacks.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abort();
    };
  }, [abort]);

  const active = phase !== "idle";
  return {
    phase,
    active,
    listening: phase === "listening",
    failure,
    statusLabel:
      phase === "requesting"
        ? "Preparing dictation…"
        : phase === "stopping"
          ? "Finishing dictation…"
          : phase === "listening"
            ? "Listening…"
            : null,
    start,
    stop,
    abort,
    handleTextChange,
    openSettings,
    clearFailure: () => setFailure(null),
  };
}
