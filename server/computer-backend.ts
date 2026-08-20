import { randomBytes } from "node:crypto";

export type ComputerBackendKind = "local-cua" | "box" | "docker" | "byo-vps" | "custom";

export type ComputerScope =
  | { kind: "private"; botId: string }
  | { kind: "shared"; projectId: string };

export interface ComputerCapabilities {
  shell: boolean;
  files: boolean;
  graphical: boolean;
  checkpoints: boolean;
}

export type ComputerAvailability =
  | { state: "ready" }
  | { state: "provisioning"; message?: string }
  | { state: "missing"; message: string }
  | { state: "transport-error"; message: string }
  | { state: "unavailable"; message: string };

export interface ComputerDescriptor {
  id: string;
  backend: ComputerBackendKind;
  scope: ComputerScope;
  capabilities: ComputerCapabilities;
  disposableFilesystem: boolean;
  availability: ComputerAvailability;
}

export interface ComputerExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ComputerCheckpoint {
  id: string;
  createdAt: number;
  portable: boolean;
}

export interface ComputerBackend {
  readonly kind: ComputerBackendKind;
  describe(computerId: string): Promise<ComputerDescriptor>;
  ensure(computerId: string, scope: ComputerScope): Promise<ComputerDescriptor>;
  exec?(computerId: string, command: string[], options?: { cwd?: string; timeoutMs?: number }): Promise<ComputerExecResult>;
  readFile?(computerId: string, relativePath: string, maxBytes: number): Promise<Uint8Array>;
  writeFile?(computerId: string, relativePath: string, bytes: Uint8Array): Promise<void>;
  screenshot?(computerId: string): Promise<{ mime: "image/png" | "image/jpeg"; bytes: Uint8Array }>;
  createCheckpoint?(computerId: string): Promise<ComputerCheckpoint>;
  restoreCheckpoint?(computerId: string, checkpointId: string): Promise<void>;
  dispose?(computerId: string): Promise<void>;
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const BACKEND_KINDS = new Set<ComputerBackendKind>(["local-cua", "box", "docker", "byo-vps", "custom"]);
const MIN_LEASE_MS = 1_000;
const MAX_LEASE_MS = 30 * 60_000;

function invalid(message: string): Error {
  return Object.assign(new Error(message), { status: 400 });
}

function conflict(message: string): Error {
  return Object.assign(new Error(message), { status: 409 });
}

function misconfigured(message: string): Error {
  return Object.assign(new Error(message), { status: 500 });
}

export function validateComputerId(value: string, label = "computer id"): string {
  if (!SAFE_ID.test(value)) throw invalid(`${label} is invalid`);
  return value;
}

export function validateComputerBackendKind(value: unknown): ComputerBackendKind {
  if (typeof value !== "string" || !BACKEND_KINDS.has(value as ComputerBackendKind)) {
    throw invalid("computer backend is invalid");
  }
  return value as ComputerBackendKind;
}

export function validateComputerScope(scope: ComputerScope): ComputerScope {
  if (!scope || typeof scope !== "object") throw invalid("computer scope is invalid");
  if (scope.kind === "private") return { kind: "private", botId: validateComputerId(scope.botId, "bot id") };
  if (scope.kind === "shared") return { kind: "shared", projectId: validateComputerId(scope.projectId, "project id") };
  throw invalid("computer scope is invalid");
}

export function boundedTransportMessage(value: unknown): string {
  const text = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return text.slice(0, 240) || "computer transport failed";
}

export function publicComputerDescriptor(descriptor: ComputerDescriptor): ComputerDescriptor {
  return {
    id: validateComputerId(descriptor.id),
    backend: validateComputerBackendKind(descriptor.backend),
    scope: validateComputerScope(descriptor.scope),
    capabilities: {
      shell: descriptor.capabilities.shell === true,
      files: descriptor.capabilities.files === true,
      graphical: descriptor.capabilities.graphical === true,
      checkpoints: descriptor.capabilities.checkpoints === true,
    },
    disposableFilesystem: descriptor.disposableFilesystem === true,
    availability:
      descriptor.availability.state === "ready"
        ? { state: "ready" }
        : descriptor.availability.state === "provisioning"
          ? {
              state: "provisioning",
              ...(descriptor.availability.message
                ? { message: boundedTransportMessage(descriptor.availability.message) }
                : {}),
            }
          : {
              state: descriptor.availability.state,
              message: boundedTransportMessage(descriptor.availability.message),
            },
  };
}

/**
 * Proves that a public capability bit is backed by the minimum primitive the
 * provider-neutral contract promises. Adapters may implement a primitive and
 * still advertise the capability as false for an unavailable instance, but
 * they may never advertise a capability whose implementation is absent.
 */
export function validateComputerBackendConformance(
  backend: ComputerBackend,
  descriptor: ComputerDescriptor,
): ComputerDescriptor {
  const projected = publicComputerDescriptor(descriptor);
  const backendKind = validateComputerBackendKind(backend.kind);
  if (projected.backend !== backendKind) {
    throw misconfigured(`computer backend kind mismatch: descriptor=${projected.backend} adapter=${backendKind}`);
  }
  if (projected.capabilities.shell && typeof backend.exec !== "function") {
    throw misconfigured("computer backend advertises shell without exec");
  }
  if (
    projected.capabilities.files
    && (typeof backend.readFile !== "function" || typeof backend.writeFile !== "function")
  ) {
    throw misconfigured("computer backend advertises files without readFile/writeFile");
  }
  if (projected.capabilities.graphical && typeof backend.screenshot !== "function") {
    throw misconfigured("computer backend advertises graphical without screenshot");
  }
  if (
    projected.capabilities.checkpoints
    && (typeof backend.createCheckpoint !== "function" || typeof backend.restoreCheckpoint !== "function")
  ) {
    throw misconfigured("computer backend advertises checkpoints without createCheckpoint/restoreCheckpoint");
  }
  return projected;
}

export interface GraphicalLease {
  leaseId: string;
  computerId: string;
  runId: string;
  botId: string;
  generation: number;
  issuedAt: number;
  expiresAt: number;
}

interface LeaseRecord extends GraphicalLease {}

/**
 * Process-local fencing for one graphical session. Shell/files are intentionally
 * separate backend capabilities: sharing a project folder must never imply that
 * two runs can drive the same display concurrently.
 */
export class ComputerLeaseFence {
  private active = new Map<string, LeaseRecord>();
  private generations = new Map<string, number>();
  private now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  private duration(ttlMs: number): number {
    if (!Number.isInteger(ttlMs) || ttlMs < MIN_LEASE_MS || ttlMs > MAX_LEASE_MS) {
      throw invalid(`lease ttl must be between ${MIN_LEASE_MS} and ${MAX_LEASE_MS} ms`);
    }
    return ttlMs;
  }

  private current(computerId: string): LeaseRecord | null {
    const id = validateComputerId(computerId);
    const lease = this.active.get(id);
    if (!lease) return null;
    if (lease.expiresAt <= this.now()) {
      this.active.delete(id);
      return null;
    }
    return lease;
  }

  peek(computerId: string): GraphicalLease | null {
    const lease = this.current(computerId);
    return lease ? { ...lease } : null;
  }

  acquire(input: { computerId: string; runId: string; botId: string; ttlMs: number }): GraphicalLease {
    const computerId = validateComputerId(input.computerId);
    const runId = validateComputerId(input.runId, "run id");
    const botId = validateComputerId(input.botId, "bot id");
    const ttlMs = this.duration(input.ttlMs);
    const existing = this.current(computerId);
    if (existing) throw conflict(`computer display is leased by run ${existing.runId}`);

    const generation = (this.generations.get(computerId) ?? 0) + 1;
    this.generations.set(computerId, generation);
    const issuedAt = this.now();
    const lease: LeaseRecord = {
      leaseId: randomBytes(24).toString("base64url"),
      computerId,
      runId,
      botId,
      generation,
      issuedAt,
      expiresAt: issuedAt + ttlMs,
    };
    this.active.set(computerId, lease);
    return { ...lease };
  }

  assert(lease: Pick<GraphicalLease, "computerId" | "leaseId" | "generation">): GraphicalLease {
    const current = this.current(lease.computerId);
    if (!current || current.leaseId !== lease.leaseId || current.generation !== lease.generation) {
      throw conflict("computer display lease is stale");
    }
    return { ...current };
  }

  renew(lease: Pick<GraphicalLease, "computerId" | "leaseId" | "generation">, ttlMs: number): GraphicalLease {
    const current = this.assert(lease);
    const duration = this.duration(ttlMs);
    const updated: LeaseRecord = { ...current, expiresAt: this.now() + duration };
    this.active.set(current.computerId, updated);
    return { ...updated };
  }

  release(lease: Pick<GraphicalLease, "computerId" | "leaseId" | "generation">): boolean {
    const current = this.current(lease.computerId);
    if (!current || current.leaseId !== lease.leaseId || current.generation !== lease.generation) return false;
    this.active.delete(current.computerId);
    return true;
  }

  takeover(
    input: { computerId: string; runId: string; botId: string; ttlMs: number },
    previous?: Pick<GraphicalLease, "leaseId" | "generation">,
  ): GraphicalLease {
    const computerId = validateComputerId(input.computerId);
    const current = this.current(computerId);
    if (current && previous && (current.leaseId !== previous.leaseId || current.generation !== previous.generation)) {
      throw conflict("computer display lease changed before takeover");
    }
    if (current && !previous) throw conflict("takeover requires the current lease fence");
    if (current) this.active.delete(computerId);
    return this.acquire(input);
  }
}
