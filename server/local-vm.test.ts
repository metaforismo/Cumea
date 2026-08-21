import { describe, expect, it } from "vitest";

import {
  LOCAL_VM_BASE_DIGEST,
  LOCAL_VM_BASE_IMAGE,
  LOCAL_VM_CONTAINER,
  LOCAL_VM_CUA_VERSION,
  LOCAL_VM_IMAGE,
  LOCAL_VM_MANAGED_LABEL,
  localVmDockerfile,
  localVmRunArgs,
  localVmStatus,
  type LocalVmCommandRunner,
} from "./local-vm.ts";

describe("Local VM", () => {
  it("builds from pinned inputs and verifies the exact Cua wheel", () => {
    const dockerfile = localVmDockerfile();
    expect(dockerfile).toContain(`FROM ${LOCAL_VM_BASE_IMAGE}`);
    expect(dockerfile).toContain("sha256sum -c -");
    expect(dockerfile).toContain(`cua-driver ${LOCAL_VM_CUA_VERSION}`);
    expect(dockerfile).toContain(`${LOCAL_VM_BASE_DIGEST}`);
  });

  it("binds the viewer to loopback and applies bounded resources/capabilities", () => {
    const args = localVmRunArgs("docker", "secret");
    expect(args).toContain("127.0.0.1:6080:6901");
    expect(args).toEqual(expect.arrayContaining([
      "--memory", "4g", "--memory-swap", "4g", "--cpus", "2", "--pids-limit", "512",
      "--cap-drop", "ALL", "--cap-add", "SETUID", "--cap-add", "SETGID",
      "--label", `${LOCAL_VM_MANAGED_LABEL}=1`,
    ]));
    expect(args.at(-1)).toBe(LOCAL_VM_IMAGE);
  });

  it("refuses a managed-looking container whose viewer is publicly bound", async () => {
    const runner: LocalVmCommandRunner = async (command, args) => {
      if (command === "/usr/bin/which") {
        if (args[0] === "docker") return { stdout: "/usr/bin/docker\n" };
        throw new Error("not found");
      }
      if (command === "docker" && args[0] === "info") return { stdout: "26" };
      if (command === "docker" && args[0] === "image") return { stdout: JSON.stringify([{ Config: { Labels: {
        [LOCAL_VM_MANAGED_LABEL]: "1",
        "io.github.metaforismo.cumea.cua-driver": LOCAL_VM_CUA_VERSION,
        "io.github.metaforismo.cumea.cua-base": LOCAL_VM_BASE_DIGEST,
      } } }]) };
      if (command === "docker" && args[0] === "inspect") return { stdout: JSON.stringify([{
        Config: {
          Image: LOCAL_VM_IMAGE,
          Labels: {
            [LOCAL_VM_MANAGED_LABEL]: "1",
            "io.github.metaforismo.cumea.cua-driver": LOCAL_VM_CUA_VERSION,
            "io.github.metaforismo.cumea.cua-base": LOCAL_VM_BASE_DIGEST,
          },
          Env: ["VNC_PW=test"],
        },
        HostConfig: {
          PortBindings: { "6901/tcp": [{ HostIp: "0.0.0.0" }] },
          Memory: 4 * 1024 ** 3,
          MemorySwap: 4 * 1024 ** 3,
          NanoCpus: 2_000_000_000,
          PidsLimit: 512,
          CapDrop: ["ALL"],
          CapAdd: ["SETUID", "SETGID"],
        },
        State: { Running: true },
      }]) };
      throw new Error(`unexpected ${command} ${args.join(" ")}`);
    };

    const status = await localVmStatus(runner, "linux");
    expect(status).toMatchObject({
      runtime: "docker",
      container: "running",
      network: "unsafe",
      security: "hardened",
      ready: false,
    });
    expect(status.problem).toMatch(/exposed beyond loopback/);
    expect(status.containerName).toBe(LOCAL_VM_CONTAINER);
  });
});
