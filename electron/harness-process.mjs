export const HARNESS_READY_KIND = "cumea:harness-ready";
export const HARNESS_READY_VERSION = 1;
const DEFAULT_TIMEOUT_MS = 30_000;

export function parseHarnessReadyMessage(message, expectedPid) {
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  if (message.kind !== HARNESS_READY_KIND || message.version !== HARNESS_READY_VERSION) return null;
  if (!Number.isInteger(expectedPid) || expectedPid <= 0) {
    throw new Error("expected harness PID is invalid");
  }
  if (message.pid !== expectedPid) throw new Error("harness readiness PID does not match child process");
  if (!Number.isInteger(message.port) || message.port < 1 || message.port > 65_535) {
    throw new Error("harness readiness port is invalid");
  }
  return Object.freeze({
    kind: HARNESS_READY_KIND,
    version: HARNESS_READY_VERSION,
    pid: message.pid,
    port: message.port,
  });
}

export function waitForHarnessReady(processHandle, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const pid = processHandle?.pid;
  if (!Number.isInteger(pid) || pid <= 0) {
    return Promise.reject(new Error("harness process did not expose a valid PID"));
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
    return Promise.reject(new Error("harness readiness timeout is invalid"));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      processHandle.off?.("message", onMessage);
      processHandle.off?.("exit", onExit);
      callback();
    };
    const onMessage = (message) => {
      let parsed;
      try {
        parsed = parseHarnessReadyMessage(message, pid);
      } catch (error) {
        finish(() => reject(error));
        return;
      }
      if (!parsed) return;
      finish(() => resolve(parsed));
    };
    const onExit = (code) => {
      finish(() =>
        reject(
          new Error(
            `agent host exited before readiness${code == null ? "" : ` (code ${code})`}`,
          ),
        ),
      );
    };
    const timer = setTimeout(() => {
      finish(() => reject(new Error(`agent host did not become ready within ${timeoutMs} ms`)));
    }, timeoutMs);
    timer.unref?.();
    processHandle.on("message", onMessage);
    processHandle.once("exit", onExit);
  });
}
