import path from "node:path";

import {
  applyCredentialPatch,
  createCredentialVault,
  isDesktopCredentialSection,
  migrateLegacyCredentials,
  normalizeCredentials,
  serverCredentialEnvironment,
} from "./credential-vault.mjs";

/**
 * Owns desktop credential state in Electron's main process.
 *
 * The packaged host always starts the harness in managed mode, even when the
 * OS vault is unavailable. That quarantines recoverable legacy plaintext on
 * disk instead of allowing the server to silently consume it. Source/browser
 * mode remains the explicit file-backed fallback because Electron is absent.
 */
export function createDesktopCredentialController({
  app,
  safeStorage,
  packaged = app.isPackaged,
  performanceFixture = false,
  dataDir = process.env.CUMEA_DATA_DIR || path.join(app.getPath("home"), ".cumea"),
  vaultFile = path.join(app.getPath("userData"), "credentials.bin"),
  createVault = createCredentialVault,
  migrate = migrateLegacyCredentials,
}) {
  let vault = null;
  let operation = Promise.resolve();
  let state = {
    mode: packaged ? "blocked" : "file",
    managed: false,
    available: !packaged,
    secure: false,
    backend: null,
    reason: packaged
      ? "the operating-system credential store has not been initialized"
      : null,
    migrated: false,
    legacyPresent: false,
    credentials: {},
  };

  const publicStatus = () => ({
    mode: state.mode,
    managed: state.managed,
    available: state.available,
    secure: state.secure,
    backend: state.backend,
    reason: state.reason,
    migrated: state.migrated,
    legacyPresent: state.legacyPresent,
    configured: {
      xai: Boolean(state.credentials.xai),
      composio: Boolean(state.credentials.composio),
      composioApi: Boolean(state.credentials.composioApi),
      box: Boolean(state.credentials.box),
    },
  });

  const initialize = async () => {
    if (!packaged) {
      state = { ...state, mode: "file", available: true, reason: null };
      return publicStatus();
    }

    if (performanceFixture) {
      state = {
        ...state,
        mode: "performance-fixture",
        managed: false,
        available: true,
        secure: false,
        reason: "credential persistence is disabled in the deterministic performance fixture",
        credentials: {},
      };
      return publicStatus();
    }

    vault = createVault({ file: vaultFile, safeStorage, platform: process.platform });
    try {
      const migration = await migrate({
        configFile: path.join(dataDir, "config.json"),
        vault,
      });
      state = {
        ...state,
        mode: migration.managed ? "os" : "blocked",
        managed: migration.managed,
        available: migration.storage.available,
        secure: migration.storage.secure,
        backend: migration.storage.backend,
        reason: migration.storage.reason,
        migrated: migration.migrated,
        legacyPresent: migration.legacyPresent,
        credentials: normalizeCredentials(migration.credentials),
      };
    } catch (error) {
      state = {
        ...state,
        mode: "blocked",
        managed: false,
        available: false,
        secure: false,
        backend: null,
        reason:
          error instanceof Error
            ? error.message
            : "the encrypted credential vault could not be initialized",
        credentials: {},
      };
    }
    return publicStatus();
  };

  /**
   * Packaged children are always placed in managed mode. In blocked mode the
   * environment intentionally contains no credentials, preventing fallback to
   * stale plaintext or ambient provider variables.
   */
  const serverEnvironment = () =>
    packaged ? serverCredentialEnvironment(state.credentials) : {};

  const update = (section, value, restartHarness) => {
    const next = operation.then(async () => {
      if (!isDesktopCredentialSection(section)) throw new Error("unknown credential section");
      if (state.mode !== "os" || !state.managed || !vault) {
        throw new Error(
          state.reason || "secure operating-system credential storage is unavailable",
        );
      }
      if (typeof restartHarness !== "function") {
        throw new Error("the agent host restart callback is unavailable");
      }

      const previous = normalizeCredentials(state.credentials);
      const candidate = applyCredentialPatch(previous, section, value);
      await vault.replace(candidate);
      state = {
        ...state,
        credentials: candidate,
        migrated: false,
        legacyPresent: false,
      };

      try {
        return await restartHarness();
      } catch {
        // Persistence succeeded but the new harness did not accept the
        // bootstrap. Restore durable and live state, then make one best-effort
        // service recovery attempt with the old credentials.
        await vault.replace(previous).catch(() => undefined);
        state = { ...state, credentials: previous };
        await restartHarness().catch(() => undefined);
        throw new Error("the credential was not changed because the agent host could not restart");
      }
    });
    operation = next.catch(() => undefined);
    return next;
  };

  return {
    initialize,
    publicStatus,
    serverEnvironment,
    update,
  };
}
