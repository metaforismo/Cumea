export const COMPUTER_PROVIDERS = [
    { id: "cloud", label: "Cloud box", requiredCapability: "cloudComputerMcp", exclusive: false },
    { id: "vm", label: "Local VM", requiredCapability: "localComputerMcp", exclusive: true },
    { id: "local", label: "This computer", requiredCapability: "localComputerMcp", exclusive: true },
];
export function computerProvider(id) {
    return COMPUTER_PROVIDERS.find((provider) => provider.id === id);
}
export function computerProviderSupported(id, capabilities) {
    return capabilities[computerProvider(id).requiredCapability] === true;
}
/**
 * Generation-free lease for shared visible desktops. The owning turn must
 * release with its own thread id, so stale completions cannot unlock a newer
 * owner's surface.
 */
export class ComputerProviderLeases {
    owners = new Map();
    acquire(providerId, threadId) {
        const owner = this.owners.get(providerId);
        if (owner && owner !== threadId)
            return false;
        this.owners.set(providerId, threadId);
        return true;
    }
    release(providerId, threadId) {
        if (this.owners.get(providerId) === threadId)
            this.owners.delete(providerId);
    }
    owner(providerId) {
        return this.owners.get(providerId) ?? null;
    }
}
