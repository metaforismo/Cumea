import { randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export const CREDENTIAL_VAULT_SCHEMA = "cumea.desktop-credentials";
export const CREDENTIAL_VAULT_VERSION = 1;
export const DESKTOP_CREDENTIAL_SECTIONS = [
  "xai",
  "composio",
  "composioApi",
  "box",
];

const MAX_CREDENTIAL_LENGTH = 8_192;
const SERVER_ENV_FIELDS = {
  xai: "CUMEA_DESKTOP_XAI_KEY",
  composio: "CUMEA_DESKTOP_COMPOSIO_KEY",
  composioApi: "CUMEA_DESKTOP_COMPOSIO_API_KEY",
  box: "CUMEA_DESKTOP_BOX_TOKEN",
};

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeCredential(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error("credential value must be text or null");
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_CREDENTIAL_LENGTH) throw new Error("credential value is too long");
  if (/[\u0000\r\n]/.test(trimmed)) throw new Error("credential value contains invalid characters");
  return trimmed;
}

export function isDesktopCredentialSection(value) {
  return typeof value === "string" && DESKTOP_CREDENTIAL_SECTIONS.includes(value);
}

export function normalizeCredentials(value) {
  const source = isRecord(value) ? value : {};
  const credentials = {};
  for (const section of DESKTOP_CREDENTIAL_SECTIONS) {
    const normalized = normalizeCredential(source[section]);
    if (normalized !== null) credentials[section] = normalized;
  }
  return credentials;
}

export function applyCredentialPatch(current, section, value) {
  if (!isDesktopCredentialSection(section)) throw new Error("unknown credential section");
  const normalized = normalizeCredential(value);
  const next = { ...normalizeCredentials(current) };
  if (normalized === null) delete next[section];
  else next[section] = normalized;
  return next;
}

export function extractLegacyCredentials(config) {
  const source = isRecord(config) ? config : {};
  return normalizeCredentials({
    xai: isRecord(source.xai) ? source.xai.key : undefined,
    composio: isRecord(source.composio) ? source.composio.key : undefined,
    composioApi: isRecord(source.composio) ? source.composio.apiKey : undefined,
    box: isRecord(source.box) ? source.box.token : undefined,
  });
}

/** Clone a config document and remove only credential fields. Endpoint/profile/
 * instance metadata remains untouched. */
export function stripLegacyCredentials(config) {
  const next = isRecord(config) ? structuredClone(config) : {};
  if (isRecord(next.xai)) delete next.xai.key;
  if (isRecord(next.composio)) {
    delete next.composio.key;
    delete next.composio.apiKey;
  }
  if (isRecord(next.box)) delete next.box.token;
  return next;
}

function writeAtomic(file, bytes) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, bytes, { mode: 0o600 });
  try {
    renameSync(temporary, file);
  } catch (error) {
    if (error?.code !== "EEXIST" && error?.code !== "EPERM") throw error;
    rmSync(file, { force: true });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
  try {
    chmodSync(file, 0o600);
  } catch {}
}

function readConfigDocument(file) {
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    return isRecord(value) ? value : {};
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error("could not read the existing Cumea configuration");
  }
}

function parseVaultDocument(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("the encrypted credential vault is corrupt");
  }
  if (
    !isRecord(value) ||
    value.schema !== CREDENTIAL_VAULT_SCHEMA ||
    value.version !== CREDENTIAL_VAULT_VERSION ||
    !isRecord(value.credentials)
  ) {
    throw new Error("the encrypted credential vault has an unsupported format");
  }
  return normalizeCredentials(value.credentials);
}

function serializeVaultDocument(credentials) {
  return JSON.stringify({
    schema: CREDENTIAL_VAULT_SCHEMA,
    version: CREDENTIAL_VAULT_VERSION,
    credentials: normalizeCredentials(credentials),
  });
}

export function createCredentialVault({ file, safeStorage, platform = process.platform }) {
  if (!file || typeof file !== "string") throw new Error("credential vault file is required");
  if (!safeStorage) throw new Error("safeStorage is required");
  let operation = Promise.resolve();

  const locked = (work) => {
    const next = operation.then(work, work);
    operation = next.catch(() => undefined);
    return next;
  };

  const availabilityRaw = async () => {
    try {
      const available = await safeStorage.isAsyncEncryptionAvailable();
      if (!available) {
        return {
          available: false,
          secure: false,
          backend: null,
          reason: "the operating-system credential store is unavailable",
        };
      }
      const backend =
        platform === "linux" && typeof safeStorage.getSelectedStorageBackend === "function"
          ? safeStorage.getSelectedStorageBackend()
          : null;
      if (platform === "linux" && backend === "basic_text") {
        return {
          available: false,
          secure: false,
          backend,
          reason: "Linux is using Electron's insecure basic_text password backend",
        };
      }
      return { available: true, secure: true, backend, reason: null };
    } catch {
      return {
        available: false,
        secure: false,
        backend: null,
        reason: "the operating-system credential store could not be initialized",
      };
    }
  };

  const requireAvailability = async () => {
    const status = await availabilityRaw();
    if (!status.available) throw new Error(status.reason);
    return status;
  };

  const replaceRaw = async (credentials) => {
    await requireAvailability();
    const normalized = normalizeCredentials(credentials);
    if (Object.keys(normalized).length === 0) {
      rmSync(file, { force: true });
      return normalized;
    }
    const encrypted = await safeStorage.encryptStringAsync(serializeVaultDocument(normalized));
    writeAtomic(file, encrypted);
    return normalized;
  };

  const readRaw = async () => {
    await requireAvailability();
    let encrypted;
    try {
      encrypted = readFileSync(file);
    } catch (error) {
      if (error?.code === "ENOENT") return {};
      throw new Error("the encrypted credential vault could not be read");
    }
    let decrypted;
    try {
      decrypted = await safeStorage.decryptStringAsync(encrypted);
    } catch {
      throw new Error("the encrypted credential vault could not be decrypted");
    }
    const credentials = parseVaultDocument(decrypted.result);
    if (decrypted.shouldReEncrypt) await replaceRaw(credentials);
    return credentials;
  };

  return {
    file,
    availability: () => locked(availabilityRaw),
    read: () => locked(readRaw),
    replace: (credentials) => locked(() => replaceRaw(credentials)),
    update: (section, value) =>
      locked(async () => {
        const current = await readRaw();
        const next = applyCredentialPatch(current, section, value);
        await replaceRaw(next);
        return next;
      }),
  };
}

/** Vault values win over stale plaintext if both exist. Plaintext is removed
 * only after the encrypted replacement has been written successfully. */
export async function migrateLegacyCredentials({ configFile, vault }) {
  const config = readConfigDocument(configFile);
  const legacy = extractLegacyCredentials(config ?? {});
  const legacyPresent = Object.keys(legacy).length > 0;
  const availability = await vault.availability();
  if (!availability.available) {
    return {
      managed: false,
      migrated: false,
      legacyPresent,
      credentials: {},
      storage: availability,
    };
  }

  const stored = await vault.read();
  const credentials = { ...legacy, ...stored };
  if (legacyPresent) {
    await vault.replace(credentials);
    // A failed vault write leaves config untouched. Only this later atomic
    // rewrite is allowed to erase the recoverable plaintext source.
    writeAtomic(configFile, `${JSON.stringify(stripLegacyCredentials(config), null, 2)}\n`);
  }
  return {
    managed: true,
    migrated: legacyPresent,
    legacyPresent,
    credentials,
    storage: availability,
  };
}

export function serverCredentialEnvironment(credentials, token) {
  if (!/^[a-f0-9]{48,128}$/i.test(String(token ?? ""))) {
    throw new Error("a valid per-boot desktop credential token is required");
  }
  const normalized = normalizeCredentials(credentials);
  const environment = {
    CUMEA_DESKTOP_CREDENTIALS_MANAGED: "1",
    CUMEA_DESKTOP_CREDENTIAL_TOKEN: token,
  };
  for (const section of DESKTOP_CREDENTIAL_SECTIONS) {
    const value = normalized[section];
    if (value) environment[SERVER_ENV_FIELDS[section]] = value;
  }
  return environment;
}
