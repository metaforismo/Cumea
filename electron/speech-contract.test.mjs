import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import {
  MAX_SPEECH_LINE_CHARS,
  MAX_SPEECH_TEXT_CHARS,
  createSpeechOutputHandler,
  parseSpeechHelperLine,
  speechExitReason,
} from "./speech-contract.mjs";

describe("native speech helper protocol", () => {
  it("accepts only bounded public transcript fields", () => {
    assert.deepEqual(
      parseSpeechHelperLine('{"partial":true,"text":"hello","internal":"secret"}'),
      { type: "transcript", value: { partial: true, text: "hello" } },
    );
    assert.deepEqual(
      parseSpeechHelperLine(JSON.stringify({ text: "x".repeat(MAX_SPEECH_TEXT_CHARS + 1) })),
      { type: "failure", reason: "recognition-error" },
    );
  });

  it("normalizes unknown errors and gives failure precedence over ambiguous text", () => {
    assert.deepEqual(parseSpeechHelperLine('{"error":"some-native-detail"}'), {
      type: "failure",
      reason: "recognition-error",
    });
    assert.deepEqual(parseSpeechHelperLine('{"error":"mic-failed","text":"ignore me"}'), {
      type: "failure",
      reason: "mic-failed",
    });
    assert.equal(parseSpeechHelperLine("not-json"), null);
    assert.equal(parseSpeechHelperLine("[]"), null);
    assert.equal(parseSpeechHelperLine("x".repeat(MAX_SPEECH_LINE_CHARS + 1)), null);
  });

  it("preserves a specific failure over a generic process exit", () => {
    assert.equal(speechExitReason(1, "mic-failed"), "mic-failed");
    assert.equal(speechExitReason(0), "completed");
    assert.equal(speechExitReason(1), "helper-exited");
    assert.equal(speechExitReason(null), "helper-exited");
  });

  it("decodes fragmented NDJSON without exposing extra fields", () => {
    const transcripts = [];
    const failures = [];
    const handler = createSpeechOutputHandler({
      isCurrent: () => true,
      onTranscript: (value) => transcripts.push(value),
      onFailure: (reason) => failures.push(reason),
    });
    handler('{"partial":true,"text":"hel');
    handler('lo","native":"hidden"}\n');
    assert.deepEqual(transcripts, [{ partial: true, text: "hello" }]);
    assert.deepEqual(failures, []);
  });

  it("fails closed after a malformed non-empty protocol line", () => {
    const transcripts = [];
    const failures = [];
    const handler = createSpeechOutputHandler({
      isCurrent: () => true,
      onTranscript: (value) => transcripts.push(value),
      onFailure: (reason) => failures.push(reason),
    });
    handler('not-json\n{"partial":false,"text":"must stay blocked"}\n');
    assert.deepEqual(transcripts, []);
    assert.deepEqual(failures, ["recognition-error"]);
  });

  it("fails closed after a helper error even when more transcript is buffered in the same chunk", () => {
    const transcripts = [];
    const failures = [];
    const handler = createSpeechOutputHandler({
      isCurrent: () => true,
      onTranscript: (value) => transcripts.push(value),
      onFailure: (reason) => failures.push(reason),
    });
    handler('{"error":"mic-failed"}\n{"partial":false,"text":"must stay blocked"}\n');
    handler('{"partial":false,"text":"also blocked later"}\n');
    assert.deepEqual(transcripts, []);
    assert.deepEqual(failures, ["mic-failed"]);
  });

  it("ignores stdout emitted by an old helper after stop and replacement", () => {
    const oldProcess = { stdout: new EventEmitter() };
    const oldSession = { proc: oldProcess, finished: false, suppressEnd: false };
    let activeSession = oldSession;
    const transcripts = [];
    const failures = [];
    oldProcess.stdout.on("data", createSpeechOutputHandler({
      isCurrent: () => (
        activeSession === oldSession
        && !oldSession.finished
        && !oldSession.suppressEnd
      ),
      onTranscript: (value) => transcripts.push(value),
      onFailure: (reason) => failures.push(reason),
    }));

    oldProcess.stdout.emit("data", '{"partial":true,"text":"current"}\n');
    activeSession = null;
    oldSession.finished = true;
    oldSession.suppressEnd = true;
    oldProcess.stdout.emit("data", '{"partial":false,"text":"late after stop"}\n');
    activeSession = { proc: { stdout: new EventEmitter() }, finished: false, suppressEnd: false };
    oldProcess.stdout.emit("data", '{"error":"recognition-error"}\n');

    assert.deepEqual(transcripts, [{ partial: true, text: "current" }]);
    assert.deepEqual(failures, []);
  });

  it("bounds unterminated helper output, reports overflow once and stays fail closed", () => {
    const transcripts = [];
    const failures = [];
    const handler = createSpeechOutputHandler({
      isCurrent: () => true,
      onTranscript: (value) => transcripts.push(value),
      onFailure: (reason) => failures.push(reason),
      maxBufferedChars: 16,
    });
    handler("x".repeat(17));
    handler('{"partial":false,"text":"must stay blocked"}\n');
    assert.deepEqual(transcripts, []);
    assert.deepEqual(failures, ["recognition-error"]);
  });
});
