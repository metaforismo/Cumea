export type SpeechEndReason =
  | "completed"
  | "speech-not-authorized"
  | "recognizer-unavailable"
  | "mic-failed"
  | "recognition-error"
  | "helper-unavailable"
  | "helper-exited"
  | "unsupported-platform";

export type SpeechSettingsPane = "mic" | "speech";

export type SpeechIssue = {
  message: string;
  settingsPane?: SpeechSettingsPane;
};

export function speechIssueFor(reason: SpeechEndReason | undefined, code: number | null): SpeechIssue | null {
  switch (reason) {
    case "completed":
      return null;
    case "speech-not-authorized":
      return {
        message: "Speech Recognition access is off. Allow Cumea to transcribe dictation in System Settings.",
        settingsPane: "speech",
      };
    case "mic-failed":
      return {
        message: "Cumea couldn’t start the microphone. Check Microphone access, then try again.",
        settingsPane: "mic",
      };
    case "recognizer-unavailable":
      return { message: "Speech recognition isn’t available for the current language or device right now." };
    case "recognition-error":
      return { message: "Dictation stopped before it could finish. Please try again." };
    case "helper-unavailable":
      return { message: "The desktop speech helper is unavailable. Rebuild Cumea, then try again." };
    case "unsupported-platform":
      return { message: "Native voice dictation is currently available on macOS only." };
    case "helper-exited":
      return { message: "Dictation stopped unexpectedly. Please try again." };
    default:
      return code === 0 ? null : { message: "Dictation stopped unexpectedly. Please try again." };
  }
}
