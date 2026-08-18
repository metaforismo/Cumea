import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(path, needle, replacement, label) {
  const source = readFileSync(path, "utf8");
  const first = source.indexOf(needle);
  if (first < 0 || first !== source.lastIndexOf(needle)) throw new Error(`${label}: expected one match`);
  writeFileSync(path, source.slice(0, first) + replacement + source.slice(first + needle.length));
}

replaceOnce(
  "TODO.md",
  '  - [ ] P1.11a — Add a desktop-local per-thread **Events / Raw** diagnostics lens over existing `events/`\n',
  '  - [x] P1.11a — Add a desktop-local per-thread **Events / Raw** diagnostics lens over existing `events/`\n',
  "P1.11a status",
);
replaceOnce(
  "TODO.md",
  '| 2026-08-18 | Competitive audit refresh | Re-pinned Cumea `4b897646`, Rakazo `9622c388`, and OpenMausBot `e7d71f4b`; promoted raw diagnostics, draft-#9 extraction, app-wide accessibility, session freshness, busy steering, package spawn closure, connector continuation, mobile discovery/notifications, provider onboarding, and bounded subagents into explicit gates without weakening the local/privacy model. |',
  '| 2026-08-18 | Competitive audit refresh | Re-pinned Cumea `4b897646`, Rakazo `9622c388`, and OpenMausBot `e7d71f4b`; promoted raw diagnostics, draft-#9 extraction, app-wide accessibility, session freshness, busy steering, package spawn closure, connector continuation, mobile discovery/notifications, provider onboarding, and bounded subagents into explicit gates without weakening the local/privacy model. |\n| 2026-08-18 | P1.11a | Added a desktop-local bounded Runtime inspector over existing normalized and secret-redacted native thread logs, with Events/Raw lenses, payload clipping, torn-line tolerance, real-harness local/no-store evidence, authenticated mobile denial, and right-slot UI integration. |',
  "P1.11a execution log",
);

replaceOnce(
  "README.md",
  '- durable tasks, runs, tool steps, handoffs, artifacts, transcripts, configuration, and event logs.\n',
  '- durable tasks, runs, tool steps, handoffs, artifacts, transcripts, configuration, and event logs;\n- a desktop-local Runtime inspector with bounded Events and Raw provider diagnostics for the active agent.\n',
  "README inspector feature",
);
replaceOnce(
  "README.md",
  '| `server/harness/` | provider registry and event bus |\n',
  '| `server/harness/` | provider registry and event bus |\n| `server/thread-inspector.ts` | bounded owner-local Runtime/Raw diagnostic projection over existing per-thread logs |\n',
  "README inspector architecture",
);
replaceOnce(
  "README.md",
  '[canonical transcript persistence](docs/transcript-persistence.md).\n',
  '[canonical transcript persistence](docs/transcript-persistence.md). The chat header also exposes a\ndesktop-local Runtime inspector over the existing normalized event log and secret-redacted native tee;\nthat diagnostic surface is bounded, `no-store`, excluded from search/export/bootstrap, and never added\nto the paired mobile API. See [runtime inspector](docs/runtime-inspector.md).\n',
  "README inspector privacy",
);

replaceOnce(
  "CHANGELOG.md",
  '  export. Search jumps do not load entire long conversations.\n',
  '  export. Search jumps do not load entire long conversations.\n- Added a desktop-local per-thread Runtime inspector over the existing normalized event stream and\n  secret-redacted native protocol tee, with bounded Events/Raw lenses, expandable JSON and periodic refresh.\n',
  "CHANGELOG inspector added",
);
replaceOnce(
  "CHANGELOG.md",
  '### Security\n\n- Exact transcript navigation and export remain desktop-local.',
  '### Security\n\n- Runtime/Raw diagnostics remain desktop-local and `no-store`; they are excluded from bootstrap,\n  transcript search/export and paired mobile routes. Normalized events drop `RuntimeEvent.raw`, while\n  native payloads are bounded before entering renderer state and large records become omission previews.\n- Exact transcript navigation and export remain desktop-local.',
  "CHANGELOG inspector security",
);

for (const [path, needles] of Object.entries({
  "TODO.md": ['- [x] P1.11a —', '| 2026-08-18 | P1.11a |'],
  "README.md": ['desktop-local Runtime inspector', '`server/thread-inspector.ts`', '[runtime inspector](docs/runtime-inspector.md)'],
  "CHANGELOG.md": ['desktop-local per-thread Runtime inspector', 'Runtime/Raw diagnostics remain desktop-local'],
})) {
  const source = readFileSync(path, "utf8");
  for (const needle of needles) if (!source.includes(needle)) throw new Error(`${path}: missing ${needle}`);
}
