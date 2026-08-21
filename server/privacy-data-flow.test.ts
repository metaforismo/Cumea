import { describe, expect, it } from "vitest";

import { buildPrivacyInventory, PRIVACY_FLOW_IDS } from "./privacy-data-flow.ts";

function input(patch: Record<string, unknown> = {}) {
  return {
    providerConfigs: {
      "private-provider-id": { driver: "claudeAgent", enabled: true, displayName: "Private provider label", config: { executable: "/Users/private/provider" } },
      "private-box-id": { driver: "boxAgent", enabled: true },
      "unknown-private-id": { driver: "futureSecretAdapter", enabled: true },
    },
    providerSnapshots: [
      { instanceId: "private-provider-id", driverKind: "claudeAgent", snapshot: { state: "available" as const } },
      { instanceId: "private-box-id", driverKind: "boxAgent", snapshot: { state: "available" as const } },
      { instanceId: "unknown-private-id", driverKind: "futureSecretAdapter", snapshot: { state: "unavailable" as const } },
    ],
    boxConfigured: true,
    composioConfigured: false,
    expoPushEnabled: false,
    pairedMobileEnabled: false,
    pairedMobileAvailable: true,
    remoteScreenPreviewEnabled: false,
    localMcpAvailable: false,
    localMcpEnabled: false,
    localVmAvailable: false,
    localVmEnabled: false,
    ...patch,
  };
}

describe("privacy data-flow inventory", () => {
  it("returns the complete stable allowlist with exact public keys", () => {
    const inventory = buildPrivacyInventory(input());
    expect(inventory.version).toBe(1);
    expect(inventory.rows.map((row) => row.id)).toEqual(PRIVACY_FLOW_IDS);
    for (const row of inventory.rows) {
      expect(Object.keys(row).sort()).toEqual([
        "available", "caveat", "consent", "dataCategories", "destinationCategory",
        "destinationName", "enabled", "id", "storageBoundary", "trigger",
      ]);
    }
  });

  it("derives enabled and available state without reflecting private configuration", () => {
    const inventory = buildPrivacyInventory(input({ composioConfigured: true, localMcpAvailable: true, localMcpEnabled: true }));
    expect(inventory.rows.find((row) => row.id === "provider.cli.claude")).toMatchObject({ enabled: true, available: true });
    expect(inventory.rows.find((row) => row.id === "provider.cli.claude")?.dataCategories).toContain("screenshots");
    expect(inventory.rows.find((row) => row.id === "provider.cli.codex")).toMatchObject({ enabled: false, available: false });
    expect(inventory.rows.find((row) => row.id === "service.box")).toMatchObject({ enabled: true, available: true });
    expect(inventory.rows.find((row) => row.id === "service.composio")).toMatchObject({ enabled: true, available: true });
    expect(inventory.rows.find((row) => row.id === "process.local-mcp")).toMatchObject({ enabled: true, available: true });
    expect(inventory.rows.find((row) => row.id === "provider.config.unknown")).toMatchObject({ enabled: true, available: false });

    const serialized = JSON.stringify(inventory);
    for (const privateValue of ["private-provider-id", "Private provider label", "/Users/private/provider", "unknown-private-id", "futureSecretAdapter"]) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it("does not claim the local MCP boundary is available without a configured server", () => {
    const missing = buildPrivacyInventory(input()).rows.find((row) => row.id === "process.local-mcp")!;
    const disabled = buildPrivacyInventory(input({ localMcpAvailable: true })).rows.find((row) => row.id === "process.local-mcp")!;
    expect(missing).toMatchObject({ enabled: false, available: false });
    expect(disabled).toMatchObject({ enabled: false, available: true });
  });

  it("requires an active paired device before claiming Expo push is available", () => {
    const listenerOnly = buildPrivacyInventory(input()).rows.find((row) => row.id === "service.expo-push")!;
    const paired = buildPrivacyInventory(input({ pairedMobileEnabled: true })).rows.find((row) => row.id === "service.expo-push")!;
    expect(listenerOnly).toMatchObject({ enabled: false, available: false });
    expect(paired).toMatchObject({ enabled: false, available: true });
  });

  it("adds screenshots to the paired-device boundary only when remote preview is enabled", () => {
    const off = buildPrivacyInventory(input()).rows.find((row) => row.id === "device.paired-mobile")!;
    const on = buildPrivacyInventory(input({ remoteScreenPreviewEnabled: true })).rows.find((row) => row.id === "device.paired-mobile")!;
    expect(off.dataCategories).not.toContain("screenshots");
    expect(off.caveat).toContain("remain excluded");
    expect(on.dataCategories).toContain("screenshots");
    expect(on.caveat).toContain("enabled");
  });
});
