/** Application credentials must only reach the adapter that owns them. */
const MANAGED_CREDENTIALS = new Set([
    "BOX_TOKEN",
    "COMPOSIO_KEY",
    "COMPOSIO_API_KEY",
    "COMPOSIO_CONNECT_API_KEY",
    "EXPO_ACCESS_TOKEN",
    "XAI_API_KEY",
]);
const MINIMAL_HOST_KEYS = new Set([
    "APPDATA",
    "COLORTERM",
    "COMMONPROGRAMFILES",
    "COMMONPROGRAMFILES(X86)",
    "COMSPEC",
    "CURL_CA_BUNDLE",
    "FORCE_COLOR",
    "HOME",
    "HOMEDRIVE",
    "HOMEPATH",
    "LANG",
    "LANGUAGE",
    "LOCALAPPDATA",
    "LOGNAME",
    "NODE_EXTRA_CA_CERTS",
    "NO_COLOR",
    "OS",
    "PATH",
    "PATHEXT",
    "PROGRAMDATA",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "REQUESTS_CA_BUNDLE",
    "SHELL",
    "SSL_CERT_DIR",
    "SSL_CERT_FILE",
    "SYSTEMROOT",
    "TEMP",
    "TEMPDIR",
    "TERM",
    "TMP",
    "TMPDIR",
    "USER",
    "USERNAME",
    "USERPROFILE",
    "WINDIR",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_STATE_HOME",
]);
function normalizedKey(key) {
    return key.toUpperCase();
}
function isManagedCredential(key) {
    return MANAGED_CREDENTIALS.has(key) ||
        (/^CUMEA_/.test(key) && /(?:^|_)(?:BROKER|CAPABILITY|COMMS|SECRET|TOKEN)(?:$|_)/.test(key));
}
/** Remove Cumea-managed credentials unless this exact adapter owns them. */
export function stripManagedCredentials(environment, allowed = []) {
    const allow = new Set(allowed.map(normalizedKey));
    for (const key of Object.keys(environment)) {
        const normalized = normalizedKey(key);
        if (isManagedCredential(normalized) && !allow.has(normalized))
            delete environment[key];
    }
}
/**
 * Environment for user-configured subscription CLIs.
 *
 * Authentication files remain discoverable through HOME/XDG and platform
 * paths, while credentials, proxies, sockets and application capabilities are
 * absent by construction. Key matching is case-insensitive because Windows
 * environment names are case-insensitive even when represented as JS keys.
 */
export function minimalProviderEnvironment(source) {
    const output = {};
    for (const [key, value] of Object.entries(source)) {
        const normalized = normalizedKey(key);
        if (MINIMAL_HOST_KEYS.has(normalized) || normalized.startsWith("LC_"))
            output[normalized] = value;
    }
    return output;
}
