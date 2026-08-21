import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import {
  createSpeechOutputHandler,
  parseSpeechHelperLine,
  speechExitReason,
} from "./speech-contract.mjs";

describe("native speech helper protocol", () => {
  it("accepts only the public transcript fields", () => {
    assert.deepEqual(
      parseSpeechHelperLine('{"partial":true,"text":"hello","internal":"secret"}'),
      { type: "transcript", value: { partial: true, text: "hello" } },
    );
  });

  it("normalizes unknown and malformed helper output", () => {
    assert.deepEqual(parseSpeechHelperLine('{"error":"some-native-detail"}'), {
      type: "failure",
      reason: "recognition-error",
    });
    assert.equal(parseSpeechHelperLine("not-json"), null);
    assert.equal(parseSpeechHelperLine("[]"), null);
  });

  it("preserves a specific failure over a generic process exit", () => {
    assert.equal(speechExitReason(1, "mic-failed"), "mic-failed");
    assert.equal(speechExitReason(0), "completed");
    assert.equal(speechExitReason(1), "helper-exited");
  });

  it("ignores stdout emitted by an old helper after stop and replacement", () => {
    const oldProcess = { stdout: new EventEmitter() };
    const oldSession = {
      proc: oldProcess,
      finished: false,
      suppressEnd: false,
    };
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
});
