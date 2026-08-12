import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { writeFileAtomic } from "./atomic.ts";

const scratchDirs: string[] = [];

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "cumea-atomic-test-"));
  scratchDirs.push(dir);
  return dir;
}

describe("writeFileAtomic", () => {
  it("creates and replaces a complete UTF-8 file without temp leftovers", () => {
    const dir = scratch();
    const path = join(dir, "state.json");

    writeFileAtomic(path, "first");
    writeFileAtomic(path, "second — σίβυλλα");

    expect(readFileSync(path, "utf8")).toBe("second — σίβυλλα");
    expect(readdirSync(dir)).toEqual(["state.json"]);
    if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("removes its temp file when the destination cannot be replaced", () => {
    const dir = scratch();
    const destination = join(dir, "occupied");
    mkdirSync(destination);

    expect(() => writeFileAtomic(destination, "nope")).toThrow();
    expect(readdirSync(dir)).toEqual(["occupied"]);
  });
});
