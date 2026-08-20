const KNOWN_FAILURE_REASONS = new Set([
  "speech-not-authorized",
  "recognizer-unavailable",
  "mic-failed",
  "recognition-error",
]);

export const MAX_SPEECH_LINE_CHARS = 64 * 1024;
export const MAX_SPEECH_TEXT_CHARS = 32 * 1024;

function normalizeFailure(reason) {
  return KNOWN_FAILURE_REASONS.has(reason) ? reason : "recognition-error";
}

/**
 * Parse one NDJSON message from the native helper. Only the public transcript
 * fields cross into the renderer; helper/native details are never forwarded.
 */
export function parseSpeechHelperLine(line) {
  if (typeof line !== "string" || line.length === 0 || line.length > MAX_SPEECH_LINE_CHARS) {
    return null;
  }

  let value;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  // Failure wins if a corrupted/hostile helper ever emits an ambiguous object.
  if (typeof value.error === "string") {
    return { type: "failure", reason: normalizeFailure(value.error) };
  }
  if (typeof value.text === "string") {
    if (value.text.length > MAX_SPEECH_TEXT_CHARS) {
      return { type: "failure", reason: "recognition-error" };
    }
    return {
      type: "transcript",
      value: { partial: value.partial === true, text: value.text },
    };
  }
  return null;
}

export function speechExitReason(code, helperReason = null) {
  if (helperReason) return helperReason;
  return code === 0 ? "completed" : "helper-exited";
}

/**
 * Incrementally decode helper stdout. `isCurrent` is checked on every chunk
 * and line so output buffered by a stopped/replaced helper cannot mutate the
 * active composer. Any protocol/helper failure closes this decoder for the
 * rest of the session.
 */
export function createSpeechOutputHandler({
  isCurrent,
  onTranscript,
  onFailure,
  maxBufferedChars = MAX_SPEECH_LINE_CHARS,
}) {
  let buffer = "";
  let failedClosed = false;

  const failClosed = (reason = "recognition-error") => {
    buffer = "";
    if (!failedClosed && isCurrent()) onFailure(reason);
    failedClosed = true;
  };

  return (chunk) => {
    if (!isCurrent() || failedClosed) return;
    buffer += String(chunk);

    if (!Number.isInteger(maxBufferedChars) || maxBufferedChars < 1) {
      failClosed();
      return;
    }

    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      if (!isCurrent() || failedClosed) return;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      if (line.length > MAX_SPEECH_LINE_CHARS) {
        failClosed();
        return;
      }
      const message = parseSpeechHelperLine(line);
      if (!message) {
        failClosed();
        return;
      }
      if (message.type === "transcript" && isCurrent()) {
        onTranscript(message.value);
        continue;
      }
      if (message.type === "failure" && isCurrent()) {
        failClosed(message.reason);
        return;
      }
    }

    if (buffer.length > maxBufferedChars) failClosed();
  };
}
