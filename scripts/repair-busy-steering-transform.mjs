import { readFileSync, writeFileSync } from "node:fs";

const path = "scripts/apply-busy-steering.mjs";
let source = readFileSync(path, "utf8");

function replaceOnce(needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0 || first !== source.lastIndexOf(needle)) {
    throw new Error(`${label}: expected exactly one match`);
  }
  source = source.slice(0, first) + replacement + source.slice(first + needle.length);
}

replaceOnce(
  '    tool: { name: `queued steering failed: ${detail.slice(0, 140)}`, ok: false },',
  '    tool: { name: "queued steering failed: " + detail.slice(0, 140), ok: false },',
  "steering failure nested template",
);

replaceOnce(
  '              accessibilityLabel={working ? `Queue steering for ${agentName}` : "Send message"}',
  '              accessibilityLabel={working ? "Queue steering for " + agentName : "Send message"}',
  "mobile queue accessibility nested template",
);

replaceOnce(
  '  "apps/mobile/src/components/chat-composer.tsx": ["Queue steering for ${agentName}", "Steer ${agentName} after this turn"],',
  '  "apps/mobile/src/components/chat-composer.tsx": ["Queue steering for ", "Steer ${agentName} after this turn"],',
  "mobile invariant after queue label repair",
);

writeFileSync(path, source);
