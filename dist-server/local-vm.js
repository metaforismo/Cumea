// Cua-backed Local VM lifecycle and health checks.
//
// Cumea owns the sandbox boundary (pinned image, lifecycle, resource limits,
// loopback viewer). Cua Driver owns desktop automation and its MCP protocol.
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { augmentedPath } from "./env-path.js";
const run = promisify(execFile);
export const LOCAL_VM_CUA_VERSION = "0.19.3";
export const LOCAL_VM_BASE_REPOSITORY = "docker.io/trycua/xfce-cua";
export const LOCAL_VM_BASE_DIGEST = "sha256:274eb636f5cf3fc58f705916ee72b7a701270b3877369d08533a385c5325be9b";
export const LOCAL_VM_BASE_IMAGE = `${LOCAL_VM_BASE_REPOSITORY}@${LOCAL_VM_BASE_DIGEST}`;
export const LOCAL_VM_IMAGE_REPOSITORY = "cumea/cua-local-vm";
export const LOCAL_VM_IMAGE = `${LOCAL_VM_IMAGE_REPOSITORY}:driver-${LOCAL_VM_CUA_VERSION}`;
export const LOCAL_VM_CONTAINER = "cumea-computer";
export const LOCAL_VM_MANAGED_LABEL = "io.github.metaforismo.cumea.local-vm";
export const LOCAL_VM_DRIVER_LABEL = "io.github.metaforismo.cumea.cua-driver";
export const LOCAL_VM_BASE_LABEL = "io.github.metaforismo.cumea.cua-base";
export const LOCAL_VM_SOCKET = "/run/user/1000/cumea-cua.sock";
export const LOCAL_VM_CUA_EXECUTABLE = "/usr/local/libexec/cumea/cua-driver";
const RUNTIMES = ["docker", "podman", "container"];
const INTERNAL_VIEWER_PORT = 6901;
const HOST_VIEWER_PORT = 6080;
const MEMORY_BYTES = 4 * 1024 * 1024 * 1024;
const NANO_CPUS = 2_000_000_000;
const PIDS_LIMIT = 512;
const LINUX_WHEELS = {
    x86_64: {
        url: "https://files.pythonhosted.org/packages/88/26/1b372765b192a2f4f7ee7e1474d1e39be9ab3bd637765f632e30e7ee6e18/cua_driver-0.19.3-py3-none-manylinux_2_31_x86_64.whl",
        sha256: "3f327a444f5b666037dee5e7c15c98990abbfb4fe83669ef708cb34c2cafef14",
    },
    aarch64: {
        url: "https://files.pythonhosted.org/packages/8f/ca/9b1b9e2fba756b5a6db710db4789d63682d6bdf8dc92280c10bdffeb9e77/cua_driver-0.19.3-py3-none-manylinux_2_31_aarch64.whl",
        sha256: "99cdaaaaf78def68236558b645c799034ac0b6fe5bb37abdf5fc7abc3afeff67",
    },
};
/** Reproducible derivative of Cua's multi-architecture XFCE desktop. */
export function localVmDockerfile() {
    return `FROM ${LOCAL_VM_BASE_IMAGE}
USER root
RUN set -eux; \\
    arch="$(uname -m)"; \\
    case "$arch" in \\
      x86_64) wheel_url='${LINUX_WHEELS.x86_64.url}'; wheel_sha='${LINUX_WHEELS.x86_64.sha256}'; wheel_path='/tmp/cua_driver-${LOCAL_VM_CUA_VERSION}-x86_64.whl' ;; \\
      aarch64|arm64) wheel_url='${LINUX_WHEELS.aarch64.url}'; wheel_sha='${LINUX_WHEELS.aarch64.sha256}'; wheel_path='/tmp/cua_driver-${LOCAL_VM_CUA_VERSION}-aarch64.whl' ;; \\
      *) echo "unsupported architecture: $arch" >&2; exit 1 ;; \\
    esac; \\
    curl -fsSL "$wheel_url" -o "$wheel_path"; \\
    echo "$wheel_sha  $wheel_path" | sha256sum -c -; \\
    /opt/venv/bin/python -m pip install --no-cache-dir --force-reinstall --no-deps "$wheel_path"; \\
    rm -f "$wheel_path"; \\
    driver_bin="$(find /opt/venv/lib -path '*/cua_driver/bin/cua-driver' -type f -print -quit)"; \\
    test -n "$driver_bin"; \\
    install -D -m 0755 "$driver_bin" ${LOCAL_VM_CUA_EXECUTABLE}; \\
    test "$(${LOCAL_VM_CUA_EXECUTABLE} --version)" = "cua-driver ${LOCAL_VM_CUA_VERSION}"
RUN printf '%s\\n' \\
      '#!/bin/sh' \\
      'while ! DISPLAY=:1 xset q >/dev/null 2>&1; do sleep 1; done' \\
      'exec env CUA_DRIVER_INSTALL_CHANNEL=python_package ${LOCAL_VM_CUA_EXECUTABLE} serve --socket ${LOCAL_VM_SOCKET} --permission-mode standard' \\
      > /usr/local/bin/start-cumea-cua-driver.sh \\
    && chmod 0755 /usr/local/bin/start-cumea-cua-driver.sh
RUN printf '%s\\n' \\
      '' \\
      '[program:cumea-cua-driver]' \\
      'command=/usr/local/bin/start-cumea-cua-driver.sh' \\
      'user=cua' \\
      'environment=HOME="/home/cua",USER="cua",DISPLAY=":1"' \\
      'autorestart=true' \\
      'startsecs=2' \\
      'stdout_logfile=/var/log/supervisor/cumea-cua-driver.log' \\
      'stderr_logfile=/var/log/supervisor/cumea-cua-driver.error.log' \\
      'priority=30' \\
      >> /etc/supervisor/supervisord.conf
LABEL ${LOCAL_VM_MANAGED_LABEL}="1" \\
      ${LOCAL_VM_DRIVER_LABEL}="${LOCAL_VM_CUA_VERSION}" \\
      ${LOCAL_VM_BASE_LABEL}="${LOCAL_VM_BASE_DIGEST}"
`;
}
async function shellRunner(command, args, timeout = 8_000) {
    const { stdout } = await run(command, args, {
        timeout,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, PATH: augmentedPath() },
    });
    return { stdout };
}
async function installed(command, runner, platform) {
    try {
        await runner(platform === "win32" ? "where.exe" : "/usr/bin/which", [command], 4_000);
        return true;
    }
    catch {
        return false;
    }
}
function emptyStatus(platform) {
    return {
        platform,
        runtime: null,
        available: [],
        daemonUp: false,
        image: false,
        imageMatches: false,
        managed: false,
        container: "missing",
        network: "unknown",
        security: "unknown",
        desktopReady: false,
        ready: false,
        problem: "Install a supported container runtime first",
        imageRef: LOCAL_VM_IMAGE,
        baseImageRef: LOCAL_VM_BASE_IMAGE,
        driverVersion: LOCAL_VM_CUA_VERSION,
        containerName: LOCAL_VM_CONTAINER,
        viewerUrl: `http://127.0.0.1:${HOST_VIEWER_PORT}/vnc.html`,
    };
}
function statusProblem(status) {
    if (!status.runtime)
        return "Install Docker, Podman, or Apple container first";
    if (!status.daemonUp)
        return `Start ${status.runtime} first`;
    if (!status.image)
        return `Prepare the checksum-pinned Cua ${LOCAL_VM_CUA_VERSION} desktop image`;
    if (status.container === "missing")
        return "Create the Local VM";
    if (!status.imageMatches)
        return "The Local VM uses an older image; recreate it";
    if (!status.managed)
        return "The existing container is not managed by Cumea; recreate it";
    if (status.network === "unsafe")
        return "The Local VM viewer is exposed beyond loopback; recreate it";
    if (status.security === "unsafe")
        return "The Local VM is missing required resource or capability limits; recreate it";
    if (status.container === "stopped")
        return "Start the Local VM";
    if (!status.desktopReady)
        return "The Local VM started, but Cua Driver is not ready yet";
    return null;
}
function labelsMatch(labels) {
    return labels?.[LOCAL_VM_MANAGED_LABEL] === "1" &&
        labels?.[LOCAL_VM_DRIVER_LABEL] === LOCAL_VM_CUA_VERSION &&
        labels?.[LOCAL_VM_BASE_LABEL] === LOCAL_VM_BASE_DIGEST;
}
function loopback(address) {
    return address === "127.0.0.1" || address === "::1" || address === "[::1]";
}
function dockerPortsAreLocal(bindings) {
    const viewer = bindings?.[`${INTERNAL_VIEWER_PORT}/tcp`] ?? [];
    const published = Object.values(bindings ?? {}).flatMap((entries) => entries ?? []);
    return viewer.length > 0 && published.length === viewer.length && published.every((entry) => loopback(entry.HostIp));
}
function applePortsAreLocal(bindings) {
    return Boolean(bindings?.length === 1 && bindings[0]?.containerPort === INTERNAL_VIEWER_PORT && loopback(bindings[0]?.hostAddress));
}
function dockerSecurityIsHardened(config) {
    if (!config)
        return false;
    const dropped = (config.CapDrop ?? []).map((capability) => capability.toLowerCase());
    const added = (config.CapAdd ?? []).map((capability) => capability.toLowerCase().replace(/^cap_/, "")).sort();
    return (config.Memory ?? 0) >= MEMORY_BYTES &&
        (config.MemorySwap ?? 0) === MEMORY_BYTES &&
        (config.NanoCpus ?? 0) === NANO_CPUS &&
        (config.PidsLimit ?? 0) > 0 &&
        (config.PidsLimit ?? Infinity) <= PIDS_LIMIT &&
        dropped.includes("all") &&
        added.join(",") === "setgid,setuid";
}
function viewerPassword(environment) {
    if (Array.isArray(environment))
        return environment.find((entry) => entry.startsWith("VNC_PW="))?.slice(7) || null;
    return environment?.VNC_PW || null;
}
function viewerUrl(password) {
    const base = `http://127.0.0.1:${HOST_VIEWER_PORT}/vnc.html`;
    if (!password)
        return base;
    return `${base}#${new URLSearchParams({ autoconnect: "true", resize: "scale", password }).toString()}`;
}
function cuaExecArgs(args, interactive = false) {
    return [
        "exec",
        ...(interactive ? ["-i"] : []),
        "-u", "cua",
        "-e", "HOME=/home/cua",
        "-e", "DISPLAY=:1",
        "-e", "CUA_DRIVER_INSTALL_CHANNEL=python_package",
        LOCAL_VM_CONTAINER,
        LOCAL_VM_CUA_EXECUTABLE,
        ...args,
    ];
}
export async function localVmStatus(runner = shellRunner, platform = process.platform) {
    const status = emptyStatus(platform);
    const candidates = RUNTIMES.filter((runtime) => runtime !== "container" || platform === "darwin");
    const present = await Promise.all(candidates.map((runtime) => installed(runtime, runner, platform)));
    status.available = candidates.filter((_, index) => present[index]);
    const healthy = await Promise.all(status.available.map(async (runtime) => {
        try {
            await runner(runtime, runtime === "container" ? ["system", "status"] : ["info", "--format", "{{.ServerVersion}}"], 10_000);
            return true;
        }
        catch {
            return false;
        }
    }));
    const healthyIndex = healthy.indexOf(true);
    status.runtime = healthyIndex >= 0 ? status.available[healthyIndex] : (status.available[0] ?? null);
    status.daemonUp = healthyIndex >= 0;
    if (!status.runtime || !status.daemonUp) {
        status.problem = statusProblem(status);
        return status;
    }
    try {
        const image = JSON.parse((await runner(status.runtime, ["image", "inspect", LOCAL_VM_IMAGE])).stdout);
        const labels = image[0]?.Config?.Labels ?? image[0]?.config?.Labels ?? image[0]?.config?.labels ?? image[0]?.configuration?.labels;
        status.image = labelsMatch(labels);
    }
    catch {
        // The managed image has not been prepared.
    }
    try {
        const inspected = JSON.parse((await runner(status.runtime, ["inspect", LOCAL_VM_CONTAINER])).stdout);
        const detail = inspected[0];
        if (status.runtime === "container") {
            status.container = detail?.status?.state === "running" ? "running" : "stopped";
            status.network = applePortsAreLocal(detail?.configuration?.publishedPorts) ? "loopback" : "unsafe";
            const image = typeof detail?.configuration?.image === "string"
                ? detail.configuration.image
                : detail?.configuration?.image?.reference ?? detail?.configuration?.imageReference;
            status.imageMatches = image === LOCAL_VM_IMAGE;
            status.managed = status.imageMatches;
            status.security = (detail?.configuration?.resources?.memoryInBytes ?? 0) >= MEMORY_BYTES &&
                detail?.configuration?.resources?.cpus === 2 ? "hardened" : "unsafe";
            status.viewerUrl = viewerUrl(viewerPassword(detail?.configuration?.environment));
        }
        else {
            status.container = detail?.State?.Running ? "running" : "stopped";
            status.network = dockerPortsAreLocal(detail?.HostConfig?.PortBindings) ? "loopback" : "unsafe";
            status.imageMatches = detail?.Config?.Image === LOCAL_VM_IMAGE && labelsMatch(detail?.Config?.Labels);
            status.managed = detail?.Config?.Labels?.[LOCAL_VM_MANAGED_LABEL] === "1";
            status.security = dockerSecurityIsHardened(detail?.HostConfig) ? "hardened" : "unsafe";
            status.viewerUrl = viewerUrl(viewerPassword(detail?.Config?.Env));
        }
    }
    catch {
        // No container with Cumea's fixed managed name.
    }
    const safeToProbe = status.container === "running" && status.imageMatches && status.managed &&
        status.network === "loopback" && status.security === "hardened";
    if (safeToProbe) {
        try {
            const version = await runner(status.runtime, cuaExecArgs(["--version"]), 8_000);
            if (version.stdout.trim() !== `cua-driver ${LOCAL_VM_CUA_VERSION}`)
                throw new Error("driver version mismatch");
            await runner(status.runtime, cuaExecArgs(["status", "--socket", LOCAL_VM_SOCKET]), 8_000);
            status.desktopReady = true;
        }
        catch {
            // XFCE and the supervisor-owned daemon need a few seconds to start.
        }
    }
    status.problem = statusProblem(status);
    status.ready = status.problem === null;
    return status;
}
export function localVmRunArgs(runtime, password = "CHANGE_ME") {
    const args = ["run", "-d", "--name", LOCAL_VM_CONTAINER];
    if (runtime === "container") {
        args.push("--memory", "4g", "--cpus", "2", "--cap-drop", "ALL", "--cap-add", "SETUID", "--cap-add", "SETGID", "--shm-size", "512m");
    }
    else {
        args.push("--label", `${LOCAL_VM_MANAGED_LABEL}=1`, "--label", `${LOCAL_VM_DRIVER_LABEL}=${LOCAL_VM_CUA_VERSION}`, "--label", `${LOCAL_VM_BASE_LABEL}=${LOCAL_VM_BASE_DIGEST}`, "--memory", "4g", "--memory-swap", "4g", "--cpus", "2", "--pids-limit", String(PIDS_LIMIT), "--cap-drop", "ALL", "--cap-add", "SETUID", "--cap-add", "SETGID", "--shm-size", "512m");
    }
    args.push("-e", `VNC_PW=${password}`, "-p", `127.0.0.1:${HOST_VIEWER_PORT}:${INTERNAL_VIEWER_PORT}`, LOCAL_VM_IMAGE);
    return args;
}
async function prepareImage(runtime, runner) {
    await runner(runtime, ["pull", LOCAL_VM_BASE_IMAGE], 10 * 60_000);
    const context = await mkdtemp(join(tmpdir(), "cumea-local-vm-image-"));
    try {
        await writeFile(join(context, "Dockerfile"), localVmDockerfile(), { mode: 0o600 });
        await runner(runtime, ["build", "-t", LOCAL_VM_IMAGE, context], 10 * 60_000);
    }
    finally {
        await rm(context, { recursive: true, force: true });
    }
}
export async function localVmAction(action, runner = shellRunner, platform = process.platform) {
    const before = await localVmStatus(runner, platform);
    const runtime = before.runtime;
    if (!runtime || !before.daemonUp) {
        throw Object.assign(new Error(before.problem ?? "No healthy container runtime is available"), { status: 409 });
    }
    if (action === "run" && before.container !== "missing")
        throw Object.assign(new Error("A Local VM already exists; remove it before creating a replacement"), { status: 409 });
    if (action === "run" && !before.image)
        throw Object.assign(new Error("Prepare the pinned Cua image before creating the Local VM"), { status: 409 });
    if (action === "start" && before.container !== "stopped")
        throw Object.assign(new Error(before.container === "running" ? "The Local VM is already running" : "Create the Local VM first"), { status: 409 });
    if (action === "start" && (!before.imageMatches || !before.managed || before.network !== "loopback" || before.security !== "hardened")) {
        throw Object.assign(new Error("The Local VM is incompatible or unsafe; remove and recreate it"), { status: 409 });
    }
    if (action === "stop" && before.container !== "running")
        throw Object.assign(new Error("The Local VM is not running"), { status: 409 });
    if (action === "remove" && before.container === "missing")
        return before;
    if (action === "pull")
        await prepareImage(runtime, runner);
    else {
        const args = action === "run"
            ? localVmRunArgs(runtime, randomBytes(12).toString("base64url"))
            : action === "remove"
                ? ["rm", runtime === "container" ? "--force" : "-f", LOCAL_VM_CONTAINER]
                : [action, LOCAL_VM_CONTAINER];
        await runner(runtime, args, 2 * 60_000);
    }
    return localVmStatus(runner, platform);
}
function completeScreenshot(bytes) {
    if (bytes.length < 512)
        return { ok: false, mime: "image/png" };
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
        return { ok: bytes.subarray(Math.max(0, bytes.length - 12)).includes(Buffer.from("IEND", "ascii")), mime: "image/png" };
    }
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
    return { ok: jpeg && bytes.subarray(Math.max(0, bytes.length - 32)).includes(Buffer.from([0xff, 0xd9])), mime: "image/jpeg" };
}
export async function localVmScreenshot(runner = shellRunner, platform = process.platform) {
    const status = await localVmStatus(runner, platform);
    if (!status.ready || !status.runtime)
        throw Object.assign(new Error(status.problem ?? "The Local VM is not ready"), { status: 409 });
    const target = "/tmp/cumea-preview.png";
    await runner(status.runtime, cuaExecArgs(["call", "get_desktop_state", "{}", "--socket", LOCAL_VM_SOCKET, "--screenshot-out-file", target]), 30_000);
    const data = (await runner(status.runtime, ["exec", LOCAL_VM_CONTAINER, "base64", "-w0", target], 30_000)).stdout.trim();
    const checked = completeScreenshot(Buffer.from(data, "base64"));
    if (!checked.ok)
        throw Object.assign(new Error("Cua Driver returned an incomplete screenshot"), { status: 502 });
    return `data:${checked.mime};base64,${data}`;
}
const bridgePath = (() => {
    const source = join(dirname(fileURLToPath(import.meta.url)), "local-vm-mcp.ts");
    return existsSync(source) ? source : source.replace(/\.ts$/, ".js");
})();
export function localVmMcp(runtime) {
    return {
        command: process.execPath,
        args: [bridgePath, runtime, LOCAL_VM_CONTAINER, LOCAL_VM_SOCKET],
        env: { ELECTRON_RUN_AS_NODE: "1" },
    };
}
export function localVmSetupCommands(runtime, platform = process.platform) {
    const install = platform === "darwin"
        ? "brew install podman; podman machine init; podman machine start"
        : platform === "win32"
            ? "winget install -e --id RedHat.Podman-Desktop"
            : null;
    if (!runtime)
        return { install, runtimeStart: null, pull: null, run: null, start: null, stop: null, remove: null };
    const command = (args) => [runtime, ...args].join(" ");
    return {
        install,
        runtimeStart: runtime === "container" ? "container system start" : runtime === "podman" && platform !== "linux" ? "podman machine start" : null,
        pull: command(["pull", LOCAL_VM_BASE_IMAGE]),
        run: command(localVmRunArgs(runtime)),
        start: command(["start", LOCAL_VM_CONTAINER]),
        stop: command(["stop", LOCAL_VM_CONTAINER]),
        remove: command(["rm", runtime === "container" ? "--force" : "-f", LOCAL_VM_CONTAINER]),
    };
}
