import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import { normalizeCuaPermissions, toPublicCuaStatus } from "./cua-contract.mjs";
import { CUA_DRIVER_RELEASE } from "../scripts/cua-driver-release.mjs";

describe("CUA renderer contract", () => {
  it("starts in a fail-closed checking state", () => {
    assert.deepEqual(toPublicCuaStatus(null), {
      state: "checking",
      mode: null,
      permissions: null,
      reason: null,
      driverVersion: null,
    });
  });

  it("does not expose socket or MCP launch details", () => {
    assert.deepEqual(
      toPublicCuaStatus({
        state: "ready",
        mode: "embedded",
        socketPath: "/private/tmp/secret.sock",
        mcpCommand: "/Applications/Cumea.app/cua-driver",
        mcpArgs: ["mcp"],
        mcpEnv: { TOKEN: "secret" },
        permissions: { accessibility: true, screenRecording: true },
        driverVersion: "0.19.3",
      }),
      {
        state: "ready",
        mode: "embedded",
        permissions: { accessibility: true, screenRecording: true },
        reason: null,
        driverVersion: "0.19.3",
      },
    );
  });

  it("treats absent or non-boolean permission values as denied", () => {
    assert.deepEqual(normalizeCuaPermissions({ accessibility: 1, screenRecording: null }), {
      accessibility: false,
      screenRecording: false,
    });
  });

  it("keeps the SDK and verified executable on the same exact version", async () => {
    const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    assert.equal(manifest.dependencies["@trycua/cua-driver"], CUA_DRIVER_RELEASE.version);
    assert.equal(CUA_DRIVER_RELEASE.sha256, "4f147affe7015dffdb0faeecb784a72d4ff9808b571a2d888231ae11e7966034");
    assert.match(CUA_DRIVER_RELEASE.url, new RegExp(`/${CUA_DRIVER_RELEASE.tag}/${CUA_DRIVER_RELEASE.asset}$`));
  });
});
