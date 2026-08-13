import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeFileAtomic } from "./atomic.js";
import { DATA_DIR } from "./config.js";
export const MOBILE_DEVICES_FILE = join(DATA_DIR, "mobile-devices.json");
export const DEFAULT_PAIRING_TTL_MS = 5 * 60_000;
function digest(value) {
    return createHash("sha256").update(value, "utf8").digest();
}
function digestHex(value) {
    return digest(value).toString("hex");
}
function hashesMatch(leftHex, right) {
    if (!/^[a-f0-9]{64}$/i.test(leftHex))
        return false;
    const left = Buffer.from(leftHex, "hex");
    return left.length === right.length && timingSafeEqual(left, right);
}
function publicDevice(device) {
    return {
        id: device.id,
        name: device.name,
        createdAt: device.createdAt,
        lastSeenAt: device.lastSeenAt,
        ...(device.revokedAt ? { revokedAt: device.revokedAt } : {}),
    };
}
function safeDeviceName(value) {
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
    sessions = new Map();
    devices = [];
    file;
    now;
    constructor(file = MOBILE_DEVICES_FILE, now = Date.now) {
        this.file = file;
        this.now = now;
        try {
            const parsed = JSON.parse(readFileSync(file, "utf8"));
            const rows = Array.isArray(parsed) ? parsed : parsed?.devices;
            if (Array.isArray(rows)) {
                this.devices = rows.filter((row) => row &&
                    typeof row.id === "string" &&
                    typeof row.name === "string" &&
                    typeof row.tokenHash === "string" &&
                    /^[a-f0-9]{64}$/i.test(row.tokenHash) &&
                    Number.isFinite(row.createdAt) &&
                    Number.isFinite(row.lastSeenAt));
            }
        }
        catch {
            this.devices = [];
        }
    }
    createSession(hostUrl, ttlMs = DEFAULT_PAIRING_TTL_MS) {
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
    claim(sessionId, secret, deviceName) {
        const session = this.sessions.get(sessionId);
        if (!session)
            throw Object.assign(new Error("no such pairing session"), { status: 404 });
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
        const device = {
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
    authenticate(token) {
        if (!token.startsWith("cumea_device_"))
            return null;
        const tokenDigest = digest(token);
        const device = this.devices.find((candidate) => !candidate.revokedAt && hashesMatch(candidate.tokenHash, tokenDigest));
        if (!device)
            return null;
        const at = this.now();
        // Avoid an atomic disk write for every mobile poll while keeping useful
        // last-seen information for the local device manager.
        if (at - device.lastSeenAt >= 60_000) {
            device.lastSeenAt = at;
            this.save();
        }
        return publicDevice(device);
    }
    list() {
        return this.devices.map(publicDevice);
    }
    isActive(deviceId) {
        return this.devices.some((device) => device.id === deviceId && !device.revokedAt);
    }
    revoke(deviceId) {
        const device = this.devices.find((candidate) => candidate.id === deviceId);
        if (!device)
            return null;
        if (!device.revokedAt) {
            device.revokedAt = this.now();
            this.save();
        }
        return publicDevice(device);
    }
    save() {
        mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
        writeFileAtomic(this.file, JSON.stringify({ version: 1, devices: this.devices }, null, 2), { mode: 0o600 });
    }
    pruneSessions(at) {
        // Retain recently expired/used entries long enough to return a precise
        // expired/reused error instead of turning retries into an ambiguous 404.
        for (const [id, session] of this.sessions) {
            const terminalAt = session.claimedAt ?? session.expiresAt;
            if (at - terminalAt > 60 * 60_000)
                this.sessions.delete(id);
        }
    }
}
