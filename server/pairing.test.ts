import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { PairingStore } from "./pairing.ts";

const tempDirs: string[] = [];

function fixture(now: () => number) {
  const directory = mkdtempSync(join(tmpdir(), "cumea-pairing-test-"));
  tempDirs.push(directory);
  const file = join(directory, "mobile-devices.json");
  return { store: new PairingStore(file, now), file };
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("PairingStore", () => {
  it("mints a high-entropy, one-time claim and persists only hashes", () => {
    let now = 1_000;
    const { store, file } = fixture(() => now);
    const session = store.createSession("https://host.example");

    expect(session.secret.length).toBeGreaterThanOrEqual(40);
    expect(session.verificationCode).toMatch(/^\d{6}$/);
    expect(session.claimUrl).toBe("https://host.example/api/pairing/claim");

    now += 10;
    const claimed = store.claim(session.id, session.secret, "Francesco's iPhone");
    expect(claimed.token).toMatch(/^cumea_device_[A-Za-z0-9_-]{40,}$/);
    expect(store.authenticate(claimed.token)).toMatchObject({ id: claimed.device.id, name: "Francesco's iPhone" });
    expect(new PairingStore(file, () => now).authenticate(claimed.token)?.id).toBe(claimed.device.id);
    expect(() => store.claim(session.id, session.secret, "second device")).toThrow(/already used/);

    const disk = readFileSync(file, "utf8");
    expect(disk).not.toContain(session.secret);
    expect(disk).not.toContain(claimed.token);
    expect(disk).toContain("tokenHash");
  });

  it("rejects wrong, expired, and revoked credentials", () => {
    let now = 50_000;
    const { store } = fixture(() => now);
    const wrongSecret = store.createSession("https://host.example", 1_000);
    expect(() => store.claim(wrongSecret.id, "wrong", "phone")).toThrow(/invalid pairing secret/);

    const expired = store.createSession("https://host.example", 1_000);
    now += 1_001;
    expect(() => store.claim(expired.id, expired.secret, "phone")).toThrow(/expired/);

    const valid = store.createSession("https://host.example", 1_000);
    const claimed = store.claim(valid.id, valid.secret, "phone");
    expect(store.authenticate(claimed.token)?.id).toBe(claimed.device.id);
    expect(store.isActive(claimed.device.id)).toBe(true);
    expect(store.revoke(claimed.device.id)?.revokedAt).toBe(now);
    expect(store.isActive(claimed.device.id)).toBe(false);
    expect(store.authenticate(claimed.token)).toBeNull();
  });
});
