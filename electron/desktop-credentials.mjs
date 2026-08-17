import path from "node:path";

import {
  applyCredentialPatch,
  createCredentialVault,
  isDesktopCredentialSection,
  migrateLegacyCredentials,
  normalizeCredentials,
  serverCredentialEnvironment,
} from "./credential-vault.mjs";

const EMPTY_SERVER_CREDENTIAL_ENVIRONMENT = Object.freeze({
  CUMEA_DESKTOP_XAI_KEY: "",
  CUMEA_DESKTOP_COMPOSIO_KEY: "",
  CUMEA_DESKTOP_COMPOSIO_API_KEY: "",
  CUMEA_DESKTOP_BOX_TOKEN: "",
});

function confirmedCredentialState(config, section) {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  switch (section) {
    case "xai":
      return typeof config.xai?.configured === "boolean" ? config.xai.configured : null;
    case "composio":
      return typeof config.composio?.configured === "boolean"
        ? config.composio.configured
        : null;
    case "composioApi":
      return typeof config.composio?.apiKeyConfigured === "boolean"
        ? config.composio.apiKeyConfigured
        : null;
    case "box":
      return typeof config.box?.configured === "boolean" ? config.box.configured : null;
    default:
      return null;
  }
}

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
    // A packaged desktop always owns the credential boundary. Even when the
    // OS store is unavailable it boots the harness in managed mode with an
    // empty credential set, so preserved legacy plaintext is never consumed.
    managed: packaged,
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
      state = {
        ...state,
        mode: "file",
        managed: false,
        available: true,
        reason: null,
      };
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
        managed: true,
        available: migration.storage.available,
        secure: migration.storage.secure,
        backend: migration.storage.backend,
        reason: migration.storage.reason,
        migrated: migration.migrated,
        legacyPresent: migration.legacyPresent,
        credentials: migration.managed
          ? normalizeCredentials(migration.credentials)
          : {},
      };
    } catch (error) {
      state = {
        ...state,
        mode: "blocked",
        managed: true,
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
    state.managed
      ? {
          // Explicit empty values overwrite any ambient CUMEA_DESKTOP_* fields
          // before the child starts. Only the controller's current vault state
          // may populate the bootstrap.
          ...EMPTY_SERVER_CREDENTIAL_ENVIRONMENT,
          ...serverCredentialEnvironment(state.credentials),
        }
      : {};

  const update = (section, value, restartHarness) => {
    const next = operation.then(async () => {
      if (!isDesktopCredentialSection(section)) throw new Error("unknown credential section");
      if (state.mode !== "os" || !vault) {
        throw new Error(
          state.reason || "secure operating-system credential storage is unavailable",
        );
      }
      const previous = normalizeCredentials(state.credentials);
      const candidate = applyCredentialPatch(previous, section, value);
      const expectedCandidateState = Boolean(candidate[section]);
      await vault.replace(candidate);
      state = { ...state, credentials: candidate, migrated: false, legacyPresent: false };
      try {
        const config = await restartHarness();
        if (confirmedCredentialState(config, section) !== expectedCandidateState) {
          throw new Error("the restarted agent host did not confirm the credential state");
        }
        return config;
      } catch {
        // A failure after persistence must not leave the UI claiming an old
        // value while the vault contains the candidate. Durable rollback is
        // therefore mandatory and its failure blocks further writes.
        try {
          await vault.replace(previous);
        } catch {
          state = {
            ...state,
            mode: "blocked",
            available: false,
            secure: false,
            reason:
              "credential update failed and encrypted rollback could not be verified; restart Cumea before retrying",
            credentials: {},
          };
          throw new Error(
            "the credential update failed and could not be rolled back safely; restart Cumea before retrying",
          );
        }

        state = { ...state, credentials: previous };
        let recovered = false;
        try {
          const recoveryConfig = await restartHarness();
          recovered =
            confirmedCredentialState(recoveryConfig, section) === Boolean(previous[section]);
        } catch {
          recovered = false;
        }
        if (!recovered) {
          throw new Error(
            "the credential was restored, but the agent host could not recover automatically; restart Cumea",
          );
        }
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
