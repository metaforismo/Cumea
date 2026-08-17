import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createCredentialVault } from "./credential-vault.mjs";
import { createDesktopCredentialController } from "./desktop-credentials.mjs";

const EMPTY_BOOTSTRAP = Object.freeze({
  CUMEA_DESKTOP_XAI_KEY: "",
  CUMEA_DESKTOP_COMPOSIO_KEY: "",
  CUMEA_DESKTOP_COMPOSIO_API_KEY: "",
  CUMEA_DESKTOP_BOX_TOKEN: "",
  CUMEA_DESKTOP_CREDENTIALS_MANAGED: "1",
});

function bootstrap(values = {}) {
  return { ...EMPTY_BOOTSTRAP, ...values };
}

function fakeSafeStorage({
  available = true,
  backend = "gnome_libsecret",
  failEncryptions = [],
} = {}) {
  let encryptions = 0;
  const failures = new Set(failEncryptions);
  return {
    get encryptions() {
      return encryptions;
    },
    async isAsyncEncryptionAvailable() {
      return available;
    },
    getSelectedStorageBackend() {
      return backend;
    },
    async encryptStringAsync(text) {
      encryptions += 1;
      if (failures.has(encryptions)) throw new Error("encryption failed");
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

async function readVault(current) {
  const reopened = createCredentialVault({
    file: current.vaultFile,
    safeStorage: current.safeStorage,
    platform: process.platform,
  });
  return reopened.read();
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
    assert.deepEqual(
      current.controller.serverEnvironment(),
      bootstrap({
        CUMEA_DESKTOP_COMPOSIO_KEY: "connect-secret",
        CUMEA_DESKTOP_COMPOSIO_API_KEY: "project-secret",
        CUMEA_DESKTOP_BOX_TOKEN: "box-secret",
      }),
    );
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
    assert.deepEqual(current.controller.serverEnvironment(), bootstrap());
    await assert.rejects(
      current.controller.update("box", "new", async () => ({})),
      /credential store is unavailable/,
    );
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("successful updates confirm the harness before committing the vault", async () => {
  const current = await fixture();
  try {
    await current.controller.initialize();
    let observed;
    const result = await current.controller.update("box", "new-box", async () => {
      observed = current.controller.serverEnvironment();
      assert.equal(current.safeStorage.encryptions, 0);
      return { composio: { configured: false }, box: { configured: true } };
    });
    assert.deepEqual(
      observed,
      bootstrap({ CUMEA_DESKTOP_BOX_TOKEN: "new-box" }),
    );
    assert.deepEqual(result, {
      composio: { configured: false },
      box: { configured: true },
    });
    assert.equal(current.safeStorage.encryptions, 1);
    assert.deepEqual(await readVault(current), { box: "new-box" });
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("an unconfirmed candidate never replaces the previous vault", async () => {
  const current = await fixture();
  try {
    await current.controller.initialize();
    let restarts = 0;
    await assert.rejects(
      current.controller.update("box", "new-box", async () => {
        restarts += 1;
        return { box: { configured: false } };
      }),
      /credential was not changed/,
    );
    assert.equal(restarts, 2);
    assert.equal(current.safeStorage.encryptions, 0);
    assert.deepEqual(await readVault(current), {});
    assert.equal(current.controller.publicStatus().configured.box, false);
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("failed candidate restart restores the previous live and durable state", async () => {
  const current = await fixture();
  try {
    await current.controller.initialize();
    await current.controller.update("box", "old-box", async () => ({
      box: { configured: true },
    }));
    const observed = [];
    await assert.rejects(
      current.controller.update("box", "new-box", async () => {
        observed.push(current.controller.serverEnvironment().CUMEA_DESKTOP_BOX_TOKEN);
        if (observed.length === 1) throw new Error("restart failed");
        return { box: { configured: true } };
      }),
      /credential was not changed/,
    );
    assert.deepEqual(observed, ["new-box", "old-box"]);
    assert.equal(current.safeStorage.encryptions, 1);
    assert.equal(current.controller.publicStatus().configured.box, true);
    assert.deepEqual(await readVault(current), { box: "old-box" });
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("failed secure-storage commit leaves the previous vault untouched", async () => {
  const safeStorage = fakeSafeStorage({ failEncryptions: [2] });
  const current = await fixture({ safeStorage });
  try {
    await current.controller.initialize();
    await current.controller.update("box", "old-box", async () => ({
      box: { configured: true },
    }));
    const observed = [];
    await assert.rejects(
      current.controller.update("box", "new-box", async () => {
        observed.push(current.controller.serverEnvironment().CUMEA_DESKTOP_BOX_TOKEN);
        return { box: { configured: true } };
      }),
      /secure storage could not commit it/,
    );
    assert.deepEqual(observed, ["new-box", "old-box"]);
    assert.equal(current.controller.publicStatus().configured.box, true);
    assert.deepEqual(await readVault(current), { box: "old-box" });
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("the previous vault stays authoritative when harness recovery fails", async () => {
  const current = await fixture();
  try {
    await current.controller.initialize();
    await current.controller.update("box", "old-box", async () => ({
      box: { configured: true },
    }));
    let restarts = 0;
    await assert.rejects(
      current.controller.update("box", "new-box", async () => {
        restarts += 1;
        if (restarts === 1) throw new Error("candidate restart failed");
        return { box: { configured: false } };
      }),
      /previous vault is still authoritative/,
    );
    assert.equal(current.safeStorage.encryptions, 1);
    assert.deepEqual(await readVault(current), { box: "old-box" });
    assert.equal(current.controller.publicStatus().configured.box, true);
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
    assert.deepEqual(current.controller.serverEnvironment(), bootstrap());
    await assert.rejects(
      current.controller.update("box", "secret", async () => ({})),
      /persistence is disabled/,
    );
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});
