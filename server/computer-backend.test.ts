import { describe, expect, it } from "vitest";

import {
  ComputerLeaseFence,
  boundedTransportMessage,
  publicComputerDescriptor,
  validateComputerBackendConformance,
  validateComputerScope,
  type ComputerBackend,
  type ComputerDescriptor,
} from "./computer-backend.ts";

function descriptor(overrides: Partial<ComputerDescriptor> = {}): ComputerDescriptor {
  return {
    id: "computer-1",
    backend: "local-cua",
    scope: { kind: "private", botId: "bot-1" },
    capabilities: { shell: true, files: true, graphical: true, checkpoints: false },
    disposableFilesystem: false,
    availability: { state: "ready" },
    ...overrides,
  };
}

function backend(overrides: Partial<ComputerBackend> = {}): ComputerBackend {
  const base: ComputerBackend = {
    kind: "local-cua",
    describe: async () => descriptor(),
    ensure: async () => descriptor(),
    exec: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    readFile: async () => new Uint8Array(),
    writeFile: async () => {},
    screenshot: async () => ({ mime: "image/png", bytes: new Uint8Array() }),
  };
  return { ...base, ...overrides };
}

describe("computer backend public contract", () => {
  it("keeps private and shared scopes explicit", () => {
    expect(validateComputerScope({ kind: "private", botId: "researcher" })).toEqual({ kind: "private", botId: "researcher" });
    expect(validateComputerScope({ kind: "shared", projectId: "launch-room" })).toEqual({ kind: "shared", projectId: "launch-room" });
    expect(() => validateComputerScope({ kind: "private", botId: "../escape" })).toThrow(/bot id is invalid/);
  });

  it("projects capability and transport state without backend-private payloads", () => {
    const projected = publicComputerDescriptor(descriptor({
      backend: "byo-vps",
      scope: { kind: "shared", projectId: "alpha" },
      availability: { state: "transport-error", message: "ssh failed\nsecret-looking tail" },
      disposableFilesystem: true,
    }));
    expect(projected).toEqual({
      id: "computer-1",
      backend: "byo-vps",
      scope: { kind: "shared", projectId: "alpha" },
      capabilities: { shell: true, files: true, graphical: true, checkpoints: false },
      disposableFilesystem: true,
      availability: { state: "transport-error", message: "ssh failed secret-looking tail" },
    });
    expect(JSON.stringify(projected)).not.toContain("token");
    expect(JSON.stringify(projected)).not.toContain("sshAlias");
  });

  it("bounds user-visible transport failures", () => {
    expect(boundedTransportMessage("\n\tconnection refused\u0000")).toBe("connection refused");
    expect(boundedTransportMessage("x".repeat(500))).toHaveLength(240);
  });

  it("accepts advertised capabilities only when the adapter implements their primitives", () => {
    expect(validateComputerBackendConformance(backend(), descriptor())).toEqual(descriptor());
    expect(validateComputerBackendConformance(
      backend({
        createCheckpoint: async () => ({ id: "checkpoint-1", createdAt: 1, portable: false }),
        restoreCheckpoint: async () => {},
      }),
      descriptor({ capabilities: { shell: true, files: true, graphical: true, checkpoints: true } }),
    ).capabilities.checkpoints).toBe(true);
  });

  it("fails closed when an adapter advertises a primitive it does not implement", () => {
    expect(() => validateComputerBackendConformance(
      backend({ exec: undefined }),
      descriptor({ capabilities: { shell: true, files: false, graphical: false, checkpoints: false } }),
    )).toThrow(/shell without exec/);
    expect(() => validateComputerBackendConformance(
      backend({ writeFile: undefined }),
      descriptor({ capabilities: { shell: false, files: true, graphical: false, checkpoints: false } }),
    )).toThrow(/files without readFile\/writeFile/);
    expect(() => validateComputerBackendConformance(
      backend({ screenshot: undefined }),
      descriptor({ capabilities: { shell: false, files: false, graphical: true, checkpoints: false } }),
    )).toThrow(/graphical without screenshot/);
    expect(() => validateComputerBackendConformance(
      backend({ createCheckpoint: async () => ({ id: "checkpoint-1", createdAt: 1, portable: false }) }),
      descriptor({ capabilities: { shell: false, files: false, graphical: false, checkpoints: true } }),
    )).toThrow(/checkpoints without createCheckpoint\/restoreCheckpoint/);
  });

  it("allows implemented primitives to remain unadvertised and rejects backend-kind drift", () => {
    const quiet = descriptor({ capabilities: { shell: false, files: false, graphical: false, checkpoints: false } });
    expect(validateComputerBackendConformance(backend(), quiet).capabilities).toEqual(quiet.capabilities);
    expect(() => validateComputerBackendConformance(
      backend({ kind: "box" }),
      descriptor({ backend: "local-cua" }),
    )).toThrow(/backend kind mismatch/);
  });
});

describe("ComputerLeaseFence", () => {
  it("fences one graphical session while leaving shell/files as separate capabilities", () => {
    let now = 1_000;
    const fence = new ComputerLeaseFence(() => now);
    const first = fence.acquire({ computerId: "shared-1", runId: "run-a", botId: "bot-a", ttlMs: 5_000 });
    expect(fence.peek("shared-1")).toMatchObject({ runId: "run-a", generation: 1 });
    expect(() => fence.acquire({ computerId: "shared-1", runId: "run-b", botId: "bot-b", ttlMs: 5_000 })).toThrow(/leased by run run-a/);

    now = first.expiresAt;
    const second = fence.acquire({ computerId: "shared-1", runId: "run-b", botId: "bot-b", ttlMs: 5_000 });
    expect(second.generation).toBe(2);
    expect(second.leaseId).not.toBe(first.leaseId);
  });

  it("rejects stale assertions and stale releases after a takeover", () => {
    const fence = new ComputerLeaseFence(() => 10_000);
    const first = fence.acquire({ computerId: "private-1", runId: "run-1", botId: "bot-1", ttlMs: 4_000 });
    const second = fence.takeover(
      { computerId: "private-1", runId: "run-2", botId: "bot-2", ttlMs: 4_000 },
      { leaseId: first.leaseId, generation: first.generation },
    );

    expect(second.generation).toBe(2);
    expect(() => fence.assert(first)).toThrow(/stale/);
    expect(fence.release(first)).toBe(false);
    expect(fence.assert(second)).toMatchObject({ runId: "run-2" });
    expect(fence.release(second)).toBe(true);
    expect(fence.peek("private-1")).toBeNull();
  });

  it("requires the exact current fence for takeover", () => {
    const fence = new ComputerLeaseFence(() => 20_000);
    const active = fence.acquire({ computerId: "computer-x", runId: "run-1", botId: "bot-1", ttlMs: 4_000 });
    expect(() => fence.takeover({ computerId: "computer-x", runId: "run-2", botId: "bot-2", ttlMs: 4_000 })).toThrow(/requires the current lease fence/);
    expect(() => fence.takeover(
      { computerId: "computer-x", runId: "run-2", botId: "bot-2", ttlMs: 4_000 },
      { leaseId: active.leaseId, generation: active.generation + 1 },
    )).toThrow(/changed before takeover/);
  });

  it("renews only an exact live lease and never resurrects an expired generation", () => {
    let now = 30_000;
    const fence = new ComputerLeaseFence(() => now);
    const lease = fence.acquire({ computerId: "computer-y", runId: "run-y", botId: "bot-y", ttlMs: 2_000 });
    now += 500;
    const renewed = fence.renew(lease, 3_000);
    expect(renewed.expiresAt).toBe(now + 3_000);

    now = renewed.expiresAt;
    expect(() => fence.renew(renewed, 3_000)).toThrow(/stale/);
    const next = fence.acquire({ computerId: "computer-y", runId: "run-next", botId: "bot-y", ttlMs: 3_000 });
    expect(next.generation).toBe(2);
  });

  it("bounds lease duration and identifiers", () => {
    const fence = new ComputerLeaseFence(() => 40_000);
    expect(() => fence.acquire({ computerId: "bad/id", runId: "run-1", botId: "bot-1", ttlMs: 2_000 })).toThrow(/computer id is invalid/);
    expect(() => fence.acquire({ computerId: "computer-z", runId: "run-1", botId: "bot-1", ttlMs: 999 })).toThrow(/lease ttl/);
    expect(() => fence.acquire({ computerId: "computer-z", runId: "run-1", botId: "bot-1", ttlMs: 31 * 60_000 })).toThrow(/lease ttl/);
  });
});
