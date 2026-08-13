// Config + data dirs. One file, ~/.cumea/config.json, env fallbacks:
//   { "xai": {"key":"xai-…"}, "composio": {"key":"ck_…"}, "box": {"token":"…"},
//     "instances": { "<instanceId>": {"driver":"grok", …} } }
import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import type { InstanceConfigMap } from "./contracts.ts";
import { writeFileAtomic } from "./atomic.ts";

export interface AppConfig {
  xai?: { key?: string; url?: string };
  /** key = ck_… Connect consumer key (connections + agent tools);
   * apiKey = ak_… project API key — optional, unlocks the full toolkit
   * catalog with official logos in the plugins marketplace. */
  composio?: { key?: string; apiKey?: string; url?: string };
  box?: { token?: string };
  /** The person using the app (collected in onboarding, shown in the
   * sidebar). Not a secret — echoed back by GET /api/config. */
  profile?: { name?: string; email?: string };
  instances?: InstanceConfigMap;
}

export const DATA_DIR = process.env.CUMEA_DATA_DIR ? resolve(process.env.CUMEA_DATA_DIR) : join(homedir(), ".cumea");
export const EVENTS_DIR = join(DATA_DIR, "events");
export const NATIVE_DIR = join(DATA_DIR, "native");
export const ATTACHMENTS_DIR = join(DATA_DIR, "attachments");
/**
 * Deliberately narrow filesystem boundary for files created by local agents.
 * Providers are pointed at one child directory per bot; chat file links never
 * resolve outside that child, even when model output contains an absolute path.
 */
export const BOT_WORKSPACES_DIR = join(DATA_DIR, "bot-workspaces");

export function ensureDirs() {
  for (const dir of [DATA_DIR, EVENTS_DIR, NATIVE_DIR, ATTACHMENTS_DIR, BOT_WORKSPACES_DIR]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      chmodSync(dir, 0o700);
    } catch {}
  }
  try {
    chmodSync(join(DATA_DIR, "config.json"), 0o600);
  } catch {}
}

export function loadConfig(): AppConfig {
  let cfg: AppConfig = {};
  try {
    cfg = JSON.parse(readFileSync(join(DATA_DIR, "config.json"), "utf8"));
  } catch {
    /* first run — env fallbacks below */
  }
  cfg.xai = { key: process.env.XAI_API_KEY, ...cfg.xai };
  cfg.composio = { key: process.env.COMPOSIO_KEY, ...cfg.composio };
  cfg.box = { token: process.env.BOX_TOKEN, ...cfg.box };
  return cfg;
}

/** Merge a partial config into ~/.cumea/config.json (secrets never
 * echoed back — callers report configured-or-not booleans only). */
export function saveConfig(patch: Partial<AppConfig>): void {
  const p = join(DATA_DIR, "config.json");
  let disk: Record<string, unknown> = {};
  try {
    disk = JSON.parse(readFileSync(p, "utf8"));
  } catch {
    /* first write */
  }
  for (const key of ["xai", "composio", "box", "profile"] as const) {
    if (patch[key] && typeof patch[key] === "object") {
      disk[key] = { ...(disk[key] as object), ...patch[key] };
    }
  }
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileAtomic(p, JSON.stringify(disk, null, 2), { mode: 0o600 });
}

// Default fleet: one instance per built-in driver (upstream
// defaultInstanceIdForDriver — instanceId defaults to the driver kind).
// Config-file keys are injected as per-instance environment so drivers
// see them without needing real process env vars.
export function instanceConfigs(cfg: AppConfig): InstanceConfigMap {
  // The default `grok` instance rides the `grokAgent` driver, not the API-key
  // one: like claude and codex it needs no credential from us, just the CLI
  // installed and logged in (it shows up unavailable otherwise). The API-key
  // `grok` driver stays registered but out of the default fleet so an API key
  // never silently changes billing behavior; an explicit `instances` entry
  // enables it.
  const map: InstanceConfigMap =
    cfg.instances && Object.keys(cfg.instances).length
      ? cfg.instances
      : {
          grok: { driver: "grokAgent" },
          gemini: { driver: "geminiAgent" },
          claude: { driver: "claudeAgent" },
          codex: { driver: "codex" },
          computer: { driver: "boxAgent" },
        };
  for (const entry of Object.values(map)) {
    entry.environment = {
      ...(cfg.xai?.key ? { XAI_API_KEY: cfg.xai.key } : {}),
      ...(cfg.box?.token ? { BOX_TOKEN: cfg.box.token } : {}),
      ...entry.environment,
    };
  }
  return map;
}
