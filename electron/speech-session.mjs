import { createSpeechOutputHandler, speechExitReason } from "./speech-contract.mjs";

function asFunction(value, label) {
  if (typeof value !== "function") throw new TypeError(`${label} must be a function`);
  return value;
}

/**
 * Dependency-free lifecycle manager for one native speech helper at a time.
 * Electron/Swift details are injected by `speech.mjs`; this module owns only
 * producer identity, exactly-once settlement and stop/replacement fencing.
 */
export function createSpeechSessionManager({
  platform = process.platform,
  ensureBuilt,
  spawnHelper,
  send,
}) {
  const build = asFunction(ensureBuilt, "ensureBuilt");
  const spawn = asFunction(spawnHelper, "spawnHelper");
  const emit = asFunction(send, "send");
  let activeSession = null;

  function emitEnd(target, info) {
    emit(target, "speech:end", info);
  }

  function stop() {
    const session = activeSession;
    if (!session) return { stopped: false };

    // Producer identity is invalidated before touching the child. Any data,
    // close or error already queued on the event loop now belongs to a stale
    // session and cannot affect the next composer/session.
    activeSession = null;
    session.suppressEnd = true;
    session.finished = true;
    session.cleanupOutput?.();
    try {
      session.proc.kill("SIGTERM");
    } catch {}
    return { stopped: true };
  }

  function start(target) {
    stop();
    if (platform !== "darwin") {
      emitEnd(target, { code: 1, reason: "unsupported-platform" });
      return { started: false };
    }

    try {
      build();
    } catch {
      emitEnd(target, { code: 1, reason: "helper-unavailable" });
      return { started: false };
    }

    let proc;
    try {
      proc = spawn();
    } catch {
      emitEnd(target, { code: 1, reason: "helper-unavailable" });
      return { started: false };
    }
    if (!proc?.stdout || typeof proc.stdout.on !== "function" || typeof proc.once !== "function") {
      try {
        proc?.kill?.("SIGTERM");
      } catch {}
      emitEnd(target, { code: 1, reason: "helper-unavailable" });
      return { started: false };
    }

    const session = {
      proc,
      finished: false,
      suppressEnd: false,
      cleanupOutput: null,
    };
    activeSession = session;

    const finish = (info) => {
      if (session.finished) return false;
      session.finished = true;
      session.cleanupOutput?.();
      if (activeSession === session) activeSession = null;
      if (!session.suppressEnd) emitEnd(target, info);
      return true;
    };

    const isCurrent = () => (
      activeSession === session
      && !session.finished
      && !session.suppressEnd
    );
    const onStdout = createSpeechOutputHandler({
      isCurrent,
      onTranscript: (value) => emit(target, "speech:transcript", value),
      onFailure: (reason) => {
        if (!finish({ code: 1, reason })) return;
        try {
          proc.kill("SIGTERM");
        } catch {}
      },
    });
    proc.stdout.on("data", onStdout);
    session.cleanupOutput = () => proc.stdout.removeListener?.("data", onStdout);

    proc.once("close", (code) => {
      finish({ code, reason: speechExitReason(code) });
    });
    proc.once("error", () => {
      finish({ code: 1, reason: "helper-unavailable" });
    });
    return { started: true };
  }

  return Object.freeze({ start, stop });
}
