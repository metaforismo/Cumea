const KNOWN_FAILURE_REASONS = new Set([
  "speech-not-authorized",
  "recognizer-unavailable",
  "mic-failed",
  "recognition-error",
]);

/**
 * Parse one NDJSON message from the native helper without ever exposing
 * helper stderr or exception details to the renderer.
 */
export function parseSpeechHelperLine(line) {
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (typeof value.text === "string") {
    return {
      type: "transcript",
      value: { partial: value.partial === true, text: value.text },
    };
  }
  if (typeof value.error === "string") {
    return {
      type: "failure",
      reason: KNOWN_FAILURE_REASONS.has(value.error) ? value.error : "recognition-error",
    };
  }
  return null;
}

export function speechExitReason(code, helperReason = null) {
  if (helperReason) return helperReason;
  return code === 0 ? "completed" : "helper-exited";
}

/**
 * Incrementally decode helper stdout. `isCurrent` is checked both when a
 * chunk arrives and before every forwarded line so a stopped/replaced helper
 * can never mutate the active composer with buffered or late output.
 */
export function createSpeechOutputHandler({ isCurrent, onTranscript, onFailure }) {
  let buffer = "";
  return (chunk) => {
    if (!isCurrent()) return;
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      if (!isCurrent()) return;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const message = parseSpeechHelperLine(line);
      if (message?.type === "transcript" && isCurrent()) onTranscript(message.value);
      if (message?.type === "failure" && isCurrent()) onFailure(message.reason);
    }
  };
}
