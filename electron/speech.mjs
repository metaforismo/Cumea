// Speech helper lifecycle, main-process side. The Swift helper is spawned
// from HERE (never the harness server) so the Microphone + Speech
// Recognition permission prompts attribute to the app. Compiled lazily on
// first use; each recording session is one helper process.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import { createSpeechOutputHandler, speechExitReason } from "./speech-contract.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, "resources", "speech-helper.swift");
// packaged: the helper ships pre-built + signed in Resources (a signed app
// bundle must never be written into — lazy compile would break the seal)
const BIN = app.isPackaged
  ? path.join(process.resourcesPath, "speech-helper")
  : path.join(__dirname, "resources", "speech-helper");

let activeSession = null;

function send(win, channel, value) {
  if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
    win.webContents.send(channel, value);
  }
}

function ensureBuilt() {
  if (app.isPackaged) return; // pre-built at package time
  const stale = !existsSync(BIN) || statSync(BIN).mtimeMs < statSync(SRC).mtimeMs;
  if (!stale) return;
  // Xcode CLT required; ~2s once, then cached until the source changes
  execFileSync("swiftc", ["-O", SRC, "-o", BIN], { stdio: "pipe", timeout: 120_000 });
}

export function startSpeech(win) {
  stopSpeech();
  if (process.platform !== "darwin") {
    send(win, "speech:end", { code: 1, reason: "unsupported-platform" });
    return { started: false };
  }
  try {
    ensureBuilt();
  } catch {
    send(win, "speech:end", { code: 1, reason: "helper-unavailable" });
    return { started: false };
  }

  let proc;
  try {
    proc = spawn(BIN, [], { stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    send(win, "speech:end", { code: 1, reason: "helper-unavailable" });
    return { started: false };
  }
  const session = {
    proc,
    win,
    failureReason: null,
    finished: false,
    suppressEnd: false,
    cleanupOutput: null,
  };
  activeSession = session;

  const finish = (info) => {
    if (session.finished) return;
    session.finished = true;
    session.cleanupOutput?.();
    if (activeSession === session) activeSession = null;
    if (!session.suppressEnd) send(win, "speech:end", info);
  };

  const isCurrent = () => (
    activeSession === session
    && !session.finished
    && !session.suppressEnd
  );
  const onStdout = createSpeechOutputHandler({
    isCurrent,
    onTranscript: (value) => send(win, "speech:transcript", value),
    onFailure: (reason) => {
      session.failureReason = reason;
    },
  });
  proc.stdout.on("data", onStdout);
  session.cleanupOutput = () => proc.stdout.removeListener("data", onStdout);
  proc.on("close", (code) => {
    finish({ code, reason: speechExitReason(code, session.failureReason) });
  });
  proc.on("error", () => {
    finish({ code: 1, reason: "helper-unavailable" });
  });
  return { started: true };
}

export function stopSpeech() {
  const session = activeSession;
  if (!session) return;
  activeSession = null;
  session.suppressEnd = true;
  session.finished = true;
  session.cleanupOutput?.();
  try {
    session.proc.kill("SIGTERM");
  } catch {}
}
