import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

export const PACKAGED_SERVER_RUNTIME_ENTRYPOINTS = Object.freeze([
  {
    packagePath: "index.js",
    sourcePath: "server/index.ts",
    role: "desktop harness",
    spawnReferences: [],
  },
  {
    packagePath: "drivers/agents-proxy.js",
    sourcePath: "server/drivers/agents-proxy.ts",
    role: "agent delegation MCP sidecar",
    spawnReferences: [{ path: "server/index.ts", literal: "agents-proxy" }],
  },
  {
    packagePath: "computer-proxy.js",
    sourcePath: "server/computer-proxy.ts",
    role: "cloud computer MCP sidecar",
    spawnReferences: [{ path: "server/drivers/claude.ts", literal: "computer-proxy" }],
  },
  {
    packagePath: "permission-proxy.js",
    sourcePath: "server/permission-proxy.ts",
    role: "Claude permission MCP sidecar",
    spawnReferences: [{ path: "server/drivers/claude.ts", literal: "permission-proxy" }],
  },
]);

function portable(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function requireRegularFile(file, label = "packaged runtime file") {
  let details;
  try {
    details = await stat(file);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      throw new Error(`Missing ${label}: ${file}`);
    }
    throw error;
  }
  if (!details.isFile() || details.size < 1) {
    throw new Error(`Missing or empty ${label}: ${file}`);
  }
}

function literalRuntimeSpecifiers(source, file) {
  const specifiers = new Set();
  const patterns = [
    /(?:^|\n)\s*import\s+(?:[\w*$\s{},]+\s+from\s+)?["']([^"']+)["']/g,
    /(?:^|\n)\s*export\s+(?:\*|\{[\s\S]*?\})\s+from\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.add(match[1]);
  }

  if (/\bimport\s*\((?!\s*["'])/.test(source)) {
    throw new Error(`Packaged server runtime uses a non-literal dynamic import: ${file}`);
  }
  if (/\brequire\s*\((?!\s*["'])/.test(source)) {
    throw new Error(`Packaged server runtime uses a non-literal require: ${file}`);
  }
  return [...specifiers];
}

export async function verifyPackagedServerRuntime(serverDirectory, options = {}) {
  const serverRoot = path.resolve(serverDirectory);
  const realServerRoot = await realpath(serverRoot);
  const entrypoints = options.entrypoints ?? PACKAGED_SERVER_RUNTIME_ENTRYPOINTS;
  const queue = [];

  for (const entrypoint of entrypoints) {
    const relative = typeof entrypoint === "string" ? entrypoint : entrypoint.packagePath;
    const target = path.resolve(serverRoot, relative);
    if (!isInside(serverRoot, target)) {
      throw new Error(`Packaged server entrypoint escapes the server root: ${relative}`);
    }
    await requireRegularFile(target, `packaged server entrypoint ${relative}`);
    queue.push(target);
  }

  const visited = new Set();
  while (queue.length > 0) {
    const current = queue.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);

    const realCurrent = await realpath(current);
    if (!isInside(realServerRoot, realCurrent)) {
      throw new Error(`Packaged server runtime resolves outside Resources/server: ${current}`);
    }

    const source = await readFile(current, "utf8");
    for (const specifier of literalRuntimeSpecifiers(source, portable(path.relative(serverRoot, current)))) {
      if (specifier.startsWith("node:")) continue;
      if (!specifier.startsWith(".")) {
        throw new Error(
          `Packaged server runtime is not self-contained: ${portable(path.relative(serverRoot, current))} imports bare specifier "${specifier}"`,
        );
      }

      const target = path.resolve(path.dirname(current), specifier);
      if (!isInside(serverRoot, target)) {
        throw new Error(
          `Packaged server runtime import escapes Resources/server: ${portable(path.relative(serverRoot, current))} -> ${specifier}`,
        );
      }
      await requireRegularFile(
        target,
        `packaged server dependency ${portable(path.relative(serverRoot, target))}`,
      );
      queue.push(target);
    }
  }

  return {
    entrypoints: entrypoints.map((entrypoint) =>
      typeof entrypoint === "string" ? entrypoint : entrypoint.packagePath,
    ),
    files: [...visited].map((file) => portable(path.relative(serverRoot, file))).sort(),
  };
}

async function discoverProxySources(directory, sourceRoot, output) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await discoverProxySources(target, sourceRoot, output);
    } else if (entry.isFile() && entry.name.endsWith("-proxy.ts") && !entry.name.endsWith(".test.ts")) {
      output.push(portable(path.relative(sourceRoot, target)));
    }
  }
}

export async function verifySourceSpawnManifest({ sourceRoot }) {
  const root = path.resolve(sourceRoot);
  const expectedProxySources = PACKAGED_SERVER_RUNTIME_ENTRYPOINTS
    .map((entrypoint) => entrypoint.sourcePath)
    .filter((sourcePath) => sourcePath.endsWith("-proxy.ts"))
    .sort();
  const discoveredProxySources = [];
  await discoverProxySources(path.join(root, "server"), root, discoveredProxySources);
  discoveredProxySources.sort();

  if (JSON.stringify(discoveredProxySources) !== JSON.stringify(expectedProxySources)) {
    throw new Error(
      `Packaged proxy manifest drift: expected [${expectedProxySources.join(", ")}], found [${discoveredProxySources.join(", ")}]. ` +
        "Every server/*-proxy.ts sidecar must be classified in PACKAGED_SERVER_RUNTIME_ENTRYPOINTS.",
    );
  }

  for (const entrypoint of PACKAGED_SERVER_RUNTIME_ENTRYPOINTS) {
    await requireRegularFile(path.join(root, entrypoint.sourcePath), `runtime source ${entrypoint.sourcePath}`);
    for (const reference of entrypoint.spawnReferences) {
      const sourceFile = path.join(root, reference.path);
      await requireRegularFile(sourceFile, `spawn source ${reference.path}`);
      const source = await readFile(sourceFile, "utf8");
      if (!source.includes(reference.literal)) {
        throw new Error(
          `Runtime spawn manifest drift: ${reference.path} no longer references ${reference.literal} for ${entrypoint.packagePath}`,
        );
      }
    }
  }

  return { proxySources: discoveredProxySources };
}
