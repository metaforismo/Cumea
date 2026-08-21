export const PRIVACY_INVENTORY_VERSION = 1;
export const PRIVACY_FLOW_IDS = [
    "provider.cli.claude",
    "provider.cli.codex",
    "provider.cli.gemini",
    "provider.cli.grok",
    "provider.cli.custom-acp",
    "provider.api.xai",
    "provider.config.unknown",
    "service.box",
    "service.composio",
    "service.expo-push",
    "device.paired-mobile",
    "process.local-mcp",
    "vm.local-cua",
];
const PROVIDERS = [
    { id: "provider.cli.claude", driverKind: "claudeAgent", destinationCategory: "local_process", destinationName: "Claude CLI", storageBoundary: "Cumea stores the local transcript; the CLI and any service it contacts use their own storage policy.", caveat: "Cumea cannot determine or enforce the downstream handling of a separately installed CLI." },
    { id: "provider.cli.codex", driverKind: "codex", destinationCategory: "local_process", destinationName: "Codex CLI", storageBoundary: "Cumea stores the local transcript; the CLI and any service it contacts use their own storage policy.", caveat: "Cumea cannot determine or enforce the downstream handling of a separately installed CLI." },
    { id: "provider.cli.gemini", driverKind: "geminiAgent", destinationCategory: "local_process", destinationName: "Gemini CLI", storageBoundary: "Cumea stores the local transcript; the CLI and any service it contacts use their own storage policy.", caveat: "Cumea cannot determine or enforce the downstream handling of a separately installed CLI." },
    { id: "provider.cli.grok", driverKind: "grokAgent", destinationCategory: "local_process", destinationName: "Grok CLI", storageBoundary: "Cumea stores the local transcript; the CLI and any service it contacts use their own storage policy.", caveat: "Cumea cannot determine or enforce the downstream handling of a separately installed CLI." },
    { id: "provider.cli.custom-acp", driverKind: "customAcp", destinationCategory: "local_process", destinationName: "Custom ACP CLI", storageBoundary: "Cumea stores the local transcript; the configured CLI controls any additional local or remote storage.", caveat: "A custom CLI is user-supplied. Cumea cannot know whether it forwards data or how a downstream service retains it." },
    { id: "provider.api.xai", driverKind: "grok", destinationCategory: "ai_provider", destinationName: "xAI API", storageBoundary: "Cumea stores the local transcript; xAI receives requests under the configured account and its own policy.", caveat: "Provider retention, training and account controls are governed by xAI, not Cumea." },
];
const providerData = ["prompts", "transcripts", "files", "screenshots", "tool_args"];
function providerState(input, driverKind) {
    const configured = Object.entries(input.providerConfigs).filter(([, config]) => config.driver === driverKind);
    const enabledIds = new Set(configured.filter(([, config]) => config.enabled !== false).map(([id]) => id));
    return {
        enabled: enabledIds.size > 0,
        available: input.providerSnapshots.some((snapshot) => enabledIds.has(snapshot.instanceId) && snapshot.driverKind === driverKind && snapshot.snapshot.state === "available"),
    };
}
function row(value) {
    return value;
}
export function buildPrivacyInventory(input) {
    const rows = PROVIDERS.map((provider) => {
        const status = providerState(input, provider.driverKind);
        return row({
            id: provider.id,
            ...status,
            destinationCategory: provider.destinationCategory,
            destinationName: provider.destinationName,
            dataCategories: [...providerData],
            trigger: "Used only when an agent selects this provider for a user- or routine-started turn.",
            consent: "Starting the turn sends context; tool actions follow the provider's configured consent mode.",
            storageBoundary: provider.storageBoundary,
            caveat: provider.caveat,
        });
    });
    const knownDrivers = new Set([...PROVIDERS.map((provider) => provider.driverKind), "boxAgent"]);
    const unknown = Object.entries(input.providerConfigs).filter(([, config]) => !knownDrivers.has(config.driver));
    const unknownEnabledIds = new Set(unknown.filter(([, config]) => config.enabled !== false).map(([id]) => id));
    rows.push(row({
        id: "provider.config.unknown",
        enabled: unknownEnabledIds.size > 0,
        available: input.providerSnapshots.some((snapshot) => unknownEnabledIds.has(snapshot.instanceId) && snapshot.snapshot.state === "available"),
        destinationCategory: "local_process",
        destinationName: "Unrecognized configured provider",
        dataCategories: [...providerData],
        trigger: "Used only if an agent is assigned to this preserved provider configuration.",
        consent: "Cumea fails unavailable when the adapter is unknown; its behavior cannot be inferred from stored configuration.",
        storageBoundary: "The configuration remains local until a compatible adapter is installed and selected.",
        caveat: "No provider name, executable, endpoint or configuration value is exposed in this inventory.",
    }));
    const boxProvider = providerState(input, "boxAgent");
    rows.push(row({
        id: "service.box",
        enabled: input.boxConfigured && boxProvider.enabled,
        available: input.boxConfigured && boxProvider.available,
        destinationCategory: "cloud_service",
        destinationName: "Box / ascii.dev",
        dataCategories: ["prompts", "transcripts", "files", "screenshots", "tool_args"],
        trigger: "Contacted when Box is selected as the agent provider or cloud computer.",
        consent: "Provisioning is explicit; turn and computer actions use the normal provider and tool-consent flow.",
        storageBoundary: "Prompts, desktop state and workspace files may be processed in the account's remote Box.",
        caveat: "ascii.dev controls remote retention and account handling; Cumea does not operate that service.",
    }), row({
        id: "service.composio",
        enabled: input.composioConfigured,
        available: input.composioConfigured,
        destinationCategory: "cloud_service",
        destinationName: "Composio and connected apps",
        dataCategories: ["tool_args", "files"],
        trigger: "Contacted when integrations are browsed, connected or an enabled app tool is used.",
        consent: "Account connection is explicit; each app action follows the agent's tool-consent flow.",
        storageBoundary: "Composio and the selected connected app process data under their own account policies.",
        caveat: "Cumea cannot describe every connected app's downstream retention from the local host.",
    }), row({
        id: "service.expo-push",
        enabled: input.expoPushEnabled,
        available: input.pairedMobileEnabled,
        destinationCategory: "cloud_service",
        destinationName: "Expo push service",
        dataCategories: ["notification_metadata"],
        trigger: "Contacted only after push is enabled for a paired device and work completes or needs attention.",
        consent: "Notification permission and push registration are explicit on the mobile device.",
        storageBoundary: "A bounded title, body and routing metadata pass through Expo and platform push services.",
        caveat: "Push delivery also follows Apple or Google platform handling outside Cumea.",
    }), row({
        id: "device.paired-mobile",
        enabled: input.pairedMobileEnabled,
        available: input.pairedMobileAvailable,
        destinationCategory: "paired_device",
        destinationName: "Authenticated paired mobile device",
        dataCategories: input.remoteScreenPreviewEnabled
            ? ["transcripts", "files", "screenshots", "notification_metadata"]
            : ["transcripts", "files", "notification_metadata"],
        trigger: "Data is projected when an authenticated paired device requests or streams an allowlisted mobile view.",
        consent: "Pairing is local and explicit; access can be revoked from the host.",
        storageBoundary: "The paired app keeps its enrollment credential in device secure storage and renders the host projection.",
        caveat: input.remoteScreenPreviewEnabled ? "Read-only computer preview is enabled for paired devices." : "Raw screen frames remain excluded while remote preview is off.",
    }), row({
        id: "process.local-mcp",
        enabled: input.localMcpEnabled,
        available: input.localMcpAvailable,
        destinationCategory: "local_process",
        destinationName: "Assigned local MCP processes",
        dataCategories: ["tool_args", "files"],
        trigger: "A configured local process starts only when assigned to an agent whose compatible provider turn uses it.",
        consent: "Assignment is desktop-local; individual actions use the provider's tool-consent flow.",
        storageBoundary: "Arguments and environment cross into a separately configured process on this host.",
        caveat: "Cumea cannot know whether a user-supplied MCP process stores or forwards what it receives.",
    }), row({
        id: "vm.local-cua",
        enabled: input.localVmEnabled,
        available: input.localVmAvailable,
        destinationCategory: "local_vm",
        destinationName: "Cua Local VM",
        dataCategories: ["files", "screenshots", "tool_args"],
        trigger: "Used only when Local VM is selected as an agent's computer and its container is running.",
        consent: "Setup and selection are explicit; computer actions use the normal tool-consent flow.",
        storageBoundary: "Desktop state stays on this host but crosses into the isolated local container and its managed workspace.",
        caveat: "Preparing the pinned image may contact the documented image and package registries.",
    }));
    return { version: PRIVACY_INVENTORY_VERSION, rows };
}
