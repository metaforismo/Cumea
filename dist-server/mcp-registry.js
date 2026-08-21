import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeFileAtomic } from "./atomic.js";
import { DATA_DIR } from "./config.js";
import { assertPersistenceWritable, loadPersistentJson } from "./persistence-health.js";
export const MCP_SERVERS_FILE = join(DATA_DIR, "mcp-servers.json");
function httpError(message) {
    return Object.assign(new Error(message), { status: 400 });
}
function record(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw httpError("MCP server must be an object");
    return value;
}
function text(value, field, max) {
    if (typeof value !== "string")
        throw httpError(`${field} must be a string`);
    const normalized = value.trim();
    if (!normalized || normalized.length > max || /[\u0000-\u001f\u007f]/.test(normalized)) {
        throw httpError(`invalid ${field}`);
    }
    return normalized;
}
function decodeArgs(value) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value) || value.length > 64)
        throw httpError("args must contain at most 64 strings");
    return value.map((item, index) => {
        if (typeof item !== "string" || item.length > 2_048 || /[\u0000\r\n]/.test(item)) {
            throw httpError(`invalid args[${index}]`);
        }
        return item;
    });
}
function decodeEnvironment(value) {
    if (value === undefined)
        return {};
    const input = record(value);
    if (Object.keys(input).length > 64)
        throw httpError("environment has too many entries");
    const result = {};
    for (const [name, raw] of Object.entries(input)) {
        if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name) || typeof raw !== "string" || raw.length > 4_096 || /\u0000/.test(raw)) {
            throw httpError(`invalid environment entry ${name}`);
        }
        result[name] = raw;
    }
    return result;
}
function publicServer(server) {
    return {
        id: server.id,
        name: server.name,
        command: server.command,
        args: [...server.args],
        environmentKeys: Object.keys(server.environment).sort(),
        enabled: server.enabled,
        createdAt: server.createdAt,
        updatedAt: server.updatedAt,
    };
}
function validStored(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return false;
    const row = value;
    return typeof row.id === "string" && /^mcp-[a-f0-9]{20}$/.test(row.id) &&
        typeof row.name === "string" && typeof row.command === "string" && Array.isArray(row.args) &&
        row.environment !== null && typeof row.environment === "object" && !Array.isArray(row.environment) &&
        typeof row.enabled === "boolean" && Number.isFinite(row.createdAt) && Number.isFinite(row.updatedAt);
}
export class McpRegistry {
    servers = [];
    file;
    now;
    constructor(file = MCP_SERVERS_FILE, now = Date.now) {
        this.file = file;
        this.now = now;
        this.servers = loadPersistentJson(file, {
            label: "MCP server registry", missing: () => [], resetValue: { version: 1, servers: [] }, maxBytes: 4 * 1024 * 1024,
            validate: (value) => {
                const document = value && typeof value === "object" && !Array.isArray(value) ? value : null;
                if (document && document.version !== 1)
                    throw new Error("unsupported MCP registry version");
                const rows = Array.isArray(value) ? value : document?.servers;
                if (!Array.isArray(rows) || rows.length > 1_000 || rows.some((row) => !validStored(row)))
                    throw new Error("invalid MCP registry schema");
                return rows;
            },
        });
    }
    list() {
        return this.servers.map(publicServer);
    }
    has(id) {
        return this.servers.some((server) => server.id === id);
    }
    create(raw) {
        assertPersistenceWritable(this.file);
        const value = record(raw);
        const at = this.now();
        const server = {
            id: `mcp-${randomBytes(10).toString("hex")}`,
            name: text(value.name, "name", 80),
            command: text(value.command, "command", 1_024),
            args: decodeArgs(value.args),
            environment: decodeEnvironment(value.environment),
            enabled: value.enabled !== false,
            createdAt: at,
            updatedAt: at,
        };
        this.servers.push(server);
        this.save();
        return publicServer(server);
    }
    update(id, raw) {
        assertPersistenceWritable(this.file);
        const server = this.servers.find((candidate) => candidate.id === id);
        if (!server)
            return null;
        const value = record(raw);
        if (value.name !== undefined)
            server.name = text(value.name, "name", 80);
        if (value.command !== undefined)
            server.command = text(value.command, "command", 1_024);
        if (value.args !== undefined)
            server.args = decodeArgs(value.args);
        // Omitted means preserve: public GET never returns values, so opening and
        // saving the editor cannot accidentally erase write-only secrets.
        if (value.environment !== undefined)
            server.environment = decodeEnvironment(value.environment);
        if (value.enabled !== undefined) {
            if (typeof value.enabled !== "boolean")
                throw httpError("enabled must be a boolean");
            server.enabled = value.enabled;
        }
        server.updatedAt = this.now();
        this.save();
        return publicServer(server);
    }
    delete(id) {
        assertPersistenceWritable(this.file);
        const before = this.servers.length;
        this.servers = this.servers.filter((server) => server.id !== id);
        if (this.servers.length === before)
            return false;
        this.save();
        return true;
    }
    resolve(ids) {
        const selected = new Set(ids);
        return this.servers.flatMap((server) => selected.has(server.id) && server.enabled ? [{
                name: `local_${server.id.slice(4)}`,
                command: server.command,
                args: [...server.args],
                env: { ...server.environment },
            }] : []);
    }
    /** Write-only credential inventory for the central egress guard. */
    secretValues() {
        return this.servers.flatMap((server) => Object.values(server.environment));
    }
    save() {
        mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
        assertPersistenceWritable(this.file);
        writeFileAtomic(this.file, JSON.stringify({ version: 1, servers: this.servers }, null, 2), { mode: 0o600 });
    }
}
