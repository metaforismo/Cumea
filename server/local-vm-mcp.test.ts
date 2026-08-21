import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { LOCAL_VM_CONTAINER, LOCAL_VM_CUA_EXECUTABLE, LOCAL_VM_SOCKET } from "./local-vm.ts";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe.skipIf(process.platform === "win32")("Local VM MCP bridge", () => {
  it("passes MCP bytes unchanged to Cua Driver inside the runtime", async () => {
    const bin = await mkdtemp(join(tmpdir(), "cumea-local-vm-mcp-"));
    temporary.push(bin);
    const fakeDocker = join(bin, "docker");
    await writeFile(fakeDocker, "#!/bin/sh\nprintf 'ARGS:%s\\n' \"$*\" >&2\ncat\n", { mode: 0o700 });
    await chmod(fakeDocker, 0o700);

    const input = '{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n';
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [
        fileURLToPath(new URL("./local-vm-mcp.ts", import.meta.url)),
        "docker", LOCAL_VM_CONTAINER, LOCAL_VM_SOCKET,
      ], {
        env: { ...process.env, CUMEA_EXTRA_PATH: [bin, process.env.CUMEA_EXTRA_PATH ?? ""].filter(Boolean).join(delimiter), NODE_NO_WARNINGS: "1" },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
      child.stdin.end(input);
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe(input);
    expect(result.stderr).toContain(
      `ARGS:exec -i -u cua -e HOME=/home/cua -e DISPLAY=:1 -e CUA_DRIVER_INSTALL_CHANNEL=python_package ${LOCAL_VM_CONTAINER} ` +
      `${LOCAL_VM_CUA_EXECUTABLE} mcp --socket ${LOCAL_VM_SOCKET}`,
    );
  });
});
