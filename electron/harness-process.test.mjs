import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  HARNESS_READY_KIND,
  HARNESS_READY_VERSION,
  parseHarnessReadyMessage,
  waitForHarnessReady,
} from "./harness-process.mjs";

class FakeProcess extends EventEmitter {
  constructor(pid) {
    super();
    this.pid = pid;
  }
}

test("readiness accepts only the exact child PID and a bounded TCP port", () => {
  assert.deepEqual(
    parseHarnessReadyMessage(
      {
        kind: HARNESS_READY_KIND,
        version: HARNESS_READY_VERSION,
        pid: 42,
        port: 43123,
        ignored: "metadata",
      },
      42,
    ),
    {
      kind: HARNESS_READY_KIND,
      version: HARNESS_READY_VERSION,
      pid: 42,
      port: 43123,
    },
  );
  assert.equal(parseHarnessReadyMessage({ kind: "other" }, 42), null);
  assert.throws(
    () =>
      parseHarnessReadyMessage(
        { kind: HARNESS_READY_KIND, version: 1, pid: 99, port: 43123 },
        42,
      ),
    /PID does not match/,
  );
  assert.throws(
    () =>
      parseHarnessReadyMessage(
        { kind: HARNESS_READY_KIND, version: 1, pid: 42, port: 0 },
        42,
      ),
    /port is invalid/,
  );
});

test("wait ignores unrelated messages and resolves exactly once", async () => {
  const child = new FakeProcess(123);
  const pending = waitForHarnessReady(child, { timeoutMs: 2_000 });
  child.emit("message", { kind: "noise" });
  child.emit("message", {
    kind: HARNESS_READY_KIND,
    version: HARNESS_READY_VERSION,
    pid: 123,
    port: 42001,
  });
  child.emit("exit", 1);
  assert.deepEqual(await pending, {
    kind: HARNESS_READY_KIND,
    version: HARNESS_READY_VERSION,
    pid: 123,
    port: 42001,
  });
  assert.equal(child.listenerCount("message"), 0);
  assert.equal(child.listenerCount("exit"), 0);
});

test("wait fails when the child exits before announcing readiness", async () => {
  const child = new FakeProcess(124);
  const pending = waitForHarnessReady(child, { timeoutMs: 2_000 });
  child.emit("exit", 7);
  await assert.rejects(pending, /exited before readiness \(code 7\)/);
});

test("wait rejects malformed readiness from the exact child channel", async () => {
  const child = new FakeProcess(125);
  const pending = waitForHarnessReady(child, { timeoutMs: 2_000 });
  child.emit("message", {
    kind: HARNESS_READY_KIND,
    version: HARNESS_READY_VERSION,
    pid: 126,
    port: 41000,
  });
  await assert.rejects(pending, /PID does not match/);
});

test("wait times out instead of probing a TCP port", async () => {
  const child = new FakeProcess(127);
  await assert.rejects(
    waitForHarnessReady(child, { timeoutMs: 1_000 }),
    /did not become ready within 1000 ms/,
  );
});
