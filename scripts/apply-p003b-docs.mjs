import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  const last = source.lastIndexOf(needle);
  if (first < 0 || first !== last) throw new Error(`${label}: expected exactly one match`);
  return `${source.slice(0, first)}${replacement}${source.slice(first + needle.length)}`;
}

function replaceRegexOnce(source, pattern, replacement, label) {
  const matches = source.match(pattern);
  if (!matches || matches.length !== 1) throw new Error(`${label}: expected exactly one match`);
  return source.replace(pattern, replacement);
}

// TODO.md
{
  const file = "TODO.md";
  let text = readFileSync(file, "utf8");
  text = replaceOnce(
    text,
    `  - [~] P0.03a — Put a stable loopback desktop gateway in front of the packaged UI/API, paint the\n    renderer before harness readiness, proxy SSE/API only after a verified child is available, keep\n    renderer origin stable for \`localStorage\`, reject rebound Host values on the renderer gateway,\n    and defer CUA SDK/TCC/socket work until first use.`,
    `  - [x] P0.03a — Put a stable loopback desktop gateway in front of the packaged UI/API, paint the\n    renderer before harness readiness, proxy SSE/API only after a verified child is available, keep\n    renderer origin stable for \`localStorage\`, reject rebound Host values on the renderer gateway,\n    and defer CUA SDK/TCC/socket work until first use.`,
    "P0.03a status",
  );
  text = replaceRegexOnce(
    text,
    /  - \[ \] P0\.03b — Move the harness to `CUMEA_PORT=0`, implement and test the versioned Electron\n    parent\/child readiness message beside the server listener that emits it, remove HTTP readiness\n    polling and fixed harness fallback ports, validate the private listener Host\/origin contract,\n    and preserve remote\/mobile listener semantics independently of the local ephemeral port\./,
    `  - [x] P0.03b — Move packaged Electron harnesses to \`CUMEA_PORT=0\`, publish the actual bound\n    port over a versioned UtilityProcess parent/child readiness message, remove HTTP readiness polling\n    and fixed private fallback ports, validate the private local listener Host/origin contract, and\n    keep remote/mobile listener port semantics independent of the local ephemeral port.`,
    "P0.03b status",
  );
  text = replaceOnce(
    text,
    `| 2026-08-17 | P0.03a | Began separating renderer paint from harness readiness with a stable loopback UI/API gateway, streamed proxying, bounded unavailable states, and lazy local-computer initialization; OS-assigned harness IPC remains P0.03b. |`,
    `| 2026-08-17 | P0.03a | Separated renderer paint from harness readiness with a stable loopback UI/API gateway, streamed proxying, bounded unavailable states, and lazy local-computer initialization. |\n| 2026-08-17 | P0.03b | Replaced packaged harness polling/fallback ports with an OS-assigned private listener and exact-PID UtilityProcess readiness message; hardened the private listener Host/origin boundary and kept remote listener ports independent. |`,
    "P0.03 execution log",
  );
  writeFileSync(file, text);
}

// docs/desktop-startup.md
{
  const file = "docs/desktop-startup.md";
  let text = readFileSync(file, "utf8");
  text = replaceRegexOnce(
    text,
    /## P0\.03a startup sequence[\s\S]*?## Harness restart contract/,
    `## Current packaged startup sequence\n\nThe packaged sequence after P0.03b is:\n\n\`\`\`text\nElectron ready\n→ initialize packaged credential-storage boundary\n→ register display/CUA IPC\n→ write a harmless lazy-CUA descriptor\n→ bind stable desktop gateway :8799\n→ create + navigate BrowserWindow\n→ fork local harness with CUMEA_PORT=0\n→ bind optional remote listener on its independent configured/default port\n→ bind local harness on an OS-assigned loopback port\n→ child posts {kind, version, pid, port} through UtilityProcess parentPort\n→ parent validates exact child PID + bounded port\n→ gateway attaches to that private port\n→ EventSource reconnects and canonical state hydrates\n\`\`\`\n\nThe renderer therefore does not wait for provider discovery or harness readiness before it can paint.\n\nWhile no validated harness is attached the gateway exposes only one of three fixed public states:\n\n\`\`\`text\nagent host is starting\nagent host is restarting\nagent host could not start\n\`\`\`\n\nInternal child diagnostics, filesystem paths, and provider errors are not projected through this pre-readiness surface.\n\n### OS-assigned private listener and readiness IPC\n\nPackaged Electron no longer discovers readiness by polling \`/api/health\` or cycling predictable private fallback ports. The child asks the operating system for port zero, reads the actual bound TCP port, and publishes one versioned message only after the local listener is listening.\n\nThe parent ignores unrelated messages and requires:\n\n- readiness kind \`cumea:harness-ready\`;\n- protocol version \`1\`;\n- \`message.pid === utilityProcess.pid\`;\n- an integer port in \`1..65535\`;\n- no child exit before readiness;\n- completion within the bounded readiness timeout.\n\nThe private local listener itself accepts only an exact numeric-loopback/localhost Host for its actual bound port. Mutating browser Origins are restricted to that actual private origin or the explicit Vite development origin. Vite uses \`changeOrigin: true\` so strict backend Host validation remains compatible with source development.\n\nThe optional remote/mobile listener keeps its own explicit port (default \`8800\`) and binds independently before the ephemeral local listener. It is no longer derived from the private local port.\n\nThe health endpoint remains useful for diagnostics and package identity, but it is no longer the desktop startup readiness control plane.\n\n## Harness restart contract`,
    "desktop startup sequence",
  );
  text = text.replace(
    "P0.03a changes what can paint before the harness is ready.",
    "P0.03 changes what can paint before the harness is ready.",
  );
  text = text.replace(
    "P0.03a intentionally does not claim:\n\n- an OS-assigned harness port;\n- parent/child readiness messaging in production;\n- complete direct-harness DNS-rebinding hardening before the P0.03b listener rewrite;\n- atomic renderer bootstrap;",
    "The completed P0.03a/P0.03b startup work intentionally does not claim:\n\n- atomic renderer/application bootstrap;",
  );
  writeFileSync(file, text);
}

// docs/performance.md
{
  const file = "docs/performance.md";
  let text = readFileSync(file, "utf8");
  text = text.replaceAll("P0.03a", "P0.03");
  text = replaceOnce(
    text,
    "| `main.server-startup` | asynchronous packaged harness startup request → verified harness readiness |",
    "| `main.server-startup` | packaged UtilityProcess fork/start request → validated exact-PID readiness message carrying the actual bound local port |",
    "server startup metric",
  );
  text = text.replace(
    "P0.03b will also change the harness readiness mechanism from HTTP polling/fixed fallback ports to an\nOS-assigned port plus parent/child message. ",
    "P0.03b changed the harness readiness mechanism from HTTP polling/fixed fallback ports to an OS-assigned port plus exact-PID parent/child message. ",
  );
  writeFileSync(file, text);
}

// CHANGELOG.md
{
  const file = "CHANGELOG.md";
  let text = readFileSync(file, "utf8");
  text = replaceRegexOnce(
    text,
    /- P0\.03 is split into independently reviewable startup gates\.[\s\S]*?claimed before fixed-machine evidence exists\./,
    `- P0.03 now keeps the stable renderer gateway while the packaged harness uses an OS-assigned private\n  port. Readiness is published over a versioned exact-PID UtilityProcess message instead of HTTP\n  polling/fixed fallback ports. The optional remote listener keeps an independent explicit/default\n  port. No startup performance improvement is claimed before fixed-machine evidence exists.`,
    "changelog startup change",
  );
  text = replaceRegexOnce(
    text,
    /- The packaged desktop gateway binds loopback only,[\s\S]*?P0\.03b listener\/handshake rewrite and is not covered by a stronger claim here\./,
    `- The packaged desktop gateway binds loopback only, requires its exact numeric loopback \`Host\`,\n  constrains decoded static paths, strips static and connection-named hop-by-hop headers, reasserts\n  security headers, and translates only its own renderer Origin. The OS-assigned private harness\n  listener now also validates its exact local Host/origin boundary before serving requests.`,
    "changelog listener security",
  );
  writeFileSync(file, text);
}
