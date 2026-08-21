import type { ExpoSpeechRecognitionErrorCode } from "expo-speech-recognition";

export interface DictationFailure {
  message: string;
  canOpenSettings: boolean;
}

export function preferredSpeechLocale() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || "en-US";
  } catch {
    return "en-US";
  }
}

export function mergeDictationTranscript(base: string, transcript: string) {
  const next = transcript.trim();
  if (!next) return base;
  const prefix = base.trimEnd();
  return prefix ? `${prefix} ${next}` : next;
}

export function dictationFailureForCode(
  code: ExpoSpeechRecognitionErrorCode,
): DictationFailure | null {
  switch (code) {
    case "aborted":
      return null;
    case "not-allowed":
      return {
        message: "Microphone and Speech Recognition access are needed for dictation.",
        canOpenSettings: true,
      };
    case "no-speech":
    case "speech-timeout":
      return { message: "No speech was detected. Try again when you’re ready.", canOpenSettings: false };
    case "audio-capture":
      return { message: "Cumea could not access the microphone.", canOpenSettings: true };
    case "service-not-allowed":
      return {
        message: "No speech-recognition service is enabled on this device.",
        canOpenSettings: true,
      };
    case "language-not-supported":
      return {
        message: "The device speech service does not support your current language.",
        canOpenSettings: true,
      };
    case "network":
      return {
        message: "The device speech service could not connect. Check your connection and try again.",
        canOpenSettings: false,
      };
    case "interrupted":
      return { message: "Dictation was interrupted by another audio session.", canOpenSettings: false };
    case "busy":
      return { message: "The device speech service is busy. Try again in a moment.", canOpenSettings: false };
    case "bad-grammar":
    case "client":
    case "unknown":
      return { message: "Dictation stopped unexpectedly. Please try again.", canOpenSettings: false };
  }
}

export function isMissingNativeSpeechModule(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /ExpoSpeechRecognition|native module/i.test(message);
}

export function shouldAbortDictationForScreenFocus(isFocused: boolean, isActive: boolean) {
  return !isFocused && isActive;
}
