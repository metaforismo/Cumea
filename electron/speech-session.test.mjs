import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import { createSpeechSessionManager } from "./speech-session.mjs";

function fakeProcess() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.kills = [];
  proc.kill = (signal) => {
    proc.kills.push(signal);
    return true;
  };
  return proc;
}

function harness(overrides = {}) {
  const sent = [];
  const spawned = [];
  const queue = [];
  const manager = createSpeechSessionManager({
    platform: "darwin",
    ensureBuilt: () => {},
    spawnHelper: () => {
      const proc = queue.shift() ?? fakeProcess();
      spawned.push(proc);
      return proc;
    },
    send: (target, channel, value) => sent.push({ target, channel, value }),
    ...overrides,
  });
  return { manager, sent, spawned, queue };
}

describe("native speech session manager", () => {
  it("fails closed on unsupported platforms without spawning", () => {
    let spawned = false;
    const sent = [];
    const manager = createSpeechSessionManager({
      platform: "linux",
      ensureBuilt: () => {},
      spawnHelper: () => {
        spawned = true;
        return fakeProcess();
      },
      send: (target, channel, value) => sent.push({ target, channel, value }),
    });

    assert.deepEqual(manager.start("window"), { started: false });
    assert.equal(spawned, false);
    assert.deepEqual(sent, [{
      target: "window",
      channel: "speech:end",
      value: { code: 1, reason: "unsupported-platform" },
    }]);
  });

  it("turns build/spawn failures into one public helper-unavailable result", () => {
    for (const failAt of ["build", "spawn"]) {
      const sent = [];
      const manager = createSpeechSessionManager({
        platform: "darwin",
        ensureBuilt: () => {
          if (failAt === "build") throw new Error("private build detail");
        },
        spawnHelper: () => {
          if (failAt === "spawn") throw new Error("private spawn detail");
          return fakeProcess();
        },
        send: (target, channel, value) => sent.push({ target, channel, value }),
      });
      assert.deepEqual(manager.start("window"), { started: false });
      assert.deepEqual(sent, [{
        target: "window",
        channel: "speech:end",
        value: { code: 1, reason: "helper-unavailable" },
      }]);
      assert.equal(JSON.stringify(sent).includes("private"), false);
    }
  });

  it("replaces a session before starting the next and ignores all late output", () => {
    const h = harness();
    const first = fakeProcess();
    const second = fakeProcess();
    h.queue.push(first, second);

    assert.deepEqual(h.manager.start("first-window"), { started: true });
    first.stdout.emit("data", '{"partial":true,"text":"first"}\n');
    assert.deepEqual(h.manager.start("second-window"), { started: true });
    assert.deepEqual(first.kills, ["SIGTERM"]);

    first.stdout.emit("data", '{"partial":false,"text":"late"}\n');
    first.emit("close", 0);
    second.stdout.emit("data", '{"partial":true,"text":"second"}\n');

    assert.deepEqual(
      h.sent.filter((event) => event.channel === "speech:transcript"),
      [
        { target: "first-window", channel: "speech:transcript", value: { partial: true, text: "first" } },
        { target: "second-window", channel: "speech:transcript", value: { partial: true, text: "second" } },
      ],
    );
    assert.equal(h.sent.some((event) => event.channel === "speech:end" && event.target === "first-window"), false);
  });

  it("settles helper failures once, kills the producer, and ignores later close/error", () => {
    const h = harness();
    const proc = fakeProcess();
    h.queue.push(proc);
    h.manager.start("window");

    proc.stdout.emit("data", '{"error":"mic-failed"}\n');
    proc.emit("close", 1);
    proc.emit("error", new Error("late native detail"));

    assert.deepEqual(proc.kills, ["SIGTERM"]);
    assert.deepEqual(h.sent, [{
      target: "window",
      channel: "speech:end",
      value: { code: 1, reason: "mic-failed" },
    }]);
  });

  it("reports clean completion exactly once", () => {
    const h = harness();
    const proc = fakeProcess();
    h.queue.push(proc);
    h.manager.start("window");
    proc.stdout.emit("data", '{"partial":false,"text":"done"}\n');
    proc.emit("close", 0);
    proc.emit("close", 0);

    assert.deepEqual(h.sent, [
      { target: "window", channel: "speech:transcript", value: { partial: false, text: "done" } },
      { target: "window", channel: "speech:end", value: { code: 0, reason: "completed" } },
    ]);
  });

  it("stop is idempotent, releases the helper and suppresses stale end", () => {
    const h = harness();
    const proc = fakeProcess();
    h.queue.push(proc);
    h.manager.start("window");

    assert.deepEqual(h.manager.stop(), { stopped: true });
    assert.deepEqual(h.manager.stop(), { stopped: false });
    proc.stdout.emit("data", '{"partial":false,"text":"late"}\n');
    proc.emit("close", 0);

    assert.deepEqual(proc.kills, ["SIGTERM"]);
    assert.deepEqual(h.sent, []);
  });

  it("rejects an invalid spawned process without leaving a live session", () => {
    const sent = [];
    const manager = createSpeechSessionManager({
      platform: "darwin",
      ensureBuilt: () => {},
      spawnHelper: () => ({}),
      send: (target, channel, value) => sent.push({ target, channel, value }),
    });
    assert.deepEqual(manager.start("window"), { started: false });
    assert.deepEqual(manager.stop(), { stopped: false });
    assert.deepEqual(sent[0]?.value, { code: 1, reason: "helper-unavailable" });
  });
});
