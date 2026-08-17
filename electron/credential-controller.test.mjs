import assert from "node:assert/strict";
import test from "node:test";

import { createDesktopCredentialController } from "./credential-controller.mjs";

function fakeApp(packaged = true) {
  return {
    isPackaged: packaged,
    getPath(name) {
      return name === "home" ? "/home/test" : "/tmp/cumea-user-data";
    },
  };
}

function migration(overrides = {}) {
  return {
    managed: true,
    migrated: false,
    legacyPresent: false,
    credentials: { box: "old-box" },
    storage: { available: true, secure: true, backend: null, reason: null },
    ...overrides,
  };
}

test("source mode remains the explicit file-backed fallback", async () => {
  const controller = createDesktopCredentialController({
    app: fakeApp(false),
    safeStorage: {},
    packaged: false,
  });
  assert.deepEqual(await controller.initialize(), {
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
  assert.deepEqual(controller.serverEnvironment(), {});
});

test("blocked packaged mode quarantines recoverable legacy plaintext", async () => {
  const controller = createDesktopCredentialController({
    app: fakeApp(),
    safeStorage: {},
    createVault: () => ({}),
    migrate: async () =>
      migration({
        managed: false,
        legacyPresent: true,
        credentials: {},
        storage: {
          available: false,
          secure: false,
          backend: "basic_text",
          reason: "secure storage unavailable",
        },
      }),
  });
  const status = await controller.initialize();
  assert.equal(status.mode, "blocked");
  assert.equal(status.legacyPresent, true);
  assert.deepEqual(controller.serverEnvironment(), {
    CUMEA_DESKTOP_CREDENTIALS_MANAGED: "1",
  });
  await assert.rejects(
    controller.update("box", "new", async () => ({})),
    /secure storage unavailable/,
  );
});

test("performance fixture starts managed child processes without credentials", async () => {
  const controller = createDesktopCredentialController({
    app: fakeApp(),
    safeStorage: {},
    performanceFixture: true,
  });
  const status = await controller.initialize();
  assert.equal(status.mode, "performance-fixture");
  assert.equal(status.managed, false);
  assert.deepEqual(controller.serverEnvironment(), {
    CUMEA_DESKTOP_CREDENTIALS_MANAGED: "1",
  });
});

test("successful vault update restarts the harness with the new bootstrap", async () => {
  const replacements = [];
  const vault = {
    async replace(value) {
      replacements.push(structuredClone(value));
    },
  };
  const controller = createDesktopCredentialController({
    app: fakeApp(),
    safeStorage: {},
    createVault: () => vault,
    migrate: async () => migration(),
  });
  await controller.initialize();
  let restarts = 0;
  const config = { composio: { configured: false }, box: { configured: true } };
  const result = await controller.update("box", "new-box", async () => {
    restarts += 1;
    return config;
  });
  assert.equal(result, config);
  assert.equal(restarts, 1);
  assert.deepEqual(replacements, [{ box: "new-box" }]);
  assert.deepEqual(controller.serverEnvironment(), {
    CUMEA_DESKTOP_CREDENTIALS_MANAGED: "1",
    CUMEA_DESKTOP_BOX_TOKEN: "new-box",
  });
});

test("failed harness restart rolls vault and live bootstrap back", async () => {
  const replacements = [];
  const vault = {
    async replace(value) {
      replacements.push(structuredClone(value));
    },
  };
  const controller = createDesktopCredentialController({
    app: fakeApp(),
    safeStorage: {},
    createVault: () => vault,
    migrate: async () => migration({ credentials: { composio: "old-connect" } }),
  });
  await controller.initialize();
  let restarts = 0;
  await assert.rejects(
    controller.update("composio", "new-connect", async () => {
      restarts += 1;
      if (restarts === 1) throw new Error("new host failed");
      return {};
    }),
    /credential was not changed/,
  );
  assert.equal(restarts, 2);
  assert.deepEqual(replacements, [
    { composio: "new-connect" },
    { composio: "old-connect" },
  ]);
  assert.deepEqual(controller.serverEnvironment(), {
    CUMEA_DESKTOP_CREDENTIALS_MANAGED: "1",
    CUMEA_DESKTOP_COMPOSIO_KEY: "old-connect",
  });
});

test("initialization errors fail closed and do not expose legacy credentials", async () => {
  const controller = createDesktopCredentialController({
    app: fakeApp(),
    safeStorage: {},
    createVault: () => ({}),
    migrate: async () => {
      throw new Error("vault corrupt");
    },
  });
  const status = await controller.initialize();
  assert.equal(status.mode, "blocked");
  assert.equal(status.reason, "vault corrupt");
  assert.deepEqual(controller.serverEnvironment(), {
    CUMEA_DESKTOP_CREDENTIALS_MANAGED: "1",
  });
});
