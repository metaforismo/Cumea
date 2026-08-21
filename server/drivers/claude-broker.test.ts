import { connect } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { brokerSocketPath } from "../procs.ts";
import { createPermissionBroker } from "./claude.ts";

const scratch: string[] = [];

afterEach(() => {
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function sendLines(path: string, lines: unknown[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = connect(path);
    client.once("error", reject);
    client.once("close", resolve);
    client.once("connect", () => {
      for (const line of lines) client.write(`${JSON.stringify(line)}\n`);
      setTimeout(() => client.end(), 20);
    });
  });
}

describe("Claude permission broker authentication", () => {
  it("drops unauthenticated asks and accepts the same ask after the per-turn secret", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cpb-"));
    scratch.push(directory);
    const path = brokerSocketPath(directory, randomBytes(4).toString("hex"));
    const asks: string[] = [];
    const broker = createPermissionBroker({
      socketPath: path,
      secret: "test-secret-that-never-leaves-the-child-env",
      onAsk: (ask) => asks.push(ask.id),
      onResolve: () => {},
      timeoutMs: 1_000,
    });
    await broker.ready;

    await sendLines(path, [{ t: "ask", id: "forged", tool: "shell", input: {} }]);
    expect(asks).toEqual([]);

    await sendLines(path, [
      { t: "auth", secret: "test-secret-that-never-leaves-the-child-env" },
      { t: "ask", id: "accepted", tool: "shell", input: { command: "pwd" } },
    ]);
    expect(asks).toEqual(["accepted"]);
    expect(broker.answer("accepted", "allow")).toBe(true);
    broker.close();
  });
});
