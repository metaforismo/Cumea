import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { DATA_DIR, instanceConfigs, persistedInstanceConfigs, saveConfig, type AppConfig } from "./config.ts";

describe("instance configuration persistence", () => {
  afterEach(() => rmSync(join(DATA_DIR, "config.json"), { force: true }));
  it("injects each credential only into its owning driver without mutating persisted profiles", () => {
    const cfg: AppConfig = {
      xai: { key: "xai-live-only" },
      box: { token: "box-live-only" },
      instances: {
        "acp-test": {
          driver: "customAcp",
          environment: { BOX_TOKEN: "legacy-box", CUSTOM_SECRET: "legacy-custom" },
          config: { cli: "agent", args: [], models: { default: "m", options: [{ id: "m", label: "M" }] } },
        },
        gemini: { driver: "geminiAgent" },
        claude: { driver: "claudeAgent" },
        "grok-api": { driver: "grok" },
        computer: { driver: "boxAgent" },
      },
    };
    const live = instanceConfigs(cfg);
    expect(live["acp-test"].environment).toEqual({ CUSTOM_SECRET: "legacy-custom" });
    expect(live.gemini.environment).toBeUndefined();
    expect(live.claude.environment).toBeUndefined();
    expect(live["grok-api"].environment).toEqual({ XAI_API_KEY: "xai-live-only" });
    expect(live.computer.environment).toEqual({ BOX_TOKEN: "box-live-only" });
    expect(cfg.instances?.["acp-test"].environment).toEqual({ BOX_TOKEN: "legacy-box", CUSTOM_SECRET: "legacy-custom" });
    expect(persistedInstanceConfigs(cfg)["acp-test"]).not.toBe(live["acp-test"]);
  });

  it("lets an owning instance override only its own managed credential", () => {
    const live = instanceConfigs({
      xai: { key: "global-xai" },
      box: { token: "global-box" },
      instances: {
        api: { driver: "grok", environment: { XAI_API_KEY: "instance-xai", BOX_TOKEN: "wrong-box" } },
        box: { driver: "boxAgent", environment: { BOX_TOKEN: "instance-box", XAI_API_KEY: "wrong-xai" } },
      },
    });
    expect(live.api.environment).toEqual({ XAI_API_KEY: "instance-xai" });
    expect(live.box.environment).toEqual({ BOX_TOKEN: "instance-box" });
  });

  it("replaces the instance map so deleting a profile is durable", () => {
    saveConfig({
      instances: {
        first: { driver: "customAcp", config: { cli: "one" } },
        second: { driver: "customAcp", config: { cli: "two" } },
      },
    });
    saveConfig({ instances: { second: { driver: "customAcp", config: { cli: "two" } } } });
    const disk = JSON.parse(readFileSync(join(DATA_DIR, "config.json"), "utf8"));
    expect(Object.keys(disk.instances)).toEqual(["second"]);
  });

  it("persists the host-only Box auto-sleep policy without replacing its token", () => {
    saveConfig({ box: { token: "box-live" } });
    saveConfig({ box: { autoSleepMinutes: false } });
    expect(JSON.parse(readFileSync(join(DATA_DIR, "config.json"), "utf8")).box).toEqual({
      token: "box-live",
      autoSleepMinutes: false,
    });
    saveConfig({ box: { autoSleepMinutes: 30 } });
    expect(JSON.parse(readFileSync(join(DATA_DIR, "config.json"), "utf8")).box.autoSleepMinutes).toBe(30);
  });
});
