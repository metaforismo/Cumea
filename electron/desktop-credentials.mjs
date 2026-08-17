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

const PUBLIC_INITIALIZATION_ERROR_PREFIXES = [
  "the encrypted credential vault ",
  "the operating-system credential store ",
  "Linux is using Electron's insecure basic_text password backend",
  "credential storage recovery failed",
  "could not read the existing Cumea configuration",
  "credential value is too long",
  "credential value contains invalid characters",
];

function publicInitializationReason(error) {
  const message = error instanceof Error ? error.message : "";
  return PUBLIC_INITIALIZATION_ERROR_PREFIXES.some((prefix) => message.startsWith(prefix))
    ? message.slice(0, 300)
    : "the encrypted credential vault could not be initialized";
}

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
        reason: publicInitializationReason(error),
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

  const recoverPreviousHarness = async (section, previous, restartHarness, message) => {
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
        `${message}; the previous vault is still authoritative, but the agent host could not recover automatically — restart Cumea`,
      );
    }
    throw new Error(message);
  };

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

      // Validate the exact bootstrap in a fresh harness before committing the
      // candidate at rest. If Cumea is killed during this stage, the child dies
      // with the app and the previous vault remains authoritative on restart.
      state = { ...state, credentials: candidate, migrated: false, legacyPresent: false };
      let config;
      try {
        config = await restartHarness();
        if (confirmedCredentialState(config, section) !== expectedCandidateState) {
          throw new Error("the restarted agent host did not confirm the credential state");
        }
      } catch {
        return recoverPreviousHarness(
          section,
          previous,
          restartHarness,
          "the credential was not changed because the agent host rejected the new bootstrap",
        );
      }

      // Atomic vault replacement is the commit point. A failed encryption or
      // write leaves the previous file untouched, then the harness is restored
      // to match that still-authoritative durable state.
      try {
        await vault.replace(candidate);
      } catch {
        return recoverPreviousHarness(
          section,
          previous,
          restartHarness,
          "the credential was not saved because secure storage could not commit it",
        );
      }

      return config;
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
