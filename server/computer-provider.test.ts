import { describe, expect, it } from "vitest";

import { ComputerProviderLeases, computerProviderSupported } from "./computer-provider.ts";

describe("computer provider SPI", () => {
  it("maps cloud and local surfaces to their explicit adapter capabilities", () => {
    const capabilities = { sessionModelSwitch: "unsupported" as const, localComputerMcp: true, cloudComputerMcp: false };
    expect(computerProviderSupported("local", capabilities)).toBe(true);
    expect(computerProviderSupported("vm", capabilities)).toBe(true);
    expect(computerProviderSupported("cloud", capabilities)).toBe(false);
  });

  it("keeps one owner per shared surface and ignores stale releases", () => {
    const leases = new ComputerProviderLeases();
    expect(leases.acquire("vm", "thread-a")).toBe(true);
    expect(leases.acquire("vm", "thread-b")).toBe(false);
    leases.release("vm", "thread-b");
    expect(leases.owner("vm")).toBe("thread-a");
    leases.release("vm", "thread-a");
    expect(leases.acquire("vm", "thread-b")).toBe(true);
  });
});
