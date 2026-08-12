// Config + data dirs. One file, ~/.cumea/config.json, env fallbacks:
//   { "xai": {"key":"xai-…"}, "composio": {"key":"ck_…"}, "box": {"token":"…"},
//     "instances": { "<instanceId>": {"driver":"grok", …} } }
import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic.js";
export const DATA_DIR = join(homedir(), ".cumea");
export const EVENTS_DIR = join(DATA_DIR, "events");
export const NATIVE_DIR = join(DATA_DIR, "native");
export function ensureDirs() {
    for (const dir of [DATA_DIR, EVENTS_DIR, NATIVE_DIR]) {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        try {
            chmodSync(dir, 0o700);
        }
        catch { }
    }
    try {
        chmodSync(join(DATA_DIR, "config.json"), 0o600);
    }
    catch { }
}
export function loadConfig() {
    let cfg = {};
    try {
        cfg = JSON.parse(readFileSync(join(DATA_DIR, "config.json"), "utf8"));
    }
    catch {
        /* first run — env fallbacks below */
    }
    cfg.xai = { key: process.env.XAI_API_KEY, ...cfg.xai };
    cfg.composio = { key: process.env.COMPOSIO_KEY, ...cfg.composio };
    cfg.box = { token: process.env.BOX_TOKEN, ...cfg.box };
    return cfg;
}
/** Merge a partial config into ~/.cumea/config.json (secrets never
 * echoed back — callers report configured-or-not booleans only). */
export function saveConfig(patch) {
    const p = join(DATA_DIR, "config.json");
    let disk = {};
    try {
        disk = JSON.parse(readFileSync(p, "utf8"));
    }
    catch {
        /* first write */
    }
    for (const key of ["xai", "composio", "box", "profile"]) {
        if (patch[key] && typeof patch[key] === "object") {
            disk[key] = { ...disk[key], ...patch[key] };
        }
    }
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileAtomic(p, JSON.stringify(disk, null, 2), { mode: 0o600 });
}
// Default fleet: one instance per built-in driver (upstream
// defaultInstanceIdForDriver — instanceId defaults to the driver kind).
// Config-file keys are injected as per-instance environment so drivers
// see them without needing real process env vars.
export function instanceConfigs(cfg) {
    // The default `grok` instance rides the `grokAgent` driver, not the API-key
    // one: like claude and codex it needs no credential from us, just the CLI
    // installed and logged in (it shows up unavailable otherwise). The API-key
    // `grok` driver stays registered but out of the default fleet so an API key
    // never silently changes billing behavior; an explicit `instances` entry
    // enables it.
    const map = cfg.instances && Object.keys(cfg.instances).length
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
