// PATH augmentation for GUI launches — the fix for "CLI not found" when
// the app is opened from Finder (issues #8, #12).
//
// A macOS app launched from Finder inherits a bare PATH
// (/usr/bin:/bin:...): no ~/.local/bin (the claude installer default),
// no /opt/homebrew/bin, and no nvm/volta/asdf shims — those only exist
// in interactive shells. The terminal sees the CLIs; the packaged app
// doesn't. So every spawn of an agent CLI goes through augmentedPath():
// the inherited PATH, plus the well-known install locations that exist
// on this machine, plus (async, best-effort) whatever PATH the user's
// real login shell reports.
import { execFile } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync, } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, extname, join } from "node:path";
/** nvm keeps every node version's bin dir separately; newest first so a
 * CLI installed under the latest node wins. */
function nvmBinDirs() {
    try {
        const base = join(homedir(), ".nvm", "versions", "node");
        return readdirSync(base)
            .filter((v) => v.startsWith("v"))
            .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
            .map((v) => join(base, v, "bin"));
    }
    catch {
        return [];
    }
}
function knownDirs() {
    const home = homedir();
    return [
        join(home, ".local", "bin"), // claude installer default
        join(home, ".claude", "local"), // claude "local install"
        "/opt/homebrew/bin", // brew, Apple silicon
        "/usr/local/bin", // brew Intel / classic installs
        join(home, ".volta", "bin"),
        join(home, ".bun", "bin"),
        join(home, ".asdf", "shims"),
        join(home, ".deno", "bin"),
        join(home, "bin"),
        ...nvmBinDirs(),
    ];
}
/** Standard Windows CLI install locations. Rescanning them lets a running GUI
 * discover providers installed after launch, without depending on a refreshed
 * process-wide PATH snapshot. */
function windowsKnownDirs() {
    const home = homedir();
    const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
    const localAppData = process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");
    return [
        join(appData, "npm"),
        join(home, ".grok", "bin"),
        join(localAppData, "agy", "bin"),
        join(home, ".local", "bin"),
        join(home, ".claude", "local"),
        join(home, ".bun", "bin"),
        join(home, ".deno", "bin"),
        join(home, "go", "bin"),
    ];
}
let cached = null;
let probed = false;
/** Drop the process-wide PATH snapshot before a user-requested provider
 * rescan. This matters on Windows, where a running GUI process never receives
 * PATH changes made by an installer, and for newly created Unix install dirs. */
export function resetPathCache() {
    cached = null;
    probed = false;
}
/** Current best PATH, synchronously. Cheap after the first call. */
export function augmentedPath() {
    if (cached === null) {
        cached = mergePaths([
            ...(process.env.CUMEA_EXTRA_PATH ? process.env.CUMEA_EXTRA_PATH.split(delimiter) : []),
            ...(process.env.PATH ? process.env.PATH.split(delimiter) : []),
            ...(process.platform === "win32" ? windowsKnownDirs() : knownDirs()).filter((d) => existsSync(d)),
        ]);
    }
    // belt-and-braces: fold in the login shell's PATH once, in the
    // background — catches anything the known-dirs list doesn't (custom
    // rc exports). Never blocks a spawn; the next one benefits.
    if (!probed && !process.env.VITEST && process.platform !== "win32") {
        probed = true;
        probeLoginShellPath();
    }
    return cached;
}
function mergePaths(parts) {
    return [...new Set(parts.filter(Boolean))].join(delimiter);
}
function probeLoginShellPath() {
    const shell = process.env.SHELL || "/bin/zsh";
    // -l -i: nvm and friends live in .zshrc/.bashrc, which only interactive
    // shells read. A marker isolates $PATH from any rc-file noise.
    execFile(shell, ["-l", "-i", "-c", 'printf "__CUMEA_PATH__%s" "$PATH"'], { timeout: 5000 }, (err, stdout) => {
        if (err || !stdout)
            return;
        const m = /__CUMEA_PATH__([^\n]*)/.exec(stdout);
        if (!m || !m[1])
            return;
        cached = mergePaths([...(cached ?? "").split(delimiter), ...m[1].split(delimiter)]);
    });
}
/** Test hook — the cache is process-wide otherwise. */
export function resetPathCacheForTests() {
    resetPathCache();
}
export class UnsafeWindowsCliError extends Error {
    code = "ERR_UNSAFE_WINDOWS_CLI_SHIM";
    cli;
    constructor(cli) {
        super(`Cannot safely launch Windows command shim without a shell: ${cli}`);
        this.name = "UnsafeWindowsCliError";
        this.cli = cli;
    }
}
function isFile(path) {
    try {
        return statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
    }
    catch {
        return false;
    }
}
function normalizedPathExt(options) {
    const configured = options.pathExt
        ?? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";");
    return [...new Set(configured
            .map((extension) => extension.trim())
            .filter(Boolean)
            .map((extension) => (extension.startsWith(".") ? extension : `.${extension}`)))];
}
/** PATHEXT-aware lookup. Explicit paths are resolved exactly as supplied. */
function whichWindows(cli, options) {
    const extensions = normalizedPathExt(options);
    const pathLike = /[\\/]/.test(cli) || /^[a-zA-Z]:/.test(cli);
    const probe = (base) => {
        const candidates = extname(base)
            ? [base]
            : [...extensions.map((extension) => `${base}${extension}`), base];
        return candidates.find(isFile) ?? null;
    };
    if (pathLike)
        return probe(cli);
    const entries = options.pathEntries ?? augmentedPath().split(delimiter);
    for (const directory of entries) {
        if (!directory)
            continue;
        const found = probe(join(directory, cli));
        if (found)
            return found;
    }
    return null;
}
function nodeExecutableNear(directory, options) {
    if (options.nodeExecutable !== undefined)
        return options.nodeExecutable;
    const adjacent = join(directory, "node.exe");
    if (isFile(adjacent))
        return adjacent;
    const onPath = whichWindows("node.exe", {
        ...options,
        pathExt: [".EXE"],
    });
    if (onPath && extname(onPath).toLowerCase() === ".exe")
        return onPath;
    return process.versions.electron ? null : process.execPath;
}
function readFirstLine(path) {
    let descriptor = null;
    try {
        descriptor = openSync(path, "r");
        const buffer = Buffer.alloc(256);
        const bytes = readSync(descriptor, buffer, 0, buffer.length, 0);
        return buffer.subarray(0, bytes).toString("utf8").split(/\r?\n/, 1)[0] ?? "";
    }
    catch {
        return null;
    }
    finally {
        if (descriptor !== null) {
            try {
                closeSync(descriptor);
            }
            catch {
                // Best-effort descriptor cleanup.
            }
        }
    }
}
function resolveNodeShebang(path, options) {
    const firstLine = readFirstLine(path);
    if (!firstLine)
        return null;
    // Keep this intentionally narrow. In particular, env -S and extra shebang
    // arguments need shell-like parsing and are therefore not guessed here.
    if (!/^#!\s*(?:\/usr\/bin\/env\s+node(?:\.exe)?|\/(?:usr\/local\/bin|usr\/bin)\/node|node(?:\.exe)?)\s*$/.test(firstLine)) {
        return null;
    }
    const node = nodeExecutableNear(dirname(path), options);
    return node ? { command: node, args: [path] } : null;
}
function safeRelativeShimTarget(shim, relative) {
    if (!relative || relative.includes("%") || relative.includes("!") || relative.includes(":"))
        return null;
    const segments = relative.split(/[\\/]+/);
    if (segments.some((segment) => !segment || segment === "." || segment === ".."))
        return null;
    const target = join(dirname(shim), ...segments);
    return isFile(target) ? target : null;
}
/** Parse only the stable npm-generated .cmd shape, without interpreting cmd. */
function resolveNpmCmdShim(shim, options) {
    let text;
    try {
        text = readFileSync(shim, "utf8");
    }
    catch {
        return null;
    }
    if (text.length > 64 * 1024 || text.includes("\0"))
        return null;
    const modernPreamble = /@ECHO off[\s\S]*GOTO start[\s\S]*:find_dp0[\s\S]*SET dp0=%~dp0[\s\S]*:start[\s\S]*SETLOCAL[\s\S]*CALL :find_dp0/i;
    if (modernPreamble.test(text)) {
        const nodeMatches = [...text.matchAll(/"%_prog%"\s+"%dp0%\\([^"\r\n]+\.[cm]?js)"\s+%\*\s*$/gim)];
        const executableMatches = [...text.matchAll(/^\s*"%dp0%\\([^"\r\n]+\.(?:exe|com))"\s+%\*\s*$/gim)];
        if (nodeMatches.length + executableMatches.length !== 1)
            return null;
        if (nodeMatches.length === 1) {
            const script = safeRelativeShimTarget(shim, nodeMatches[0][1]);
            if (!script || !/\.[cm]?js$/i.test(script))
                return null;
            const node = nodeExecutableNear(dirname(shim), options);
            return node ? { command: node, args: [script] } : null;
        }
        const executable = safeRelativeShimTarget(shim, executableMatches[0][1]);
        return executable && /\.(?:exe|com)$/i.test(executable)
            ? { command: executable, args: [] }
            : null;
    }
    // cmd-shim releases before the dp0 subroutine emitted two explicit node
    // branches. Accept that exact structure only when both branches name the
    // same script; differing targets are ambiguous and therefore rejected.
    const legacyPreamble = /^\s*@IF EXIST "%~dp0\\node\.exe"\s*\([\s\S]*\)\s*ELSE\s*\([\s\S]*@SETLOCAL[\s\S]*@SET PATHEXT=/i;
    if (!legacyPreamble.test(text))
        return null;
    const legacyMatches = [...text.matchAll(/"%~dp0\\([^"\r\n]+\.[cm]?js)"\s+%\*\s*$/gim)];
    const uniqueTargets = [...new Set(legacyMatches.map((match) => match[1]))];
    if (legacyMatches.length !== 2 || uniqueTargets.length !== 1)
        return null;
    const script = safeRelativeShimTarget(shim, uniqueTargets[0]);
    if (!script)
        return null;
    const node = nodeExecutableNear(dirname(shim), options);
    return node ? { command: node, args: [script] } : null;
}
/**
 * Resolve a provider CLI to an argv-only spawn. Off Windows this is identity.
 * Unknown command names are returned unchanged so Node can report ENOENT.
 */
export function resolveCliSpawn(cli, args, options = {}) {
    if ((options.platform ?? process.platform) !== "win32")
        return { command: cli, args };
    const file = whichWindows(cli, options);
    if (!file) {
        if (/\.(?:cmd|bat)$/i.test(cli))
            throw new UnsafeWindowsCliError(cli);
        return { command: cli, args };
    }
    const extension = extname(file).toLowerCase();
    if (extension === ".bat")
        throw new UnsafeWindowsCliError(file);
    if (extension === ".cmd") {
        const resolved = resolveNpmCmdShim(file, options);
        if (!resolved)
            throw new UnsafeWindowsCliError(file);
        return { command: resolved.command, args: [...resolved.args, ...args] };
    }
    if (extension === ".exe" || extension === ".com")
        return { command: file, args };
    const viaNode = resolveNodeShebang(file, options);
    if (!viaNode)
        return { command: file, args };
    return { command: viaNode.command, args: [...viaNode.args, ...args] };
}
