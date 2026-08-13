// Box (box.ascii.dev) provider — the bot's cloud computer. Ported from
// agentcal-api src/providers/box.js, reshaped per-bot instead of
// per-customer: every bot gets one persistent box (deterministic name),
// stop pauses billing while the disk survives, and Join always mints a
// FRESH desktop URL (stream tokens rotate on every state change — never
// persist one).
//
// Substrate facts (probed by agentcal 2026-07-24 on a live box):
//   - REST only: POST /boxes/{id}/commands runs shell synchronously.
//   - stop→archived ~5s, resume→idle ~8s; disk persists, tmux does not.
//   - X11 desktop with Chrome + Ghostty; passwordless sudo; node 24.
//   - the dedicated IP rotates across archive/resume — never persist it.
import { createHash, randomBytes } from "node:crypto";
import { posix } from "node:path";
const BOX_API = "https://ascii.dev/api/box/v1";
const READY = new Set(["idle", "ready", "running"]);
const WORKSPACE_FILE_MAX_BYTES = 25 * 1024 * 1024;
const SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024;
const SCREENSHOT_MAX_DIMENSION = 8_192;
const SCREENSHOT_MAX_PIXELS = 32 * 1024 * 1024;
const BOX_DELETE_CLEANUP_TIMEOUT_MS = 5_000;
const BOX_DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const provisionFlights = new Map();
function boxFetch(cfg, path, opts = {}) {
    const signal = opts.signal ?? AbortSignal.timeout(BOX_DEFAULT_REQUEST_TIMEOUT_MS);
    return fetch(`${BOX_API}${path}`, {
        ...opts,
        signal,
        headers: {
            authorization: `Bearer ${cfg.box?.token}`,
            "content-type": "application/json",
            ...(opts.headers ?? {}),
        },
    });
}
async function boxJson(cfg, path, opts = {}) {
    const res = await boxFetch(cfg, path, opts);
    const body = await res.json().catch(() => null);
    return { ok: res.ok && body?.ok !== false, status: res.status, body };
}
// deterministic per-bot name; the hash kills truncated-uuid collisions
async function boxNameFor(botId) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(botId));
    const hash = [...new Uint8Array(digest)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
        .slice(0, 6);
    return `cumea-${botId.slice(0, 8).toLowerCase().replace(/[^a-z0-9]/g, "")}-${hash}`;
}
export async function runCommand(cfg, boxId, command, { timeoutMs = 120_000 } = {}) {
    const res = await boxFetch(cfg, `/boxes/${boxId}/commands`, {
        method: "POST",
        body: JSON.stringify({ command }),
        signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await res.json().catch(() => null);
    return {
        ok: res.ok && body?.exitCode === 0,
        exitCode: body?.exitCode ?? null,
        stdout: body?.stdout ?? "",
        stderr: body?.stderr ?? "",
    };
}
// Desktop access, in the order that actually works (agentcal probing):
//   1) VNC (POST /desktop?vnc=1) — plain WebSocket, survives P2P-blocking
//      networks; answers {provisioning:true} first, so poll for the URL.
//   2) WebRTC stream (POST /desktop) as fallback — STUN-only, can hang.
// The desktopUrl stored on the box object is NOT usable on its own.
async function mintDesktopUrl(cfg, boxId, { vncBudgetMs = 60_000 } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < vncBudgetMs) {
        const { body } = await boxJson(cfg, `/boxes/${boxId}/desktop?vnc=1`, { method: "POST" });
        const url = body?.desktopUrl ?? body?.url;
        if (url)
            return url;
        if (!body?.provisioning)
            break;
        await new Promise((r) => setTimeout(r, 3000));
    }
    const { body } = await boxJson(cfg, `/boxes/${boxId}/desktop`, { method: "POST" });
    return body?.desktopUrl ?? body?.url ?? null;
}
async function waitReady(cfg, boxId, budgetMs = 90_000) {
    const t0 = Date.now();
    while (Date.now() - t0 < budgetMs) {
        const { body } = await boxJson(cfg, `/boxes/${boxId}`);
        const state = body?.box?.state;
        if (READY.has(state))
            return body.box;
        if (state === "error")
            return null;
        // an archiving box can't resume until the snapshot lands — nudge after
        if (state === "archived")
            await boxJson(cfg, `/boxes/${boxId}/resume`, { method: "POST" });
        await new Promise((r) => setTimeout(r, 2500));
    }
    return null;
}
async function findBoxResult(cfg, botId, opts = {}) {
    const name = await boxNameFor(botId);
    const response = await boxJson(cfg, "/boxes", opts);
    const ownedBox = (response.body?.boxes ?? []).find((b) => b.name === name && b.state !== "error") ?? null;
    return { ...response, ownedBox };
}
export async function findBox(cfg, botId, opts = {}) {
    return (await findBoxResult(cfg, botId, opts)).ownedBox;
}
export function boxConfigured(cfg) {
    return Boolean(cfg.box?.token);
}
/** Box state for the Computer panel. */
export async function boxStatus(cfg, botId) {
    if (!boxConfigured(cfg))
        return { configured: false, box: null };
    const box = await findBox(cfg, botId);
    return {
        configured: true,
        box: box ? { boxId: box.id, state: box.state, desktopAvailable: box.desktopAvailable ?? null } : null,
    };
}
/**
 * Find-or-create the bot's persistent box, wait for ready, run the
 * idempotent bootstrap (screenshot tooling for the computer-use bridge +
 * a tmux welcome), and mint a fresh desktop URL.
 */
async function provisionBoxOnce(cfg, botId, botName) {
    if (!boxConfigured(cfg)) {
        throw new Error('box provider not enabled — add {"box":{"token":"…"}} to ~/.cumea/config.json');
    }
    const vmName = await boxNameFor(botId);
    let box = await findBox(cfg, botId);
    let created = false;
    if (!box) {
        let createRes = await boxJson(cfg, "/boxes", {
            method: "POST",
            // substrate-side backstop: archives itself (billing pauses, disk
            // survives) if every stop path dies
            body: JSON.stringify({ ttlSeconds: 8 * 60 * 60 }),
        });
        if (createRes.body?.code === "trial_auto_stop_required") {
            createRes = await boxJson(cfg, "/boxes", {
                method: "POST",
                body: JSON.stringify({ ttlSeconds: 2 * 60 * 60 }),
            });
        }
        if (!createRes.ok || !createRes.body?.box?.id) {
            const why = createRes.body?.message ?? createRes.body?.error?.message ?? "";
            throw new Error(`box create failed (${createRes.status})${why ? `: ${why}` : ""}`);
        }
        box = createRes.body.box;
        created = true;
        await boxJson(cfg, `/boxes/${box.id}`, { method: "PATCH", body: JSON.stringify({ name: vmName }) });
    }
    const ready = await waitReady(cfg, box.id);
    if (!ready)
        throw new Error("box did not become ready within 90s — retry in a minute");
    // Idempotent bootstrap. Three layers:
    //   1. X11 action + capture tools (xdotool/scrot/imagemagick) — the
    //      always-works fallback for the computer tools.
    //   2. CUA (cua-computer-server, trycua) installed into /opt/cumea/venv in
    //      the BACKGROUND (first install takes minutes; nohup'd children
    //      survive the commands endpoint returning — probed by agentcal).
    //   3. computer-server started loopback-only on :8000 when installed —
    //      driven from outside via the box's run-command endpoint, so no
    //      inbound port and no tunnel is ever needed.
    const cuaInstall = [
        "sudo apt-get update -qq || true",
        "sudo apt-get install -y -qq gnome-screenshot xclip wmctrl xdotool imagemagick scrot >/dev/null 2>&1 || true",
        'curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null 2>&1 || true',
        'export PATH="$HOME/.local/bin:$PATH"',
        'sudo mkdir -p /opt/cumea && sudo chown "$(whoami)" /opt/cumea',
        "uv venv /opt/cumea/venv --python 3.13 >/dev/null 2>&1 || uv venv /opt/cumea/venv >/dev/null 2>&1 || true",
        "[ -x /opt/cumea/venv/bin/python ] && uv pip install --python /opt/cumea/venv/bin/python cua-computer-server >/dev/null 2>&1 || true",
        "[ -x /opt/cumea/venv/bin/python ] && /opt/cumea/venv/bin/python -c 'import computer_server' 2>/dev/null && touch /opt/cumea/cua-ready || true",
    ].join("; ");
    const bootstrap = [
        "mkdir -p /workspace && chmod 700 /workspace",
        "command -v xdotool >/dev/null || sudo apt-get install -y -qq xdotool scrot imagemagick >/dev/null 2>&1 || true",
        `[ -f /opt/cumea/cua-ready ] || [ -f /tmp/cumea-cua-installing ] || { touch /tmp/cumea-cua-installing; nohup bash -c '${cuaInstall.replace(/'/g, "'\\''")}; rm -f /tmp/cumea-cua-installing' > /tmp/cumea-cua-install.log 2>&1 & }`,
        // start CUA computer-server (loopback only) once installed; pidfile-free
        // guard on the module name is safe here — the pattern cannot match this
        // bootstrap's own shell (agentcal's pgrep self-match trap)
        'if [ -f /opt/cumea/cua-ready ] && ! pgrep -f "computer_server" >/dev/null 2>&1; then DISPLAY=${DISPLAY:-:0} nohup /opt/cumea/venv/bin/python -m computer_server --host 127.0.0.1 --port 8000 --width 1280 --height 800 > /tmp/cumea-cua-server.log 2>&1 & fi',
        `tmux has-session -t work 2>/dev/null || tmux new-session -d -s work 'echo; echo "  ▦ ${botName.replace(/["'\\\\]/g, "")}'"'"'s computer — Cumea"; echo; exec bash -i'`,
        "echo bootstrapped",
    ].join("\n");
    let boot;
    for (let attempt = 0; attempt < 5; attempt++) {
        boot = await runCommand(cfg, box.id, bootstrap);
        if (boot.ok || boot.exitCode !== null)
            break;
        await new Promise((r) => setTimeout(r, 3000));
    }
    const joinUrl = await mintDesktopUrl(cfg, box.id);
    return { boxId: box.id, machineName: vmName, reused: !created, state: ready.state, joinUrl };
}
/** One owner-scoped find/create pipeline per bot. The route and first-turn
 * auto-provision path share this flight, preventing duplicate billable VMs. */
export function provisionBox(cfg, botId, botName) {
    // Configuration hot-reload mutates the shared object. Capture the credential
    // for the whole flight so a request never changes account/token mid-create.
    const flightCfg = {
        ...cfg,
        ...(cfg.box ? { box: { ...cfg.box } } : {}),
    };
    const tokenIdentity = createHash("sha256").update(String(flightCfg.box?.token ?? "")).digest("hex");
    const flightKey = `${botId}:${tokenIdentity}`;
    const current = provisionFlights.get(flightKey);
    if (current)
        return current;
    const flight = provisionBoxOnce(flightCfg, botId, botName);
    provisionFlights.set(flightKey, flight);
    void flight.finally(() => {
        if (provisionFlights.get(flightKey) === flight)
            provisionFlights.delete(flightKey);
    }).catch(() => { });
    return flight;
}
function workspacePath(value) {
    if (typeof value !== "string")
        throw Object.assign(new Error("file path required"), { status: 400 });
    const requested = value.trim();
    if (!requested || requested.length > 2048 || /[\u0000-\u001f\u007f]/.test(requested)) {
        throw Object.assign(new Error("invalid workspace file path"), { status: 400 });
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(requested)) {
        throw Object.assign(new Error("URLs are not workspace file paths"), { status: 400 });
    }
    const candidate = requested.startsWith("/") ? posix.normalize(requested) : posix.resolve("/workspace", requested);
    if (candidate !== "/workspace" && !candidate.startsWith("/workspace/")) {
        throw Object.assign(new Error("file is outside the cloud workspace"), { status: 403 });
    }
    return candidate;
}
/**
 * Ask the owner-scoped Box VM to make a bounded snapshot, then fetch only
 * that snapshot through the Box files API. The chat-supplied path is base64
 * data inside a base64-encoded Python program, never shell source.
 */
export async function readWorkspaceFile(cfg, botId, requestedValue) {
    const requested = workspacePath(requestedValue);
    const box = await findBox(cfg, botId);
    if (!box)
        throw Object.assign(new Error("this bot has no cloud computer"), { status: 404 });
    const ready = READY.has(box.state) ? box : await waitReady(cfg, box.id, 60_000);
    if (!ready)
        throw Object.assign(new Error("the cloud computer is not ready"), { status: 409 });
    const snapshotName = `${randomBytes(18).toString("hex")}.bin`;
    // Keep the snapshot out of the agent-controlled workspace. The random
    // single-component /tmp name plus O_EXCL/O_NOFOLLOW avoids an attacker-
    // chosen parent symlink; a SHA-256 check below detects path swaps before the
    // Box file API reads it back.
    const snapshotPath = `/tmp/cumea-preview-${snapshotName}`;
    const encodedPath = Buffer.from(requested, "utf8").toString("base64");
    const script = [
        "import base64,hashlib,json,os,stat,sys",
        `requested=base64.b64decode(${JSON.stringify(encodedPath)}).decode('utf-8')`,
        "root=os.path.realpath('/workspace')",
        "candidate=os.path.normpath(requested if os.path.isabs(requested) else os.path.join(root,requested))",
        "",
        "try:",
        "  if os.path.commonpath([root,candidate]) != root: raise PermissionError('outside workspace')",
        "  before=os.lstat(candidate)",
        "  if stat.S_ISLNK(before.st_mode) or not stat.S_ISREG(before.st_mode): raise ValueError('not a regular file')",
        `  if before.st_size <= 0 or before.st_size > ${WORKSPACE_FILE_MAX_BYTES}: raise ValueError('invalid file size')`,
        "  canonical=os.path.realpath(candidate)",
        "  if os.path.commonpath([root,canonical]) != root: raise PermissionError('outside workspace')",
        "  flags=os.O_RDONLY|getattr(os,'O_NOFOLLOW',0)",
        "  source=os.open(candidate,flags)",
        `  target=os.open(${JSON.stringify(snapshotPath)},os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,'O_NOFOLLOW',0),0o600)`,
        "  try:",
        "    opened=os.fstat(source)",
        "    if (opened.st_dev,opened.st_ino,opened.st_size)!=(before.st_dev,before.st_ino,before.st_size): raise RuntimeError('file changed')",
        "    copied=0; digest=hashlib.sha256()",
        "    while True:",
        "      chunk=os.read(source,1024*1024)",
        "      if not chunk: break",
        "      copied+=len(chunk)",
        `      if copied>${WORKSPACE_FILE_MAX_BYTES}: raise ValueError('file too large')`,
        "      digest.update(chunk)",
        "      os.write(target,chunk)",
        "    os.fsync(target)",
        "    after=os.fstat(source)",
        "    if copied!=before.st_size or (after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns)!=(before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns): raise RuntimeError('file changed')",
        "  finally:",
        "    os.close(source); os.close(target)",
        "  print(json.dumps({'ok':True,'path':" + JSON.stringify(snapshotPath) + ",'size':before.st_size,'name':os.path.basename(canonical),'sha256':digest.hexdigest()}))",
        "except Exception as error:",
        `  try: os.unlink(${JSON.stringify(snapshotPath)})`,
        "  except OSError: pass",
        "  print(json.dumps({'ok':False,'error':str(error)})); sys.exit(2)",
    ].join("\n");
    const encodedScript = Buffer.from(script, "utf8").toString("base64");
    const snapshot = await runCommand(cfg, box.id, `python3 -c "$(printf %s ${encodedScript} | base64 -d)"`, { timeoutMs: 60_000 });
    if (!snapshot.ok) {
        await runCommand(cfg, box.id, `rm -f -- ${snapshotPath}`, { timeoutMs: 15_000 }).catch(() => { });
        throw Object.assign(new Error("cloud workspace file could not be opened safely"), { status: 404 });
    }
    try {
        let metadata;
        try {
            metadata = JSON.parse(snapshot.stdout.trim().split("\n").at(-1) ?? "null");
        }
        catch {
            throw Object.assign(new Error("cloud workspace returned invalid file metadata"), { status: 502 });
        }
        if (!metadata?.ok ||
            metadata.path !== snapshotPath ||
            !Number.isSafeInteger(metadata.size) ||
            metadata.size <= 0 ||
            metadata.size > WORKSPACE_FILE_MAX_BYTES ||
            typeof metadata.name !== "string" ||
            !metadata.name ||
            metadata.name.length > 180 ||
            /[\u0000-\u001f\u007f/\\]/.test(metadata.name) ||
            typeof metadata.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(metadata.sha256)) {
            throw Object.assign(new Error("cloud workspace returned unsafe file metadata"), { status: 502 });
        }
        const { ok, body } = await boxJson(cfg, `/boxes/${box.id}/files?path=${encodeURIComponent(snapshotPath)}&encoding=base64`);
        const encoded = body?.content;
        const maxEncodedLength = Math.ceil((metadata.size * 4) / 3) + 8;
        if (!ok || typeof encoded !== "string" || encoded.length > maxEncodedLength) {
            throw Object.assign(new Error("cloud workspace snapshot could not be read"), { status: 502 });
        }
        const bytes = Buffer.from(encoded, "base64");
        if (bytes.length !== metadata.size) {
            throw Object.assign(new Error("cloud workspace snapshot size changed"), { status: 409 });
        }
        if (createHash("sha256").update(bytes).digest("hex") !== metadata.sha256) {
            throw Object.assign(new Error("cloud workspace snapshot content changed"), { status: 409 });
        }
        return { name: metadata.name, bytes, source: "cloud" };
    }
    finally {
        await runCommand(cfg, box.id, `rm -f -- ${snapshotPath}`, { timeoutMs: 15_000 }).catch(() => { });
    }
}
/** Wake the bot's box and return a FRESH desktop URL. */
export async function joinBox(cfg, botId) {
    const box = await findBox(cfg, botId);
    if (!box)
        throw new Error("no computer yet — provision it first");
    const ready = await waitReady(cfg, box.id);
    if (!ready)
        throw new Error("the box did not wake in time — try again");
    return { joinUrl: await mintDesktopUrl(cfg, box.id), state: ready.state ?? null };
}
/** Archive the bot's box now (billing pauses, disk survives). */
export async function sleepBox(cfg, botId) {
    const box = await findBox(cfg, botId);
    if (!box)
        throw new Error("no computer for this bot");
    await boxJson(cfg, `/boxes/${box.id}/stop`, { method: "POST" }).catch(() => { });
    return { ok: true };
}
/**
 * Best-effort billing cleanup used while the durable bot identity still
 * exists. One deadline covers both the owner-scoped lookup and `/stop`, so an
 * unavailable substrate can never hold deletion open indefinitely. Every Box
 * is also created with a provider-side TTL; that TTL remains the final
 * backstop when this request cannot reach the provider.
 *
 * The result is deliberately safe to expose to a client or log: it contains
 * neither the provider token nor the provider's potentially sensitive error
 * body. `stop-requested` is precise — archiving completes asynchronously.
 */
export async function archiveBoxForBotDeletion(cfg, botId, options = {}) {
    if (!boxConfigured(cfg))
        return { outcome: "not-configured" };
    const timeoutMs = options.timeoutMs ?? BOX_DELETE_CLEANUP_TIMEOUT_MS;
    const signal = options.signal ?? AbortSignal.timeout(timeoutMs);
    const warning = "Cloud computer stop could not be confirmed; its provider-side TTL remains the cleanup backstop.";
    try {
        const listed = await findBoxResult(cfg, botId, { signal });
        if (!listed.ok)
            return { outcome: "warning", warning };
        const ownedBox = listed.ownedBox;
        if (!ownedBox)
            return { outcome: "not-found" };
        return await archiveBoxByIdForDeletion(cfg, String(ownedBox.id ?? ""), { signal });
    }
    catch {
        return { outcome: "warning", warning };
    }
}
/** Stop the exact Box returned by a provisioning request that outlived its
 * deleted owner. This avoids a second deterministic-name lookup accidentally
 * targeting a replacement owner's computer. */
export async function archiveBoxByIdForDeletion(cfg, boxId, options = {}) {
    if (!boxConfigured(cfg))
        return { outcome: "not-configured" };
    const warning = "Cloud computer stop could not be confirmed; its provider-side TTL remains the cleanup backstop.";
    if (!boxId || boxId.length > 512 || /[\u0000-\u001f\u007f]/.test(boxId))
        return { outcome: "warning", warning };
    const signal = options.signal ?? AbortSignal.timeout(options.timeoutMs ?? BOX_DELETE_CLEANUP_TIMEOUT_MS);
    try {
        const stopped = await boxJson(cfg, `/boxes/${encodeURIComponent(boxId)}/stop`, { method: "POST", signal });
        return stopped.ok ? { outcome: "stop-requested" } : { outcome: "warning", warning };
    }
    catch {
        return { outcome: "warning", warning };
    }
}
/** Best-effort compensation when durable bot deletion rolls back after its Box
 * stop was accepted. The same bounded, redacted contract as cleanup applies. */
export async function resumeBoxAfterDeletionRollback(cfg, botId, options = {}) {
    if (!boxConfigured(cfg))
        return { outcome: "not-configured" };
    const warning = "Cloud computer resume could not be confirmed after deletion rollback.";
    const signal = options.signal ?? AbortSignal.timeout(options.timeoutMs ?? 10_000);
    try {
        for (;;) {
            const listed = await findBoxResult(cfg, botId, { signal });
            if (!listed.ok)
                return { outcome: "warning", warning };
            const ownedBox = listed.ownedBox;
            if (!ownedBox)
                return { outcome: "not-found" };
            if (READY.has(ownedBox.state))
                return { outcome: "resume-requested" };
            if (ownedBox.state === "archived") {
                const resumed = await boxJson(cfg, `/boxes/${encodeURIComponent(String(ownedBox.id))}/resume`, { method: "POST", signal });
                return resumed.ok ? { outcome: "resume-requested" } : { outcome: "warning", warning };
            }
            // The provider rejects resume while its snapshot is still archiving.
            // Poll under the shared deadline, then resume only once archived.
            await new Promise((resolve, reject) => {
                const timer = setTimeout(resolve, 500);
                const abort = () => {
                    clearTimeout(timer);
                    reject(signal.reason ?? new Error("Box rollback resume timed out"));
                };
                if (signal.aborted)
                    abort();
                else
                    signal.addEventListener("abort", abort, { once: true });
            });
        }
    }
    catch {
        return { outcome: "warning", warning };
    }
}
/** Owner-scoped shell for the Computer panel's console. */
export async function execOnBox(cfg, botId, command) {
    const box = await findBox(cfg, botId);
    if (!box)
        throw new Error("no computer for this bot yet");
    const ready = await waitReady(cfg, box.id, 60_000);
    if (!ready)
        throw new Error("box did not wake");
    const out = await runCommand(cfg, box.id, String(command ?? "").slice(0, 4000));
    return { exitCode: out.exitCode, stdout: out.stdout.slice(-4000), stderr: out.stderr.slice(-2000) };
}
// Screenshot for the Computer panel + screen-in-chat. Two hops, both
// deterministic: capture to a file on the box (scrot/import/ffmpeg chain,
// downscaled), then read it back via the files API with encoding=base64.
// Base64 over command stdout is NOT reliable (probed 2026-08-12: an
// otherwise-complete payload came back with a corrupted length) — never
// ship binary through the commands endpoint.
function screenshotCommand(snapshotPath) {
    return [
        "export DISPLAY=${DISPLAY:-:0}",
        `f=${snapshotPath}`,
        'scrot -o "$f" 2>/dev/null || import -window root "$f" 2>/dev/null || ffmpeg -y -f x11grab -i "$DISPLAY" -frames:v 1 "$f" >/dev/null 2>&1',
        'command -v convert >/dev/null && convert "$f" -resize 1024x "$f" 2>/dev/null || true',
        'test -s "$f" && echo captured',
    ].join("; ");
}
function decodeScreenshotPng(encoded) {
    if (typeof encoded !== "string" || encoded.length === 0)
        throw new Error("could not read the frame back from the box");
    const maxEncodedLength = Math.ceil(SCREENSHOT_MAX_BYTES / 3) * 4;
    if (encoded.length > maxEncodedLength ||
        encoded.length % 4 !== 0 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
        throw new Error("the cloud screenshot is not canonical base64");
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.length === 0 || bytes.length > SCREENSHOT_MAX_BYTES || bytes.toString("base64") !== encoded) {
        throw new Error("the cloud screenshot has an invalid size or encoding");
    }
    const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (bytes.length < 24 ||
        !bytes.subarray(0, 8).equals(pngMagic) ||
        bytes.readUInt32BE(8) !== 13 ||
        bytes.toString("ascii", 12, 16) !== "IHDR")
        throw new Error("the cloud screenshot is not a PNG image");
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (width === 0 || height === 0 ||
        width > SCREENSHOT_MAX_DIMENSION || height > SCREENSHOT_MAX_DIMENSION ||
        width * height > SCREENSHOT_MAX_PIXELS)
        throw new Error("the cloud screenshot dimensions are unsafe");
    return bytes;
}
export async function screenshotBox(cfg, botId) {
    const box = await findBox(cfg, botId);
    if (!box)
        throw new Error("no computer for this bot yet");
    if (!READY.has(box.state))
        throw new Error(`box is ${box.state}`);
    const snapshotPath = `/tmp/cumea-panel-${randomBytes(18).toString("hex")}.png`;
    try {
        const out = await runCommand(cfg, box.id, screenshotCommand(snapshotPath), { timeoutMs: 60_000 });
        if (!/captured/.test(out.stdout)) {
            throw new Error(out.stderr.slice(0, 200) || "screen capture failed on the box");
        }
        const { ok, body } = await boxJson(cfg, `/boxes/${box.id}/files?path=${encodeURIComponent(snapshotPath)}&encoding=base64`);
        if (!ok)
            throw new Error("could not read the frame back from the box");
        const png = decodeScreenshotPng(body?.content).toString("base64");
        return { png, format: "png" };
    }
    finally {
        await runCommand(cfg, box.id, `rm -f -- ${snapshotPath}`, { timeoutMs: 15_000 }).catch(() => { });
    }
}
