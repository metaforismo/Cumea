import type { ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UnsafeWindowsCliError } from "./env-path.ts";
import { brokerSocketPath, killCliTree, resolveCli } from "./procs.ts";

const NPM_PREAMBLE = `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0
`;

describe("cross-platform process contracts", () => {
  const temporaryDirectories: string[] = [];
  const fixtureDirectory = (): string => {
    const directory = mkdtempSync(join(tmpdir(), "cumea-win-cli-"));
    temporaryDirectories.push(directory);
    return directory;
  };

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("leaves command and argv unchanged off Windows", () => {
    const args = ["--value", "a b", "x&y|z"];
    expect(resolveCli("/opt/codex", args, { platform: "darwin" })).toEqual({
      command: "/opt/codex",
      args,
    });
  });

  it("resolves a native executable with PATHEXT ordering", () => {
    const directory = fixtureDirectory();
    writeFileSync(join(directory, "provider.COM"), "native");
    writeFileSync(join(directory, "provider.EXE"), "native");

    expect(resolveCli("provider", ["--version"], {
      platform: "win32",
      pathEntries: [directory],
      pathExt: [".EXE", ".COM"],
    })).toEqual({ command: join(directory, "provider.EXE"), args: ["--version"] });
  });

  it("parses an npm executable shim and preserves metacharacters as opaque argv", () => {
    const directory = fixtureDirectory();
    const targetDirectory = join(directory, "node_modules", "provider", "bin");
    mkdirSync(targetDirectory, { recursive: true });
    const executable = join(targetDirectory, "provider.exe");
    writeFileSync(executable, "native");
    writeFileSync(
      join(directory, "provider.cmd"),
      `${NPM_PREAMBLE}"%dp0%\\node_modules\\provider\\bin\\provider.exe"   %*\n`,
    );
    const args = ["--mcp-config", '{"path":"C:\\\\Program Files","raw":"%PATH% & | ^ < >"}'];

    expect(resolveCli("provider", args, {
      platform: "win32",
      pathEntries: [directory],
      pathExt: [".cmd", ".exe"],
    })).toEqual({ command: executable, args });
  });

  it("parses an npm node shim without treating its adjacent node.exe as a script target", () => {
    const directory = fixtureDirectory();
    const targetDirectory = join(directory, "node_modules", "provider", "bin");
    mkdirSync(targetDirectory, { recursive: true });
    const script = join(targetDirectory, "cli.js");
    writeFileSync(script, "console.log('ok')\n");
    writeFileSync(join(directory, "node.exe"), "native");
    writeFileSync(
      join(directory, "provider.cmd"),
      `${NPM_PREAMBLE}
IF EXIST "%dp0%\\node.exe" (
  SET "_prog=%dp0%\\node.exe"
) ELSE (
  SET "_prog=node"
)
endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%" "%dp0%\\node_modules\\provider\\bin\\cli.js" %*
`,
    );

    expect(resolveCli("provider", ["a b", "x&y"], {
      platform: "win32",
      pathEntries: [directory],
      pathExt: [".cmd"],
    })).toEqual({
      command: join(directory, "node.exe"),
      args: [script, "a b", "x&y"],
    });
  });

  it("accepts the legacy npm shim only when both node branches agree on one script", () => {
    const directory = fixtureDirectory();
    const targetDirectory = join(directory, "node_modules", "provider", "bin");
    mkdirSync(targetDirectory, { recursive: true });
    const script = join(targetDirectory, "cli.js");
    writeFileSync(script, "console.log('ok')\n");
    const node = join(directory, "node.exe");
    writeFileSync(node, "native");
    writeFileSync(join(directory, "provider.cmd"), `@IF EXIST "%~dp0\\node.exe" (
  "%~dp0\\node.exe" "%~dp0\\node_modules\\provider\\bin\\cli.js" %*
) ELSE (
  @SETLOCAL
  @SET PATHEXT=%PATHEXT:;.JS;=;%
  node "%~dp0\\node_modules\\provider\\bin\\cli.js" %*
)
`);

    expect(resolveCli("provider", ["a b"], {
      platform: "win32",
      pathEntries: [directory],
      pathExt: [".cmd"],
    })).toEqual({ command: node, args: [script, "a b"] });
  });

  it("runs a recognized node shebang through an explicitly resolved Node path", () => {
    const directory = fixtureDirectory();
    const script = join(directory, "provider tool");
    const node = join(directory, "Node With Spaces", "node.exe");
    writeFileSync(script, "#!/usr/bin/env node\nconsole.log('ok')\n");

    expect(resolveCli(script, ["--flag", "a b"], {
      platform: "win32",
      nodeExecutable: node,
    })).toEqual({ command: node, args: [script, "--flag", "a b"] });
  });

  it("rejects malformed, ambiguous, traversing, and batch shims", () => {
    const directory = fixtureDirectory();
    const malformed = join(directory, "malformed.cmd");
    const ambiguous = join(directory, "ambiguous.cmd");
    const traversing = join(directory, "traversing.cmd");
    const batch = join(directory, "provider.bat");
    writeFileSync(malformed, "@ECHO OFF\ncustom-launcher %*\n");
    writeFileSync(ambiguous, `${NPM_PREAMBLE}"%dp0%\\a.exe" %*\n"%dp0%\\b.exe" %*\n`);
    writeFileSync(traversing, `${NPM_PREAMBLE}"%dp0%\\..\\outside.exe" %*\n`);
    writeFileSync(batch, "@ECHO OFF\n");
    writeFileSync(join(directory, "a.exe"), "a");
    writeFileSync(join(directory, "b.exe"), "b");

    for (const command of [malformed, ambiguous, traversing, batch]) {
      expect(() => resolveCli(command, [], { platform: "win32" })).toThrow(UnsafeWindowsCliError);
    }
  });

  it("returns an unknown extensionless command unchanged for Node to report ENOENT", () => {
    expect(resolveCli("not-installed", ["--version"], {
      platform: "win32",
      pathEntries: [],
    })).toEqual({ command: "not-installed", args: ["--version"] });
  });

  it("falls back to child.kill when taskkill reports failure", () => {
    const kill = vi.fn();
    const child = { pid: 4312, exitCode: null, signalCode: null, kill } as unknown as ChildProcess;
    const taskkill = vi.fn((_file, _args, _options, callback: (error: Error | null) => void) => {
      callback(new Error("taskkill unavailable"));
    });

    killCliTree(child, { platform: "win32", taskkill });

    expect(taskkill).toHaveBeenCalledWith(
      "taskkill",
      ["/PID", "4312", "/T", "/F"],
      { windowsHide: true },
      expect.any(Function),
    );
    expect(kill).toHaveBeenCalledTimes(1);
  });

  it("falls back to child.kill when taskkill cannot be started", () => {
    const kill = vi.fn();
    const child = { pid: 4312, exitCode: null, signalCode: null, kill } as unknown as ChildProcess;
    const taskkill = vi.fn(() => {
      throw new Error("spawn failed");
    });

    killCliTree(child, { platform: "win32", taskkill });

    expect(taskkill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledTimes(1);
  });

  it("does not fall back when taskkill succeeds or the process already exited", () => {
    const kill = vi.fn();
    const taskkill = vi.fn((_file, _args, _options, callback: (error: Error | null) => void) => callback(null));
    const running = { pid: 4312, exitCode: null, signalCode: null, kill } as unknown as ChildProcess;
    killCliTree(running, { platform: "win32", taskkill });
    expect(kill).not.toHaveBeenCalled();

    const exited = { pid: 4312, exitCode: 0, signalCode: null, kill } as unknown as ChildProcess;
    killCliTree(exited, { platform: "win32", taskkill });
    expect(taskkill).toHaveBeenCalledTimes(1);
  });

  it("uses an authenticated named-pipe channel on Windows and a Unix socket elsewhere", () => {
    expect(brokerSocketPath("C:\\data", "abc-123", "win32")).toBe("\\\\.\\pipe\\cumea-permission-abc-123");
    expect(brokerSocketPath("/tmp/cumea", "abc-123", "linux")).toBe("/tmp/cumea/permission-abc-123.sock");
  });
});
