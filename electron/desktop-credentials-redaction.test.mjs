import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createDesktopCredentialController } from "./desktop-credentials.mjs";

test("initialization redacts unexpected storage errors and preserves plaintext recovery", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cumea-credential-redaction-"));
  const dataDir = path.join(root, "data");
  const configFile = path.join(dataDir, "config.json");
  const secretPath = path.join(root, "private-user-name", "credentials.bin");
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const original = JSON.stringify({ box: { token: "legacy-box" } });
  writeFileSync(configFile, original, { mode: 0o600 });

  const app = {
    isPackaged: true,
    getPath(name) {
      if (name === "home") return path.join(root, "home");
      if (name === "userData") return path.join(root, "user-data");
      throw new Error(`unexpected app path: ${name}`);
    },
  };
  const safeStorage = {
    async isAsyncEncryptionAvailable() {
      return true;
    },
    async encryptStringAsync() {
      throw new Error(`EACCES: permission denied, open '${secretPath}'`);
    },
    async decryptStringAsync() {
      throw new Error("not reached");
    },
  };

  try {
    const controller = createDesktopCredentialController({
      app,
      safeStorage,
      packaged: true,
      dataDir,
      vaultFile: path.join(root, "user-data", "credentials.bin"),
    });
    const status = await controller.initialize();
    assert.equal(status.mode, "blocked");
    assert.equal(status.managed, true);
    assert.equal(status.available, false);
    assert.equal(status.reason, "the encrypted credential vault could not be initialized");
    assert.doesNotMatch(JSON.stringify(status), /private-user-name|EACCES|legacy-box/);
    assert.equal(readFileSync(configFile, "utf8"), original);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
