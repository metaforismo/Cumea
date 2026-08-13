import assert from "node:assert/strict";
import test from "node:test";
import {
  dictationFailureForCode,
  isMissingNativeSpeechModule,
  mergeDictationTranscript,
  shouldAbortDictationForScreenFocus,
} from "./dictation.ts";

test("mergeDictationTranscript preserves the typed prefix without double spaces", () => {
  assert.equal(mergeDictationTranscript("Book the venue  ", "  tomorrow morning  "), "Book the venue tomorrow morning");
  assert.equal(mergeDictationTranscript("", "  hello Cumea "), "hello Cumea");
  assert.equal(mergeDictationTranscript("keep me", "   "), "keep me");
});

test("permission failures point to settings while a user abort stays silent", () => {
  assert.deepEqual(dictationFailureForCode("not-allowed"), {
    message: "Microphone and Speech Recognition access are needed for dictation.",
    canOpenSettings: true,
  });
  assert.equal(dictationFailureForCode("aborted"), null);
  assert.equal(dictationFailureForCode("no-speech")?.canOpenSettings, false);
});

test("missing native-module failures are recognized for the Expo Go fallback", () => {
  assert.equal(isMissingNativeSpeechModule(new Error("Cannot find native module 'ExpoSpeechRecognition'")), true);
  assert.equal(isMissingNativeSpeechModule(new Error("Network unavailable")), false);
});

test("screen blur aborts only an active dictation session", () => {
  assert.equal(shouldAbortDictationForScreenFocus(false, true), true);
  assert.equal(shouldAbortDictationForScreenFocus(false, false), false);
  assert.equal(shouldAbortDictationForScreenFocus(true, true), false);
});
