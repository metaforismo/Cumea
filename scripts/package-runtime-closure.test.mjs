import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  PACKAGED_SERVER_RUNTIME_ENTRYPOINTS,
  verifyPackagedServerRuntime,
  verifySourceSpawnManifest,
} from "./package-runtime-closure.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function withTemp(prefix, callback) {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  try {
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeText(file, content) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
}

async function writeRuntime(serverRoot, omitted) {
  for (const entrypoint of PACKAGED_SERVER_RUNTIME_ENTRYPOINTS) {
    if (entrypoint.packagePath === omitted) continue;
    await writeText(path.join(serverRoot, entrypoint.packagePath), 'import "node:fs";\n');
  }
}

async function writeSourceManifest(root) {
  const files = new Map();
  for (const entrypoint of PACKAGED_SERVER_RUNTIME_ENTRYPOINTS) {
    files.set(entrypoint.sourcePath, files.get(entrypoint.sourcePath) ?? ["export {};\n"]);
    for (const reference of entrypoint.spawnReferences) {
      const lines = files.get(reference.path) ?? ["export {};\n"];
      lines.push(`// ${reference.literal}\n`);
      files.set(reference.path, lines);
    }
  }
  for (const [relative, lines] of files) {
    await writeText(path.join(root, relative), lines.join(""));
  }
}

test("the repository source proxy manifest matches every packaged sidecar", async () => {
  const result = await verifySourceSpawnManifest({ sourceRoot: repoRoot });
  assert.deepEqual(result.proxySources, [
    "server/computer-proxy.ts",
    "server/drivers/agents-proxy.ts",
    "server/permission-proxy.ts",
  ]);
});

test("the packaged runtime closure accepts the complete self-contained entrypoint set", async () => {
  await withTemp("cumea-package-runtime-", async (serverRoot) => {
    await writeRuntime(serverRoot);
    const result = await verifyPackagedServerRuntime(serverRoot);
    assert.equal(result.entrypoints.length, PACKAGED_SERVER_RUNTIME_ENTRYPOINTS.length);
    assert.deepEqual(result.files, result.entrypoints.slice().sort());
  });
});

test("every declared runtime entrypoint is individually release-critical", async (t) => {
  for (const entrypoint of PACKAGED_SERVER_RUNTIME_ENTRYPOINTS) {
    await t.test(entrypoint.packagePath, async () => {
      await withTemp("cumea-package-missing-entry-", async (serverRoot) => {
        await writeRuntime(serverRoot, entrypoint.packagePath);
        await assert.rejects(
          () => verifyPackagedServerRuntime(serverRoot),
          (error) => {
            assert.match(error.message, /Missing packaged server entrypoint/);
            assert.ok(error.message.includes(entrypoint.packagePath));
            return true;
          },
        );
      });
    });
  }
});

test("a missing transitive relative dependency fails the package gate", async () => {
  await withTemp("cumea-package-transitive-", async (serverRoot) => {
    await writeRuntime(serverRoot);
    await writeText(path.join(serverRoot, "index.js"), 'import "./nested.js";\n');
    await assert.rejects(
      () => verifyPackagedServerRuntime(serverRoot),
      (error) => {
        assert.match(error.message, /Missing packaged server dependency nested\.js/);
        return true;
      },
    );
  });
});

test("bare package imports fail because the packaged server ships without node_modules", async () => {
  await withTemp("cumea-package-bare-import-", async (serverRoot) => {
    await writeRuntime(serverRoot);
    await writeText(path.join(serverRoot, "index.js"), 'import thing from "not-packaged";\nvoid thing;\n');
    await assert.rejects(
      () => verifyPackagedServerRuntime(serverRoot),
      /runtime is not self-contained: index\.js imports bare specifier "not-packaged"/,
    );
  });
});

test("relative imports cannot escape Resources/server even when the target exists", async () => {
  await withTemp("cumea-package-escape-", async (root) => {
    const serverRoot = path.join(root, "server");
    await writeRuntime(serverRoot);
    await writeText(path.join(root, "outside.js"), "export {};\n");
    await writeText(path.join(serverRoot, "index.js"), 'import "../outside.js";\n');
    await assert.rejects(
      () => verifyPackagedServerRuntime(serverRoot),
      /runtime import escapes Resources\/server/,
    );
  });
});

test("literal dynamic imports are followed and non-literal dynamic imports fail closed", async () => {
  await withTemp("cumea-package-dynamic-", async (serverRoot) => {
    await writeRuntime(serverRoot);
    await writeText(path.join(serverRoot, "nested.js"), 'import "node:path";\n');
    await writeText(path.join(serverRoot, "index.js"), 'await import(  "./nested.js"  );\n');
    const result = await verifyPackagedServerRuntime(serverRoot);
    assert.ok(result.files.includes("nested.js"));

    await writeText(path.join(serverRoot, "index.js"), 'const target = "./nested.js";\nawait import(target);\n');
    await assert.rejects(
      () => verifyPackagedServerRuntime(serverRoot),
      /non-literal dynamic import: index\.js/,
    );
  });
});

test("adding a new proxy source without classifying it fails the source manifest gate", async () => {
  await withTemp("cumea-source-proxy-drift-", async (root) => {
    await writeSourceManifest(root);
    await writeText(path.join(root, "server", "future-proxy.ts"), "export {};\n");
    await assert.rejects(
      () => verifySourceSpawnManifest({ sourceRoot: root }),
      /Packaged proxy manifest drift/,
    );
  });
});
