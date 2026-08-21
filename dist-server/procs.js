// Cross-platform process helpers for provider CLIs. Keep the operating-system
// differences in one place so drivers cannot accidentally rely on POSIX
// process groups or try to execute Windows .cmd shims directly.
import { execFile, spawn, } from "node:child_process";
import { join } from "node:path";
import { resolveCliSpawn, } from "./env-path.js";
export function resolveCli(cli, args = [], options = {}) {
    return resolveCliSpawn(cli, args, options);
}
export function spawnCli(cli, args, options) {
    const resolved = resolveCli(cli, args);
    return spawn(resolved.command, resolved.args, {
        ...options,
        shell: false,
        ...(process.platform === "win32" ? { windowsHide: true, detached: false } : { detached: true }),
    });
}
export function execCli(cli, args, options, callback) {
    const resolved = resolveCli(cli, args);
    execFile(resolved.command, resolved.args, { ...options, shell: false, windowsHide: true }, (error, stdout) => {
        callback(error, typeof stdout === "string" ? stdout : String(stdout));
    });
}
export function killCliTree(child, options = {}) {
    const pid = child.pid;
    if (!pid || child.exitCode !== null || child.signalCode !== null)
        return;
    if ((options.platform ?? process.platform) === "win32") {
        const taskkill = options.taskkill ?? ((file, args, execOptions, callback) => {
            execFile(file, args, execOptions, (error) => callback(error));
        });
        try {
            taskkill("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, (error) => {
                if (!error)
                    return;
                try {
                    child.kill();
                }
                catch {
                    // The process may already have exited.
                }
            });
        }
        catch {
            try {
                child.kill();
            }
            catch {
                // The process may already have exited.
            }
        }
        return;
    }
    try {
        process.kill(-pid, "SIGTERM");
    }
    catch {
        try {
            child.kill("SIGTERM");
        }
        catch {
            // The process tree may already have exited.
        }
    }
}
/** Unix-domain socket on POSIX, named pipe on Windows. The random channel tag
 * is supplied by the caller; authentication is still mandatory because a
 * path or pipe name is not a security boundary. */
export function brokerSocketPath(dataDir, tag, platform = process.platform) {
    return platform === "win32"
        ? `\\\\.\\pipe\\cumea-permission-${tag}`
        : join(dataDir, `permission-${tag}.sock`);
}
