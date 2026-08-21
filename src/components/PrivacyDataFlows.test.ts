import { describe, expect, it } from "vitest";

import { buildPrivacyInventory } from "../../server/privacy-data-flow";
import { decodePrivacyInventory, privacyFlowStatus } from "./PrivacyDataFlows";

function inventory() {
  return buildPrivacyInventory({
    providerConfigs: {}, providerSnapshots: [], boxConfigured: false, composioConfigured: false,
    expoPushEnabled: false, pairedMobileEnabled: false, pairedMobileAvailable: false,
    remoteScreenPreviewEnabled: false, localMcpAvailable: false, localMcpEnabled: false, localVmAvailable: false, localVmEnabled: false,
  });
}

describe("PrivacyDataFlows UI state", () => {
  it("accepts only the exact bounded server contract", () => {
    expect(decodePrivacyInventory(inventory()).rows).toHaveLength(13);
    const hostile = structuredClone(inventory()) as any;
    hostile.rows[0].endpoint = "https://secret.example/private";
    expect(() => decodePrivacyInventory(hostile)).toThrow("Privacy inventory is unavailable");
  });

  it("distinguishes enabled, unavailable and off states honestly", () => {
    expect(privacyFlowStatus({ enabled: true, available: true }).label).toBe("Enabled");
    expect(privacyFlowStatus({ enabled: true, available: false }).label).toBe("Enabled · unavailable");
    expect(privacyFlowStatus({ enabled: false, available: true }).label).toBe("Available · off");
    expect(privacyFlowStatus({ enabled: false, available: false }).label).toBe("Not available");
  });
});
