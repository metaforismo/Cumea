// Config + data dirs. In source/browser mode optional credentials may still
// use ~/.cumea/config.json. A packaged Electron host instead injects an
// OS-backed credential bootstrap; this module consumes and deletes those env
// values before provider processes are loaded, then keeps only an immutable
// in-memory copy for the life of this harness process.
import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import type { InstanceConfigMap } from "./contracts.ts";
import {
  consumeDesktopCredentialEnvironment,
  hasCredentialFields,
  overlayDesktopCredentials,
  providerCredentialEnvironment,
  sanitizeManagedInstanceEnvironment,
  stripCredentialFields,
} from "./desktop-credentials.ts";
import { writeFileAtomic } from "./atomic.ts";

export interface AppConfig {
  xai?: { key?: string; url?: string };
  /** key = Connect consumer key (connections + agent tools);
   * apiKey = project API key — optional, unlocks the full toolkit catalog. */
  composio?: { key?: string; apiKey?: string; url?: string };
  box?: { token?: string };
  /** The person using the app (collected in onboarding, shown in the
   * sidebar). Not a secret — echoed back by GET /api/config. */
  profile?: { name?: string; email?: string };
  instances?: InstanceConfigMap;
}

export const DATA_DIR = process.env.CUMEA_DATA_DIR
  ? resolve(process.env.CUMEA_DATA_DIR)
  : join(homedir(), ".cumea");
export const EVENTS_DIR = join(DATA_DIR, "events");
export const NATIVE_DIR = join(DATA_DIR, "native");
export const ATTACHMENTS_DIR = join(DATA_DIR, "attachments");
/** Host-owned working directories for model-created user-facing files. */
export const BOT_WORKSPACES_DIR = join(DATA_DIR, "workspaces");

const desktopBootstrap = consumeDesktopCredentialEnvironment(process.env);
const desktopCredentials = Object.freeze({ ...desktopBootstrap.credentials });

export function desktopCredentialsManaged(): boolean {
  return desktopBootstrap.managed;
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

function diskConfig(): AppConfig {
  try {
    const value = JSON.parse(readFileSync(join(DATA_DIR, "config.json"), "utf8"));
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as AppConfig)
      : {};
  } catch {
    return {};
  }
}

export function loadConfig(): AppConfig {
  let cfg = diskConfig();
  if (desktopBootstrap.managed) {
    // Managed mode never trusts or reuses credential-shaped values from disk.
    cfg = overlayDesktopCredentials(stripCredentialFields(cfg), desktopCredentials);
  } else {
    cfg.xai = { key: process.env.XAI_API_KEY, ...cfg.xai };
    cfg.composio = { key: process.env.COMPOSIO_KEY, ...cfg.composio };
    cfg.box = { token: process.env.BOX_TOKEN, ...cfg.box };
  }
  return cfg;
}

/** Merge a partial config into ~/.cumea/config.json. The packaged managed
 * harness rejects credential-shaped API patches entirely: only Electron's
 * narrow OS-vault IPC is a valid credential transport. */
export function saveConfig(patch: Partial<AppConfig>): void {
  const target = join(DATA_DIR, "config.json");
  let disk: AppConfig = diskConfig();
  let incoming: Partial<AppConfig> = structuredClone(patch);
  if (desktopBootstrap.managed) {
    if (hasCredentialFields(incoming)) {
      throw Object.assign(
        new Error("packaged credentials must be changed through the desktop credential store"),
        { status: 409 },
      );
    }
    disk = stripCredentialFields(disk);
    incoming = stripCredentialFields(incoming);
  }
  const document = disk as Record<string, unknown>;
  for (const key of ["xai", "composio", "box", "profile"] as const) {
    const value = incoming[key];
    if (!value || typeof value !== "object") continue;
    const previous = document[key];
    document[key] = {
      ...(previous && typeof previous === "object" ? previous : {}),
      ...value,
    };
  }
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  writeFileAtomic(target, JSON.stringify(document, null, 2), { mode: 0o600 });
}

// Default fleet: one instance per built-in driver (upstream
// defaultInstanceIdForDriver — instanceId defaults to the driver kind).
// Credentials are mounted only into their owning provider driver. Composio
// values remain in the harness because connector calls are server-side.
export function instanceConfigs(cfg: AppConfig): InstanceConfigMap {
  // The deterministic performance fixture is allowed only when the Electron
  // process also has an explicit local report target. It keeps startup data
  // real (store, API, SSE, renderer) while avoiding CLI probes, accounts,
  // provider processes, and network-dependent model discovery.
  if (
    process.env.CUMEA_PERFORMANCE_MODE === "1" &&
    Boolean(process.env.CUMEA_PERFORMANCE_FILE?.trim())
  ) {
    return {};
  }

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
    const configuredEnvironment = desktopBootstrap.managed
      ? sanitizeManagedInstanceEnvironment(entry.environment)
      : { ...(entry.environment ?? {}) };
    const ownedCredential = providerCredentialEnvironment(entry.driver, {
      xai: cfg.xai?.key,
      box: cfg.box?.token,
    });
    entry.environment = desktopBootstrap.managed
      ? { ...configuredEnvironment, ...ownedCredential }
      : { ...ownedCredential, ...configuredEnvironment };
  }
  return map;
}
