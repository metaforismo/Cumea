import { randomInt } from "node:crypto";

const FIXED_PORTS = [8799, 18799, 28799];
const DYNAMIC_PORT_MIN = 49_152;
const DYNAMIC_PORT_MAX_EXCLUSIVE = 65_534;

export function serverCandidatePorts(count = 12, choose = randomInt) {
  const ports = new Set(FIXED_PORTS);
  while (ports.size < FIXED_PORTS.length + count) {
    ports.add(choose(DYNAMIC_PORT_MIN, DYNAMIC_PORT_MAX_EXCLUSIVE));
  }
  return [...ports];
}

export function classifyServerFailure(log, fallback = "server-exited") {
  const text = String(log ?? "");
  if (/EADDRINUSE|address already in use|bind\(\).*failed/i.test(text)) {
    return { kind: "port-in-use", detail: "The selected loopback port is already in use." };
  }
  const missingPackage = text.match(/Cannot find package ['\"]([^'\"]+)['\"]/i)?.[1];
  if (missingPackage) {
    return {
      kind: "missing-runtime",
      detail: `The packaged server is missing its ${missingPackage} runtime dependency.`,
    };
  }
  if (/ERR_MODULE_NOT_FOUND/i.test(text)) {
    return { kind: "missing-runtime", detail: "The packaged server is missing a runtime module." };
  }
  return { kind: fallback, detail: "The bundled agent server exited before it became ready." };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function startupErrorPage(failure = { kind: "server-exited", detail: "The bundled agent server did not start." }) {
  const guidance = failure.kind === "missing-runtime"
    ? "This build is incomplete. Install the latest Cumea build; restarting your Mac will not repair it."
    : failure.kind === "port-in-use"
      ? "Cumea tried several private loopback ports. Quit any older Cumea instance and reopen the app."
      : "Quit and reopen Cumea. If the problem returns, reinstall the latest build and include this diagnostic in the issue.";
  return (
    "data:text/html;charset=utf-8," +
    encodeURIComponent(
      `<body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#070707;color:#fcfcfc;font:15px -apple-system,system-ui"><div style="text-align:center;max-width:430px;padding:32px"><div style="font-size:40px">◉</div><h2 style="font-weight:600;margin:12px 0 6px">Couldn't start the agent server</h2><p style="color:#fcfcfca8;line-height:1.55;margin:0 0 10px">${escapeHtml(guidance)}</p><p style="color:#fcfcfc70;line-height:1.45;margin:0;font-size:13px">${escapeHtml(failure.detail)}</p></div></body>`,
    )
  );
}
