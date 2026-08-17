import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  applyCredentialPatch,
  createCredentialVault,
  extractLegacyCredentials,
  migrateLegacyCredentials,
  serverCredentialEnvironment,
  stripLegacyCredentials,
} from "./credential-vault.mjs";

function fakeSafeStorage({ available = true, backend = "gnome_libsecret", rotate = false } = {}) {
  let encryptions = 0;
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
      return Buffer.from(`encrypted:${text}`, "utf8");
    },
    async decryptStringAsync(buffer) {
      const text = buffer.toString("utf8");
      if (!text.startsWith("encrypted:")) throw new Error("bad ciphertext");
      return { result: text.slice("encrypted:".length), shouldReEncrypt: rotate };
    },
  };
}

test("legacy extraction and stripping preserve non-secret metadata", () => {
  const config = {
    xai: { key: "xai", url: "https://x.example" },
    composio: { key: "connect", apiKey: "project", url: "https://c.example" },
    box: { token: "box" },
    profile: { name: "Francesco" },
  };
  assert.deepEqual(extractLegacyCredentials(config), {
    xai: "xai",
    composio: "connect",
    composioApi: "project",
    box: "box",
  });
  assert.deepEqual(stripLegacyCredentials(config), {
    xai: { url: "https://x.example" },
    composio: { url: "https://c.example" },
    box: {},
    profile: { name: "Francesco" },
  });
  assert.equal(config.xai.key, "xai");
});

test("migration encrypts before atomically removing plaintext", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cumea-vault-"));
  const configFile = path.join(directory, "config.json");
  const vaultFile = path.join(directory, "credentials.bin");
  const safeStorage = fakeSafeStorage();
  const vault = createCredentialVault({ file: vaultFile, safeStorage, platform: "darwin" });
  try {
    writeFileSync(
      configFile,
      JSON.stringify({
        composio: { key: "legacy-connect", apiKey: "legacy-project" },
        box: { token: "legacy-box" },
        profile: { name: "Francesco" },
      }),
      { mode: 0o600 },
    );
    await vault.replace({ composio: "vault-wins" });
    const result = await migrateLegacyCredentials({ configFile, vault });
    assert.equal(result.managed, true);
    assert.equal(result.migrated, true);
    assert.deepEqual(result.credentials, {
      composio: "vault-wins",
      composioApi: "legacy-project",
      box: "legacy-box",
    });
    assert.deepEqual(JSON.parse(readFileSync(configFile, "utf8")), {
      composio: {},
      box: {},
      profile: { name: "Francesco" },
    });
    assert.deepEqual(await vault.read(), result.credentials);
    assert.doesNotMatch(readFileSync(vaultFile).toString("utf8"), /legacy-box/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("unavailable or insecure storage leaves legacy plaintext untouched", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cumea-vault-"));
  const configFile = path.join(directory, "config.json");
  const original = JSON.stringify({ box: { token: "legacy-box" } });
  writeFileSync(configFile, original, { mode: 0o600 });
  try {
    for (const options of [
      { available: false, platform: "darwin" },
      { available: true, backend: "basic_text", platform: "linux" },
    ]) {
      const vault = createCredentialVault({
        file: path.join(directory, `${options.platform}.bin`),
        safeStorage: fakeSafeStorage(options),
        platform: options.platform,
      });
      const result = await migrateLegacyCredentials({ configFile, vault });
      assert.equal(result.managed, false);
      assert.equal(result.legacyPresent, true);
      assert.equal(readFileSync(configFile, "utf8"), original);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("vault updates are serialized and clearing the final value removes the file", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cumea-vault-"));
  const vaultFile = path.join(directory, "credentials.bin");
  const vault = createCredentialVault({
    file: vaultFile,
    safeStorage: fakeSafeStorage(),
    platform: "win32",
  });
  try {
    await Promise.all([
      vault.update("composio", "connect"),
      vault.update("composioApi", "project"),
      vault.update("box", "box"),
    ]);
    assert.deepEqual(await vault.read(), {
      composio: "connect",
      composioApi: "project",
      box: "box",
    });
    await vault.update("composio", null);
    await vault.update("composioApi", null);
    await vault.update("box", null);
    assert.deepEqual(await vault.read(), {});
    assert.throws(() => readFileSync(vaultFile), /ENOENT/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("key rotation rewrites a decryptable vault", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cumea-vault-"));
  const safeStorage = fakeSafeStorage({ rotate: true });
  const vault = createCredentialVault({
    file: path.join(directory, "credentials.bin"),
    safeStorage,
    platform: "darwin",
  });
  try {
    await vault.replace({ box: "box" });
    assert.equal(safeStorage.encryptions, 1);
    assert.deepEqual(await vault.read(), { box: "box" });
    assert.equal(safeStorage.encryptions, 2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("corrupt encrypted data fails closed without touching legacy config", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cumea-vault-"));
  const configFile = path.join(directory, "config.json");
  const vaultFile = path.join(directory, "credentials.bin");
  const original = JSON.stringify({ composio: { key: "legacy" } });
  writeFileSync(configFile, original);
  writeFileSync(vaultFile, "not-encrypted");
  const vault = createCredentialVault({
    file: vaultFile,
    safeStorage: fakeSafeStorage(),
    platform: "darwin",
  });
  try {
    await assert.rejects(migrateLegacyCredentials({ configFile, vault }), /could not be decrypted/);
    assert.equal(readFileSync(configFile, "utf8"), original);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("server environment uses only bounded dedicated fields", () => {
  const environment = serverCredentialEnvironment(
    { xai: "xai", composio: "connect", composioApi: "project", box: "box" },
    "a".repeat(64),
  );
  assert.deepEqual(environment, {
    CUMEA_DESKTOP_CREDENTIALS_MANAGED: "1",
    CUMEA_DESKTOP_CREDENTIAL_TOKEN: "a".repeat(64),
    CUMEA_DESKTOP_XAI_KEY: "xai",
    CUMEA_DESKTOP_COMPOSIO_KEY: "connect",
    CUMEA_DESKTOP_COMPOSIO_API_KEY: "project",
    CUMEA_DESKTOP_BOX_TOKEN: "box",
  });
  assert.deepEqual(applyCredentialPatch({ box: "box" }, "box", ""), {});
});
