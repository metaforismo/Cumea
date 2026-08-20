// Electron/Swift adapter for native macOS dictation. The lifecycle itself is
// dependency-free in speech-session.mjs so replacement/stop/error semantics
// are exercised on every CI OS.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import { createSpeechSessionManager } from "./speech-session.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, "resources", "speech-helper.swift");
// Packaged: the helper ships pre-built + signed in Resources (a signed app
// bundle must never be written into — lazy compile would break the seal).
const BIN = app.isPackaged
  ? path.join(process.resourcesPath, "speech-helper")
  : path.join(__dirname, "resources", "speech-helper");

function send(win, channel, value) {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
  win.webContents.send(channel, value);
}

function ensureBuilt() {
  if (app.isPackaged) return;
  const stale = !existsSync(BIN) || statSync(BIN).mtimeMs < statSync(SRC).mtimeMs;
  if (!stale) return;
  execFileSync("swiftc", ["-O", SRC, "-o", BIN], { stdio: "pipe", timeout: 120_000 });
}

function spawnHelper() {
  // Helper stderr is intentionally ignored. Native/compiler details never
  // cross into renderer state, and ignoring it avoids a backpressure pipe.
  return spawn(BIN, [], { stdio: ["ignore", "pipe", "ignore"] });
}

const sessions = createSpeechSessionManager({
  platform: process.platform,
  ensureBuilt,
  spawnHelper,
  send,
});

export function startSpeech(win) {
  return sessions.start(win);
}

export function stopSpeech() {
  return sessions.stop();
}
