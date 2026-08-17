import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
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

const MAX_CREDENTIAL_LENGTH = 2_048;
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

function syncParentDirectory(file) {
  let descriptor = null;
  try {
    descriptor = openSync(path.dirname(file), "r");
    fsyncSync(descriptor);
  } catch {
    // Directory fsync is unavailable on some filesystems, notably Windows.
    // The temporary file itself was still flushed before replacement.
  } finally {
    if (descriptor !== null) {
      try {
        closeSync(descriptor);
      } catch {}
    }
  }
}

function previousFile(file) {
  return `${file}.previous`;
}

/** Recover the only ambiguous Windows fallback state: the prior target was
 * moved aside but the replacement was not installed before process exit.
 *
 * Encrypted-vault backups can be cleaned best-effort after a committed target
 * exists. Legacy config migration is stricter because its `.previous` file can
 * still contain plaintext credentials: that path must not report success while
 * a stale backup cannot be removed. */
function recoverInterruptedReplacement(file, { requirePreviousCleanup = false } = {}) {
  const previous = previousFile(file);
  if (!existsSync(previous)) return;
  if (existsSync(file)) {
    // A target plus a backup means installation completed and only cleanup
    // was interrupted. The target is the committed version.
    try {
      rmSync(previous, { force: true });
    } catch (error) {
      if (requirePreviousCleanup) {
        throw new Error(
          "credential storage recovery failed; stale plaintext backup could not be removed",
          { cause: error },
        );
      }
    }
    if (requirePreviousCleanup && existsSync(previous)) {
      throw new Error("credential storage recovery failed; stale plaintext backup still exists");
    }
    return;
  }
  try {
    renameSync(previous, file);
    syncParentDirectory(file);
  } catch {
    throw new Error("credential storage recovery failed; restart after repairing file permissions");
  }
}

function writeAtomic(file, bytes, { requirePreviousCleanup = false } = {}) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  recoverInterruptedReplacement(file, { requirePreviousCleanup });

  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  const previous = previousFile(file);
  const data = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : Buffer.from(bytes);
  let descriptor = null;
  let installed = false;
  let movedPrevious = false;

  try {
    descriptor = openSync(temporary, "wx", 0o600);
    let offset = 0;
    while (offset < data.length) {
      const written = writeSync(descriptor, data, offset, data.length - offset);
      if (written <= 0) throw new Error("credential storage write made no progress");
      offset += written;
    }
    try {
      chmodSync(temporary, 0o600);
    } catch (error) {
      if (process.platform !== "win32") throw error;
    }
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;

    try {
      renameSync(temporary, file);
      installed = true;
    } catch (error) {
      if (error?.code !== "EEXIST" && error?.code !== "EPERM") throw error;

      // Some Windows filesystems do not replace an existing target through
      // rename. Move the prior complete file aside, install the flushed
      // candidate, and retain a recoverable marker until installation ends.
      if (existsSync(file)) {
        rmSync(previous, { force: true });
        renameSync(file, previous);
        movedPrevious = true;
      }
      try {
        renameSync(temporary, file);
        installed = true;
      } catch (replacementError) {
        if (movedPrevious && !existsSync(file)) {
          try {
            renameSync(previous, file);
            movedPrevious = false;
            syncParentDirectory(file);
          } catch (recoveryError) {
            throw new AggregateError(
              [replacementError, recoveryError],
              "credential storage replacement and recovery both failed",
            );
          }
        }
        throw replacementError;
      }
    }

    syncParentDirectory(file);
    if (movedPrevious) {
      try {
        rmSync(previous, { force: true });
      } catch (error) {
        if (requirePreviousCleanup) {
          throw new Error(
            "credential storage replacement committed but stale plaintext backup could not be removed",
            { cause: error },
          );
        }
        // Encrypted vault cleanup failure is non-fatal: the next read
        // recognizes target+backup as a committed replacement and retries.
      }
      if (requirePreviousCleanup && existsSync(previous)) {
        throw new Error(
          "credential storage replacement committed but stale plaintext backup still exists",
        );
      }
    }
    try {
      chmodSync(file, 0o600);
    } catch {}
  } finally {
    if (descriptor !== null) {
      try {
        closeSync(descriptor);
      } catch {}
    }
    if (!installed) {
      try {
        rmSync(temporary, { force: true });
      } catch {}
    }
  }
}

function readConfigDocument(file) {
  try {
    recoverInterruptedReplacement(file, { requirePreviousCleanup: true });
    const value = JSON.parse(readFileSync(file, "utf8"));
    return isRecord(value) ? value : {};
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error instanceof Error && error.message.startsWith("credential storage recovery failed")) {
      throw error;
    }
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
    recoverInterruptedReplacement(file);
    const normalized = normalizeCredentials(credentials);
    if (Object.keys(normalized).length === 0) {
      rmSync(file, { force: true });
      rmSync(previousFile(file), { force: true });
      syncParentDirectory(file);
      return normalized;
    }
    const encrypted = await safeStorage.encryptStringAsync(serializeVaultDocument(normalized));
    writeAtomic(file, encrypted);
    return normalized;
  };

  const readRaw = async () => {
    await requireAvailability();
    recoverInterruptedReplacement(file);
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
    // rewrite is allowed to erase the recoverable plaintext source. Strict
    // backup cleanup ensures a Windows `.previous` copy cannot silently retain
    // the just-migrated plaintext while migration reports success.
    writeAtomic(configFile, `${JSON.stringify(stripLegacyCredentials(config), null, 2)}\n`, {
      requirePreviousCleanup: true,
    });
  }
  return {
    managed: true,
    migrated: legacyPresent,
    legacyPresent,
    credentials,
    storage: availability,
  };
}

export function serverCredentialEnvironment(credentials) {
  const normalized = normalizeCredentials(credentials);
  const environment = {
    CUMEA_DESKTOP_CREDENTIALS_MANAGED: "1",
  };
  for (const section of DESKTOP_CREDENTIAL_SECTIONS) {
    const value = normalized[section];
    if (value) environment[SERVER_ENV_FIELDS[section]] = value;
  }
  return environment;
}
