// Config + data dirs. One file, ~/.cumea/config.json, env fallbacks:
//   { "xai": {"key":"xai-…"}, "composio": {"key":"ck_…"}, "box": {"token":"…"},
//     "instances": { "<instanceId>": {"driver":"grok", …} } }
import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import type { InstanceConfigMap } from "./contracts.ts";
import { stripManagedCredentials } from "./provider-environment.ts";
import { writeFileAtomic } from "./atomic.ts";
import { assertPersistenceWritable, loadPersistentJson } from "./persistence-health.ts";

export interface AppConfig {
  xai?: { key?: string; url?: string };
  /** key = ck_… Connect consumer key (connections + agent tools);
   * apiKey = ak_… project API key — optional, unlocks the full toolkit
   * catalog with official logos in the plugins marketplace. */
  composio?: { key?: string; apiKey?: string; url?: string };
  box?: {
    token?: string;
    /** Host-only billing guard. `false` disables it; absent defaults to ten
     * minutes. Kept out of mobile projections. */
    autoSleepMinutes?: number | false;
  };
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

function validateConfigDocument(value: unknown): AppConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid config schema");
  const config = value as AppConfig;
  for (const key of ["xai", "composio", "box", "profile"] as const) {
    if (config[key] !== undefined && (!config[key] || typeof config[key] !== "object" || Array.isArray(config[key]))) throw new Error(`invalid config schema for ${key}`);
  }
  if (config.box?.autoSleepMinutes !== undefined && config.box.autoSleepMinutes !== false && (
    !Number.isInteger(config.box.autoSleepMinutes) || config.box.autoSleepMinutes < 1 || config.box.autoSleepMinutes > 1_440
  )) throw new Error("invalid Box auto-sleep interval");
  if (config.instances !== undefined) {
    if (!config.instances || typeof config.instances !== "object" || Array.isArray(config.instances) || Object.keys(config.instances).length > 1_000) throw new Error("invalid provider config schema");
    for (const [id, entry] of Object.entries(config.instances)) {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || !entry || typeof entry !== "object" || Array.isArray(entry) || typeof entry.driver !== "string") throw new Error("invalid provider config schema");
    }
  }
  return config;
}

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
  const path = join(DATA_DIR, "config.json");
  const cfg = loadPersistentJson<AppConfig>(path, {
    label: "Application and provider configuration",
    missing: () => ({}),
    resetValue: {},
    maxBytes: 1024 * 1024,
    validate: validateConfigDocument,
  });
  cfg.xai = { key: process.env.XAI_API_KEY, ...cfg.xai };
  cfg.composio = { key: process.env.COMPOSIO_KEY, ...cfg.composio };
  cfg.box = { token: process.env.BOX_TOKEN, ...cfg.box };
  return cfg;
}

/** Merge a partial config into ~/.cumea/config.json (secrets never
 * echoed back — callers report configured-or-not booleans only). */
export function saveConfig(patch: Partial<AppConfig>): void {
  const p = join(DATA_DIR, "config.json");
  assertPersistenceWritable(p);
  const disk = loadPersistentJson<Record<string, unknown>>(p, {
    label: "Application and provider configuration", missing: () => ({}), resetValue: {}, maxBytes: 1024 * 1024,
    validate: (value) => validateConfigDocument(value) as Record<string, unknown>,
  });
  assertPersistenceWritable(p);
  for (const key of ["xai", "composio", "box", "profile"] as const) {
    if (patch[key] && typeof patch[key] === "object") {
      disk[key] = { ...(disk[key] as object), ...patch[key] };
    }
  }
  // Instance profiles are a replace-only map: merging makes deletion
  // impossible and risks retaining an executable the user removed.
  if (Object.prototype.hasOwnProperty.call(patch, "instances")) {
    disk.instances = structuredClone(patch.instances ?? {});
  }
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileAtomic(p, JSON.stringify(disk, null, 2), { mode: 0o600 });
}

// Default fleet: one instance per built-in driver (upstream
// defaultInstanceIdForDriver — instanceId defaults to the driver kind).
// Config-file credentials are injected only into the adapter that owns them;
// unrelated provider processes must never receive the app's integration keys.
export function persistedInstanceConfigs(cfg: AppConfig): InstanceConfigMap {
  // The default `grok` instance rides the `grokAgent` driver, not the API-key
  // one: like claude and codex it needs no credential from us, just the CLI
  // installed and logged in (it shows up unavailable otherwise). The API-key
  // `grok` driver stays registered but out of the default fleet so an API key
  // never silently changes billing behavior; an explicit `instances` entry
  // enables it.
  return structuredClone(
    cfg.instances && Object.keys(cfg.instances).length
      ? cfg.instances
      : {
          grok: { driver: "grokAgent" },
          gemini: { driver: "geminiAgent" },
          claude: { driver: "claudeAgent" },
          codex: { driver: "codex" },
          computer: { driver: "boxAgent" },
        },
  );
}

export function instanceConfigs(cfg: AppConfig): InstanceConfigMap {
  // Always decorate a clone. Injected credential environment belongs only to
  // the live registry and must never leak back into cfg.instances/config.json.
  const map = persistedInstanceConfigs(cfg);
  for (const entry of Object.values(map)) {
    const ownedCredential = entry.driver === "grok"
      ? "XAI_API_KEY"
      : entry.driver === "boxAgent"
        ? "BOX_TOKEN"
        : null;
    const configured = { ...(entry.environment ?? {}) };
    stripManagedCredentials(configured, ownedCredential ? [ownedCredential] : []);
    const environment = {
      ...(entry.driver === "grok" && cfg.xai?.key ? { XAI_API_KEY: cfg.xai.key } : {}),
      ...(entry.driver === "boxAgent" && cfg.box?.token ? { BOX_TOKEN: cfg.box.token } : {}),
      ...configured,
    };
    if (Object.keys(environment).length) entry.environment = environment;
    else delete entry.environment;
  }
  return map;
}
