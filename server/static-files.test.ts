import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { decodeStaticRequestPath, readStaticFile } from "./static-files.ts";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe("static file boundary", () => {
  it("decodes once and rejects ambiguous or traversing raw targets", () => {
    expect(decodeStaticRequestPath("/assets/app.js?cache=1")).toBe("/assets/app.js");
    expect(decodeStaticRequestPath("/")).toBe("/index.html");
    for (const target of [
      "/../outside", "/.%2e/outside", "/%2e%2e/outside", "/%252e%252e/outside",
      "/%2e%2e%2foutside", "/%252e%252e%252foutside", "/..\\outside", "/..%5coutside",
      "/%00outside", "/%2500outside", "/%0aoutside", "/%ZZ", "//etc/passwd", "C:/outside",
    ]) expect(decodeStaticRequestPath(target), target).toBeNull();
  });

  it("reads only a regular non-symlink file whose real path remains contained", () => {
    const parent = mkdtempSync(join(tmpdir(), "cumea-static-boundary-"));
    roots.push(parent);
    const root = join(parent, "public");
    mkdirSync(join(root, "assets"), { recursive: true });
    writeFileSync(join(root, "assets", "app.js"), "valid-static-asset");
    writeFileSync(join(parent, "outside.txt"), "outside-secret-sentinel");
    symlinkSync(join(parent, "outside.txt"), join(root, "leak.txt"));
    expect(readStaticFile(root, "/assets/app.js")?.bytes.toString()).toBe("valid-static-asset");
    expect(readStaticFile(root, "/../outside.txt")).toBeNull();
    expect(readStaticFile(root, "/leak.txt")).toBeNull();
  });
});

