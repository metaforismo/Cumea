import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { McpRegistry } from "./mcp-registry.ts";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe("McpRegistry", () => {
  it("keeps environment values write-only while resolving exact stdio argv internally", () => {
    const directory = mkdtempSync(join(tmpdir(), "cumea-mcp-test-"));
    directories.push(directory);
    const file = join(directory, "mcp-servers.json");
    const registry = new McpRegistry(file, () => 1_000);
    const created = registry.create({
      name: "Private search",
      command: "/usr/local/bin/search-mcp",
      args: ["--stdio"],
      environment: { SEARCH_TOKEN: "secret-value", ARBITRARY: "unlabeled-secret-456" },
    });
    expect(created).toMatchObject({ environmentKeys: ["ARBITRARY", "SEARCH_TOKEN"], enabled: true });
    expect(JSON.stringify(created)).not.toContain("secret-value");
    expect(registry.resolve([created.id])).toEqual([{
      name: expect.stringMatching(/^local_[a-f0-9]{20}$/),
      command: "/usr/local/bin/search-mcp",
      args: ["--stdio"],
      env: { SEARCH_TOKEN: "secret-value", ARBITRARY: "unlabeled-secret-456" },
    }]);
    expect(new McpRegistry(file).list()[0]).not.toHaveProperty("environment");
    expect(readFileSync(file, "utf8")).toContain("secret-value");
    registry.update(created.id, { name: "Renamed" });
    expect(registry.resolve([created.id])[0].env).toEqual({ SEARCH_TOKEN: "secret-value", ARBITRARY: "unlabeled-secret-456" });
    expect(registry.secretValues()).toEqual(["secret-value", "unlabeled-secret-456"]);
  });

  it("rejects values outside the exact command and argv contract", () => {
    const directory = mkdtempSync(join(tmpdir(), "cumea-mcp-test-"));
    directories.push(directory);
    const registry = new McpRegistry(join(directory, "mcp-servers.json"));
    expect(() => registry.create({ name: "bad\nname", command: "tool" })).toThrow(/name/);
    expect(() => registry.create({ name: "tool", command: "tool", args: ["ok\nnext"] })).toThrow(/args/);
    expect(() => registry.create({ name: "tool", command: "tool", environment: { "BAD-NAME": "x" } })).toThrow(/environment/);
  });
});
