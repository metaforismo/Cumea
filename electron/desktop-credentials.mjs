import path from "node:path";

import {
  applyCredentialPatch,
  createCredentialVault,
  isDesktopCredentialSection,
  migrateLegacyCredentials,
  normalizeCredentials,
  serverCredentialEnvironment,
} from "./credential-vault.mjs";

export function createDesktopCredentialController({
  app,
  safeStorage,
  packaged = app.isPackaged,
  performanceFixture = false,
  dataDir = process.env.CUMEA_DATA_DIR || path.join(app.getPath("home"), ".cumea"),
  vaultFile = path.join(app.getPath("userData"), "credentials.bin"),
}) {
  let vault = null;
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
  let operation = Promise.resolve();

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
        managed: true,
        available: true,
        secure: false,
        reason: "credential persistence is disabled in the deterministic performance fixture",
        credentials: {},
      };
      return publicStatus();
    }

    vault = createCredentialVault({ file: vaultFile, safeStorage, platform: process.platform });
    try {
      const migration = await migrateLegacyCredentials({
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
        reason:
          error instanceof Error
            ? error.message
            : "the encrypted credential vault could not be initialized",
        credentials: {},
      };
    }
    return publicStatus();
  };

  const serverEnvironment = () =>
    state.managed ? serverCredentialEnvironment(state.credentials) : {};

  const update = (section, value, restartHarness) => {
    const next = operation.then(async () => {
      if (!isDesktopCredentialSection(section)) throw new Error("unknown credential section");
      if (!state.managed || !vault) {
        throw new Error(
          state.reason || "secure operating-system credential storage is unavailable",
        );
      }
      const previous = normalizeCredentials(state.credentials);
      const candidate = applyCredentialPatch(previous, section, value);
      await vault.replace(candidate);
      state = { ...state, credentials: candidate, migrated: false, legacyPresent: false };
      try {
        return await restartHarness();
      } catch {
        // The current process may have failed after persistence but before the
        // harness accepted the new bootstrap. Restore both durable and live
        // state, then make one best-effort attempt to restore service.
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
