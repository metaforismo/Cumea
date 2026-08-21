import type { ProviderAdapter } from "./contracts.ts";

export type ComputerDestination = "cloud" | "vm" | "local" | "off";

export interface ComputerProviderDescriptor {
  id: Exclude<ComputerDestination, "off">;
  label: string;
  requiredCapability: "cloudComputerMcp" | "localComputerMcp";
  /** A shared graphical surface must not accept concurrent drivers. */
  exclusive: boolean;
}

export const COMPUTER_PROVIDERS: readonly ComputerProviderDescriptor[] = [
  { id: "cloud", label: "Cloud box", requiredCapability: "cloudComputerMcp", exclusive: false },
  { id: "vm", label: "Local VM", requiredCapability: "localComputerMcp", exclusive: true },
  { id: "local", label: "This computer", requiredCapability: "localComputerMcp", exclusive: true },
] as const;

export function computerProvider(id: Exclude<ComputerDestination, "off">): ComputerProviderDescriptor {
  return COMPUTER_PROVIDERS.find((provider) => provider.id === id)!;
}

export function computerProviderSupported(
  id: Exclude<ComputerDestination, "off">,
  capabilities: ProviderAdapter["capabilities"],
): boolean {
  return capabilities[computerProvider(id).requiredCapability] === true;
}

/**
 * Generation-free lease for shared visible desktops. The owning turn must
 * release with its own thread id, so stale completions cannot unlock a newer
 * owner's surface.
 */
export class ComputerProviderLeases {
  private owners = new Map<string, string>();

  acquire(providerId: string, threadId: string): boolean {
    const owner = this.owners.get(providerId);
    if (owner && owner !== threadId) return false;
    this.owners.set(providerId, threadId);
    return true;
  }

  release(providerId: string, threadId: string): void {
    if (this.owners.get(providerId) === threadId) this.owners.delete(providerId);
  }

  owner(providerId: string): string | null {
    return this.owners.get(providerId) ?? null;
  }
}
