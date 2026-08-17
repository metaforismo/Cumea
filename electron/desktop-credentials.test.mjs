import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createCredentialVault } from "./credential-vault.mjs";
import { createDesktopCredentialController } from "./desktop-credentials.mjs";

function fakeSafeStorage({ available = true, backend = "gnome_libsecret" } = {}) {
  return {
    async isAsyncEncryptionAvailable() {
      return available;
    },
    getSelectedStorageBackend() {
      return backend;
    },
    async encryptStringAsync(text) {
      return Buffer.from(Buffer.from(text, "utf8").toString("base64"), "utf8");
    },
    async decryptStringAsync(buffer) {
      return {
        result: Buffer.from(buffer.toString("utf8"), "base64").toString("utf8"),
        shouldReEncrypt: false,
      };
    },
  };
}

function fakeApp(root, packaged = true) {
  return {
    isPackaged: packaged,
    getPath(name) {
      if (name === "home") return path.join(root, "home");
      if (name === "userData") return path.join(root, "user-data");
      throw new Error(`unexpected app path: ${name}`);
    },
  };
}

async function fixture(options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cumea-desktop-credentials-"));
  const dataDir = path.join(root, "data");
  const vaultFile = path.join(root, "user-data", "credentials.bin");
  const app = fakeApp(root, options.packaged ?? true);
  const safeStorage = options.safeStorage ?? fakeSafeStorage();
  const controller = createDesktopCredentialController({
    app,
    safeStorage,
    packaged: options.packaged ?? true,
    performanceFixture: options.performanceFixture ?? false,
    dataDir,
    vaultFile,
  });
  return { root, dataDir, vaultFile, app, safeStorage, controller };
}

test("source mode keeps the explicit owner-only file fallback", async () => {
  const current = await fixture({ packaged: false });
  try {
    assert.deepEqual(await current.controller.initialize(), {
      mode: "file",
      managed: false,
      available: true,
      secure: false,
      backend: null,
      reason: null,
      migrated: false,
      legacyPresent: false,
      configured: { xai: false, composio: false, composioApi: false, box: false },
    });
    assert.deepEqual(current.controller.serverEnvironment(), {});
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("packaged initialization migrates plaintext and exposes flags only", async () => {
  const current = await fixture();
  mkdirSync(current.dataDir, { recursive: true, mode: 0o700 });
  writeFileSync(
    path.join(current.dataDir, "config.json"),
    JSON.stringify({
      composio: { key: "connect-secret", apiKey: "project-secret" },
      box: { token: "box-secret" },
      profile: { name: "Francesco" },
    }),
    { mode: 0o600 },
  );
  try {
    const status = await current.controller.initialize();
    assert.equal(status.mode, "os");
    assert.equal(status.managed, true);
    assert.equal(status.migrated, true);
    assert.deepEqual(status.configured, {
      xai: false,
      composio: true,
      composioApi: true,
      box: true,
    });
    assert.doesNotMatch(JSON.stringify(status), /connect-secret|project-secret|box-secret/);
    assert.deepEqual(JSON.parse(readFileSync(path.join(current.dataDir, "config.json"), "utf8")), {
      composio: {},
      box: {},
      profile: { name: "Francesco" },
    });
    assert.deepEqual(current.controller.serverEnvironment(), {
      CUMEA_DESKTOP_CREDENTIALS_MANAGED: "1",
      CUMEA_DESKTOP_COMPOSIO_KEY: "connect-secret",
      CUMEA_DESKTOP_COMPOSIO_API_KEY: "project-secret",
      CUMEA_DESKTOP_BOX_TOKEN: "box-secret",
    });
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("unavailable OS storage preserves recovery data but boots the harness empty", async () => {
  const current = await fixture({ safeStorage: fakeSafeStorage({ available: false }) });
  mkdirSync(current.dataDir, { recursive: true, mode: 0o700 });
  const configFile = path.join(current.dataDir, "config.json");
  const original = JSON.stringify({ box: { token: "legacy-box" } });
  writeFileSync(configFile, original, { mode: 0o600 });
  try {
    const status = await current.controller.initialize();
    assert.equal(status.mode, "blocked");
    assert.equal(status.managed, true);
    assert.equal(status.available, false);
    assert.equal(status.legacyPresent, true);
    assert.deepEqual(status.configured, {
      xai: false,
      composio: false,
      composioApi: false,
      box: false,
    });
    assert.equal(readFileSync(configFile, "utf8"), original);
    assert.deepEqual(current.controller.serverEnvironment(), {
      CUMEA_DESKTOP_CREDENTIALS_MANAGED: "1",
    });
    await assert.rejects(
      current.controller.update("box", "new", async () => ({})),
      /credential store is unavailable/,
    );
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("successful updates persist first and restart with the new bootstrap", async () => {
  const current = await fixture();
  try {
    await current.controller.initialize();
    let observed;
    const result = await current.controller.update("box", "new-box", async () => {
      observed = current.controller.serverEnvironment();
      return { composio: { configured: false }, box: { configured: true } };
    });
    assert.deepEqual(observed, {
      CUMEA_DESKTOP_CREDENTIALS_MANAGED: "1",
      CUMEA_DESKTOP_BOX_TOKEN: "new-box",
    });
    assert.deepEqual(result, {
      composio: { configured: false },
      box: { configured: true },
    });
    const reopened = createCredentialVault({
      file: current.vaultFile,
      safeStorage: current.safeStorage,
      platform: process.platform,
    });
    assert.deepEqual(await reopened.read(), { box: "new-box" });
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("failed harness restart rolls durable and live credentials back", async () => {
  const current = await fixture();
  try {
    await current.controller.initialize();
    await current.controller.update("box", "old-box", async () => ({}));
    const observed = [];
    await assert.rejects(
      current.controller.update("box", "new-box", async () => {
        observed.push(current.controller.serverEnvironment().CUMEA_DESKTOP_BOX_TOKEN);
        if (observed.length === 1) throw new Error("restart failed");
        return {};
      }),
      /credential was not changed/,
    );
    assert.deepEqual(observed, ["new-box", "old-box"]);
    assert.equal(current.controller.publicStatus().configured.box, true);
    const reopened = createCredentialVault({
      file: current.vaultFile,
      safeStorage: current.safeStorage,
      platform: process.platform,
    });
    assert.deepEqual(await reopened.read(), { box: "old-box" });
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("performance fixture never reads or persists credentials", async () => {
  const current = await fixture({ performanceFixture: true });
  try {
    const status = await current.controller.initialize();
    assert.equal(status.mode, "performance-fixture");
    assert.equal(status.managed, true);
    assert.deepEqual(current.controller.serverEnvironment(), {
      CUMEA_DESKTOP_CREDENTIALS_MANAGED: "1",
    });
    await assert.rejects(
      current.controller.update("box", "secret", async () => ({})),
      /persistence is disabled/,
    );
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});
