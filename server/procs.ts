// Cross-platform process helpers for provider CLIs. Keep the operating-system
// differences in one place so drivers cannot accidentally rely on POSIX
// process groups or try to execute Windows .cmd shims directly.
import {
  execFile,
  spawn,
  type ChildProcess,
  type ChildProcessByStdio,
  type ExecFileOptions,
  type SpawnOptions,
} from "node:child_process";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";
import {
  resolveCliSpawn,
  type CliResolutionOptions,
  type ResolvedCliSpawn,
} from "./env-path.ts";

export function resolveCli(
  cli: string,
  args: string[] = [],
  options: CliResolutionOptions = {},
): ResolvedCliSpawn {
  return resolveCliSpawn(cli, args, options);
}

export function spawnCli(
  cli: string,
  args: string[],
  options: SpawnOptions,
): ChildProcessByStdio<Writable, Readable, Readable> {
  const resolved = resolveCli(cli, args);
  return spawn(resolved.command, resolved.args, {
    ...options,
    shell: false,
    ...(process.platform === "win32" ? { windowsHide: true, detached: false } : { detached: true }),
  }) as ChildProcessByStdio<Writable, Readable, Readable>;
}

export function execCli(
  cli: string,
  args: string[],
  options: ExecFileOptions,
  callback: (error: Error | null, stdout: string) => void,
): void {
  const resolved = resolveCli(cli, args);
  execFile(resolved.command, resolved.args, { ...options, shell: false, windowsHide: true }, (error, stdout) => {
    callback(error, typeof stdout === "string" ? stdout : String(stdout));
  });
}

/** Stop a provider CLI and every subprocess it owns, including MCP proxies. */
interface KillCliTreeOptions {
  platform?: NodeJS.Platform;
  taskkill?: (
    file: string,
    args: readonly string[],
    options: { windowsHide: boolean },
    callback: (error: Error | null) => void,
  ) => void;
}

export function killCliTree(child: ChildProcess, options: KillCliTreeOptions = {}): void {
  const pid = child.pid;
  if (!pid || child.exitCode !== null || child.signalCode !== null) return;
  if ((options.platform ?? process.platform) === "win32") {
    const taskkill = options.taskkill ?? ((file, args, execOptions, callback) => {
      execFile(file, args, execOptions, (error) => callback(error));
    });
    try {
      taskkill("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, (error) => {
        if (!error) return;
        try {
          child.kill();
        } catch {
          // The process may already have exited.
        }
      });
    } catch {
      try {
        child.kill();
      } catch {
        // The process may already have exited.
      }
    }
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // The process tree may already have exited.
    }
  }
}

/** Unix-domain socket on POSIX, named pipe on Windows. The random channel tag
 * is supplied by the caller; authentication is still mandatory because a
 * path or pipe name is not a security boundary. */
export function brokerSocketPath(dataDir: string, tag: string, platform: NodeJS.Platform = process.platform): string {
  return platform === "win32"
    ? `\\\\.\\pipe\\cumea-permission-${tag}`
    : join(dataDir, `permission-${tag}.sock`);
}
