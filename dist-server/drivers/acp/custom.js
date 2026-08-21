import { isAbsolute } from "node:path";
import { createAcpDriver } from "./core.js";
export const CUSTOM_ACP_DRIVER_KIND = "customAcp";
const MAX_ARGUMENTS = 64;
const MAX_MODELS = 64;
function httpError(status, message) {
    return Object.assign(new Error(message), { status });
}
function record(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw httpError(400, "profile must be an object");
    return value;
}
function boundedString(value, name, max = 512, allowEmpty = false) {
    if (typeof value !== "string")
        throw httpError(400, `${name} must be a string`);
    const normalized = value.trim();
    if ((!allowEmpty && !normalized) || normalized.length > max || /[\u0000-\u001f\u007f]/.test(normalized)) {
        throw httpError(400, `invalid ${name}`);
    }
    return normalized;
}
function boundedStringArray(value, name, maxItems, fallback = []) {
    if (value === undefined)
        return [...fallback];
    if (!Array.isArray(value) || value.length > maxItems)
        throw httpError(400, `invalid ${name}`);
    return value.map((item, index) => boundedString(item, `${name}[${index}]`, 1024, true));
}
function modelCatalog(value, defaultValue) {
    if (!Array.isArray(value) || value.length < 1 || value.length > MAX_MODELS) {
        throw httpError(400, "models must contain between 1 and 64 entries");
    }
    const options = value.map((item, index) => {
        const candidate = record(item);
        return {
            id: boundedString(candidate.id, `models[${index}].id`, 160),
            label: boundedString(candidate.label ?? candidate.id, `models[${index}].label`, 160),
        };
    });
    if (new Set(options.map((option) => option.id)).size !== options.length) {
        throw httpError(400, "model ids must be unique");
    }
    const defaultModel = boundedString(defaultValue ?? options[0].id, "defaultModel", 160);
    if (!options.some((option) => option.id === defaultModel)) {
        throw httpError(400, "defaultModel must match one configured model");
    }
    return { default: defaultModel, options };
}
function validateArguments(args) {
    for (const arg of args) {
        for (const placeholder of arg.matchAll(/\{([^{}]+)\}/g)) {
            if (placeholder[1] !== "model")
                throw httpError(400, `unsupported argument placeholder {${placeholder[1]}}`);
        }
    }
}
export function decodeCustomAcpProfileInput(raw) {
    const value = record(raw);
    for (const forbidden of ["environment", "env", "token", "apiKey", "secret"]) {
        if (Object.prototype.hasOwnProperty.call(value, forbidden)) {
            throw httpError(400, `${forbidden} is not accepted; authenticate with the CLI itself`);
        }
    }
    const executable = boundedString(value.executable ?? value.cli, "executable", 512);
    const args = boundedStringArray(value.arguments ?? value.args, "arguments", MAX_ARGUMENTS);
    const versionArgs = boundedStringArray(value.versionArguments ?? value.versionArgs, "versionArguments", 8, ["--version"]);
    validateArguments(args);
    const catalog = modelCatalog(value.models, value.defaultModel);
    const workspace = value.workspace === undefined || value.workspace === ""
        ? undefined
        : boundedString(value.workspace, "workspace", 2048);
    if (workspace && !isAbsolute(workspace))
        throw httpError(400, "workspace must be an absolute path");
    const authMethod = value.authMethod === undefined || value.authMethod === ""
        ? undefined
        : boundedString(value.authMethod, "authMethod", 128);
    return {
        label: boundedString(value.label, "label", 80),
        executable,
        arguments: args,
        versionArguments: versionArgs,
        models: catalog.options,
        defaultModel: catalog.default,
        authMethod,
        requireAuthentication: value.requireAuthentication === true,
        workspace,
        fullAuto: value.fullAuto === true,
        enabled: value.enabled !== false,
    };
}
export function customAcpInstance(profile) {
    return {
        driver: CUSTOM_ACP_DRIVER_KIND,
        displayName: profile.label,
        enabled: profile.enabled,
        config: {
            cli: profile.executable,
            args: profile.arguments,
            versionArgs: profile.versionArguments,
            models: { default: profile.defaultModel, options: profile.models },
            authMethod: profile.authMethod,
            authFailure: profile.requireAuthentication ? "fail" : "continue",
            workspace: profile.workspace,
            fullAuto: profile.fullAuto,
        },
    };
}
export function publicCustomAcpProfile(id, instance) {
    if (instance.driver !== CUSTOM_ACP_DRIVER_KIND)
        return null;
    const config = decodeCustomAcpConfig(instance.config);
    return {
        id,
        label: boundedString(instance.displayName ?? id, "label", 80),
        executable: config.cli,
        arguments: [...config.args],
        versionArguments: [...config.versionArgs],
        models: config.models.options.map((option) => ({ ...option })),
        defaultModel: config.models.default,
        authMethod: config.authMethod,
        requireAuthentication: config.authFailure === "fail",
        workspace: config.workspace,
        fullAuto: config.fullAuto,
        enabled: instance.enabled !== false,
    };
}
export function decodeCustomAcpConfig(raw) {
    const value = record(raw);
    const profile = decodeCustomAcpProfileInput({
        label: "Custom ACP",
        executable: value.cli,
        arguments: value.args,
        versionArguments: value.versionArgs,
        models: record(value.models).options,
        defaultModel: record(value.models).default,
        authMethod: value.authMethod,
        requireAuthentication: value.authFailure === "fail",
        workspace: value.workspace,
        fullAuto: value.fullAuto,
        enabled: true,
    });
    return {
        cli: profile.executable,
        fullAuto: profile.fullAuto,
        workspace: profile.workspace,
        args: profile.arguments,
        versionArgs: profile.versionArguments,
        models: { default: profile.defaultModel, options: profile.models },
        authMethod: profile.authMethod,
        authFailure: profile.requireAuthentication ? "fail" : "continue",
    };
}
function expandArguments(config, turn) {
    const model = turn.model || config.models.default;
    return config.args.map((arg) => arg.replaceAll("{model}", model));
}
const support = {
    driverKind: CUSTOM_ACP_DRIVER_KIND,
    displayName: "Custom ACP",
    models: (config) => config.models,
    fallbackModels: { default: "default", options: [{ id: "default", label: "Default" }] },
    defaultCli: "acp-agent",
    nativeSource: "custom.acp",
    loginNote: "The ACP CLI could not authenticate. Sign in with that CLI, then try again.",
    decodeConfig: decodeCustomAcpConfig,
    defaultConfig: () => decodeCustomAcpConfig({
        cli: "acp-agent",
        args: [],
        versionArgs: ["--version"],
        models: { default: "default", options: [{ id: "default", label: "Default" }] },
    }),
    versionArgs: (config) => config.versionArgs,
    environmentPolicy: "minimal",
    spawnArgs: expandArguments,
    pickAuthMethod: (methods, config) => {
        const ids = methods.map((method) => method.id).filter((id) => typeof id === "string");
        if (config.authMethod)
            return ids.includes(config.authMethod) ? config.authMethod : null;
        return ids[0] ?? null;
    },
    authFailure: (config) => config.authFailure,
    isAuthenticated: () => undefined,
    buildPromptText: (turn) => (turn.system ? `${turn.system}\n\n${turn.text}` : turn.text),
};
export const CustomAcpDriver = createAcpDriver(support);
