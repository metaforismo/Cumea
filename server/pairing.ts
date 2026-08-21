import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { writeFileAtomic } from "./atomic.ts";
import { DATA_DIR } from "./config.ts";
import { assertPersistenceWritable, loadPersistentJson } from "./persistence-health.ts";

export const MOBILE_DEVICES_FILE = join(DATA_DIR, "mobile-devices.json");
export const DEFAULT_PAIRING_TTL_MS = 5 * 60_000;

interface PairingSessionRecord {
  id: string;
  secretHash: string;
  createdAt: number;
  expiresAt: number;
  claimedAt?: number;
}

interface StoredDeviceRecord {
  id: string;
  name: string;
  tokenHash: string;
  createdAt: number;
  lastSeenAt: number;
  revokedAt?: number;
  push?: {
    token: string;
    platform: "ios" | "android";
    updatedAt: number;
  };
}

export interface PublicDeviceRecord {
  id: string;
  name: string;
  createdAt: number;
  lastSeenAt: number;
  revokedAt?: number;
  pushEnabled: boolean;
  pushPlatform?: "ios" | "android";
}

export interface DevicePushTarget {
  deviceId: string;
  token: string;
  platform: "ios" | "android";
}

const EXPO_PUSH_TOKEN = /^(?:ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$/;

export interface PairingSession {
  id: string;
  /** Returned exactly once to the trusted local UI; only its hash is retained. */
  secret: string;
  hostUrl: string;
  expiresAt: number;
  verificationCode: string;
  claimUrl: string;
  pairingUri: string;
}

export interface ClaimedDevice {
  token: string;
  device: PublicDeviceRecord;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function digestHex(value: string): string {
  return digest(value).toString("hex");
}

function hashesMatch(leftHex: string, right: Buffer): boolean {
  if (!/^[a-f0-9]{64}$/i.test(leftHex)) return false;
  const left = Buffer.from(leftHex, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

function publicDevice(device: StoredDeviceRecord): PublicDeviceRecord {
  return {
    id: device.id,
    name: device.name,
    createdAt: device.createdAt,
    lastSeenAt: device.lastSeenAt,
    ...(device.revokedAt ? { revokedAt: device.revokedAt } : {}),
    pushEnabled: Boolean(device.push && !device.revokedAt),
    ...(device.push ? { pushPlatform: device.push.platform } : {}),
  };
}

function safeDeviceName(value: unknown): string {
  const name = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 80);
  return name || "Mobile device";
}

/**
 * Persistent mobile device credentials plus in-memory, one-time pairing
 * sessions. Pairing claims intentionally do not survive a host restart.
 */
export class PairingStore {
  private readonly sessions = new Map<string, PairingSessionRecord>();
  private devices: StoredDeviceRecord[] = [];
  private readonly file: string;
  private readonly now: () => number;

  constructor(file = MOBILE_DEVICES_FILE, now: () => number = Date.now) {
    this.file = file;
    this.now = now;
    this.devices = loadPersistentJson<StoredDeviceRecord[]>(file, {
      label: "Paired mobile device credentials", missing: () => [], resetValue: { version: 1, devices: [] }, maxBytes: 4 * 1024 * 1024,
      validate: (value) => {
        const document = value && typeof value === "object" && !Array.isArray(value) ? value as { version?: unknown; devices?: unknown } : null;
        if (document?.version !== undefined && document.version !== 1) throw new Error("unsupported pairing store version");
        const rows = Array.isArray(value) ? value : document?.devices;
        if (!Array.isArray(rows) || rows.length > 1_000) throw new Error("invalid pairing store schema");
        for (const raw of rows) {
          const row = raw as Partial<StoredDeviceRecord>;
          if (!row || typeof row !== "object" || typeof row.id !== "string" || typeof row.name !== "string" || typeof row.tokenHash !== "string" || !/^[a-f0-9]{64}$/i.test(row.tokenHash) || !Number.isFinite(row.createdAt) || !Number.isFinite(row.lastSeenAt)) throw new Error("invalid pairing device schema");
          if (row.push !== undefined && (!row.push || !EXPO_PUSH_TOKEN.test(String(row.push.token ?? "")) || (row.push.platform !== "ios" && row.push.platform !== "android") || !Number.isFinite(row.push.updatedAt))) throw new Error("invalid pairing push schema");
        }
        return rows as StoredDeviceRecord[];
      },
    });
  }

  createSession(hostUrl: string, ttlMs = DEFAULT_PAIRING_TTL_MS): PairingSession {
    assertPersistenceWritable(this.file);
    if (!Number.isFinite(ttlMs) || ttlMs < 1_000 || ttlMs > 15 * 60_000) {
      throw Object.assign(new Error("pairing TTL must be between 1 second and 15 minutes"), { status: 400 });
    }
    const createdAt = this.now();
    this.pruneSessions(createdAt);
    const id = randomUUID();
    const secret = randomBytes(32).toString("base64url");
    const secretDigest = digest(secret);
    const expiresAt = createdAt + ttlMs;
    this.sessions.set(id, {
      id,
      secretHash: secretDigest.toString("hex"),
      createdAt,
      expiresAt,
    });
    const verificationCode = String(secretDigest.readUInt32BE(0) % 1_000_000).padStart(6, "0");
    const query = new URLSearchParams({ host: hostUrl, session: id, secret });
    return {
      id,
      secret,
      hostUrl,
      expiresAt,
      verificationCode,
      claimUrl: `${hostUrl}/api/pairing/claim`,
      pairingUri: `cumea://pair?${query.toString()}`,
    };
  }

  claim(sessionId: string, secret: string, deviceName: unknown): ClaimedDevice {
    assertPersistenceWritable(this.file);
    const session = this.sessions.get(sessionId);
    if (!session) throw Object.assign(new Error("no such pairing session"), { status: 404 });
    if (session.claimedAt !== undefined) {
      throw Object.assign(new Error("pairing session was already used"), { status: 409 });
    }
    if (this.now() > session.expiresAt) {
      throw Object.assign(new Error("pairing session expired"), { status: 410 });
    }
    if (!hashesMatch(session.secretHash, digest(secret))) {
      throw Object.assign(new Error("invalid pairing secret"), { status: 401 });
    }

    const token = `cumea_device_${randomBytes(32).toString("base64url")}`;
    const at = this.now();
    // Consume before the disk write. Even if persistence fails, this process
    // will never mint a second credential from the same QR secret.
    session.claimedAt = at;
    const device: StoredDeviceRecord = {
      id: randomUUID(),
      name: safeDeviceName(deviceName),
      tokenHash: digestHex(token),
      createdAt: at,
      lastSeenAt: at,
    };
    this.devices.push(device);
    this.save();
    return { token, device: publicDevice(device) };
  }

  authenticate(token: string): PublicDeviceRecord | null {
    if (!token.startsWith("cumea_device_")) return null;
    const tokenDigest = digest(token);
    const device = this.devices.find((candidate) => !candidate.revokedAt && hashesMatch(candidate.tokenHash, tokenDigest));
    if (!device) return null;
    const at = this.now();
    // Avoid an atomic disk write for every mobile poll while keeping useful
    // last-seen information for the local device manager.
    if (at - device.lastSeenAt >= 60_000) {
      device.lastSeenAt = at;
      this.save();
    }
    return publicDevice(device);
  }

  list(): PublicDeviceRecord[] {
    return this.devices.map(publicDevice);
  }

  isActive(deviceId: string): boolean {
    return this.devices.some((device) => device.id === deviceId && !device.revokedAt);
  }

  setPushRegistration(
    deviceId: string,
    registration: { token: string; platform: "ios" | "android" } | null,
  ): PublicDeviceRecord | null {
    const device = this.devices.find((candidate) => candidate.id === deviceId && !candidate.revokedAt);
    if (!device) return null;
    if (registration) {
      if (!EXPO_PUSH_TOKEN.test(registration.token)) {
        throw Object.assign(new Error("invalid Expo push token"), { status: 400 });
      }
      device.push = { ...registration, updatedAt: this.now() };
    } else {
      delete device.push;
    }
    this.save();
    return publicDevice(device);
  }

  pushTargets(): DevicePushTarget[] {
    return this.devices.flatMap((device) =>
      !device.revokedAt && device.push
        ? [{ deviceId: device.id, token: device.push.token, platform: device.push.platform }]
        : [],
    );
  }

  /** Active push capabilities are write-only outside the push adapter. */
  secretValues(): string[] {
    return this.pushTargets().map((target) => target.token);
  }

  clearPushToken(token: string): void {
    let changed = false;
    for (const device of this.devices) {
      if (device.push?.token !== token) continue;
      delete device.push;
      changed = true;
    }
    if (changed) this.save();
  }

  revoke(deviceId: string): PublicDeviceRecord | null {
    assertPersistenceWritable(this.file);
    const device = this.devices.find((candidate) => candidate.id === deviceId);
    if (!device) return null;
    if (!device.revokedAt) {
      device.revokedAt = this.now();
      this.save();
    }
    return publicDevice(device);
  }

  private save() {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    assertPersistenceWritable(this.file);
    writeFileAtomic(this.file, JSON.stringify({ version: 1, devices: this.devices }, null, 2), { mode: 0o600 });
  }

  private pruneSessions(at: number) {
    // Retain recently expired/used entries long enough to return a precise
    // expired/reused error instead of turning retries into an ambiguous 404.
    for (const [id, session] of this.sessions) {
      const terminalAt = session.claimedAt ?? session.expiresAt;
      if (at - terminalAt > 60 * 60_000) this.sessions.delete(id);
    }
  }
}
