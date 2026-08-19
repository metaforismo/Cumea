import { readFileSync, writeFileSync } from "node:fs";

function block(lines) {
  return lines.join("\n");
}

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || first !== source.lastIndexOf(before)) {
    throw new Error(label + ": expected exactly one anchor");
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

let todo = readFileSync("TODO.md", "utf8");

todo = replaceOnce(
  todo,
  block([
    '- [ ] **P0.05 — Renderer update isolation.** Split the global state subscription into selectors,',
    '  isolate and memoize composer/transcript boundaries, batch streaming deltas, lazy-load noncritical',
    '  panels, defer Markdown / syntax work until messages settle, and cache settled rendering by content',
    '  hash instead of re-highlighting unchanged code during every stream tick.',
  ]),
  block([
    '- [ ] **P0.05 — Renderer update isolation.** Split the global state subscription into selectors,',
    '  isolate and memoize composer/transcript boundaries, batch streaming deltas, lazy-load noncritical',
    '  panels, defer Markdown / syntax work until messages settle, and cache settled rendering by content',
    '  hash instead of re-highlighting unchanged code during every stream tick.',
    '  - [ ] P0.05a — Extend packaged performance evidence beyond launch: measure keydown→paint typing,',
    '    real reducer/SSE streaming, settings paint/settle, and idle CPU/working-set memory on bounded',
    '    transcripts. Keep runtime numbers informational until the fixed-Mac gate exists.',
  ]),
  "P0.05",
);

todo = replaceOnce(
  todo,
  block([
    '- [ ] **P0.06 — Desktop conversation paging and scroll contract.** Load bounded pages, window long',
    '  transcripts, preserve the reading position while prepending history, auto-follow only near the end,',
    '  expose jump-to-latest / show-earlier affordances, and render very long user messages cheaply without',
    '  forcing scroll during selection.',
  ]),
  block([
    '- [ ] **P0.06 — Desktop conversation paging and scroll contract.** Load bounded pages, window long',
    '  transcripts, preserve the reading position while prepending history, auto-follow only near the end,',
    '  expose jump-to-latest / show-earlier affordances, and render very long user messages cheaply without',
    '  forcing scroll during selection.',
    '  - [ ] P0.06a — Window mounted transcript rows independently from server paging, preserve an anchor',
    '    across prepend and search-window transitions, and prove selection/copy and near-bottom auto-follow',
    '    behavior on long threads before increasing default page sizes.',
  ]),
  "P0.06",
);

todo = replaceOnce(
  todo,
  block([
    '  - [ ] P0.10a — Add optional same-LAN Bonjour/mDNS host discovery and QR onboarding convenience **before**',
    '    the existing one-time cryptographic pairing; discovery metadata is never authentication and manual',
    '    URL/QR entry remains supported.',
  ]),
  block([
    '  - [ ] P0.10a — Add optional same-LAN Bonjour/mDNS discovery **before** cryptographic pairing, rank',
    '    real interfaces ahead of tunnels/bridges, advertise per interface, re-advertise/withdraw on network',
    '    changes, and return a bounded ordered host-candidate list at pairing. The client rotates only on',
    '    transport/address failures (never 401), persists the working candidate, supports manual address',
    '    edits without losing the device token, and keeps discovery metadata strictly non-authenticating.',
  ]),
  "P0.10a",
);

todo = replaceOnce(
  todo,
  block([
    '- [ ] **P1.01 — Separate Agent, Conversation, and Memory.** Give one persistent agent multiple named,',
    '  archivable conversations with fresh-context creation, search, export, durable identity, and a global',
    '  keyboard navigation/search surface once P0.11 provides the local transcript index.',
  ]),
  block([
    '- [ ] **P1.01 — Separate Agent, Conversation, and Memory.** Give one persistent agent multiple named,',
    '  archivable conversations with fresh-context creation, search, export, durable identity, and a global',
    '  keyboard navigation/search surface once P0.11 provides the local transcript index.',
    '  - [ ] P1.01a — Add New conversation / archive / clear-conversation semantics without deleting the',
    '    agent identity, its settings or its memories. Destructive clear must target one conversation and',
    '    retain export/recovery confirmation rather than being the only way to get fresh context.',
  ]),
  "P1.01",
);

todo = replaceOnce(
  todo,
  block([
    '- [ ] **P1.06 — Explicit memory.** Add personal, agent, project, and conversation scopes with source',
    '  provenance, revision history, confirmation state, priority, expiry, inspection, editing, deletion,',
    '  explicit prompt-load budgets, and user-visible topic/projection views instead of opaque hidden notes.',
  ]),
  block([
    '- [ ] **P1.06 — Explicit memory.** Add personal, agent, project, and conversation scopes with source',
    '  provenance, revision history, confirmation state, priority, expiry, inspection, editing, deletion,',
    '  explicit prompt-load budgets, and user-visible topic/projection views instead of opaque hidden notes.',
    '  - [ ] P1.06a — Add owner-local bounded history compaction: summarize old canonical batches with',
    '    provenance/cursors and time/input limits, never advance on failed/empty summaries, shrink verbatim',
    '    history only after recall succeeds, mark recalled material as possibly stale data, and allow optional',
    '    external memory adapters only after the local contract is complete.',
  ]),
  "P1.06",
);

todo = replaceOnce(
  todo,
  block([
    '- [ ] **P1.12 — Pluggable user-owned computer backends.** Put local CUA and the existing cloud-computer',
    '  path behind one conformance-tested backend contract, then allow optional Docker / E2B / Daytona-',
    '  compatible implementations without making a Cumea-managed sandbox or cloud service mandatory.',
    '  Model per-agent private and explicitly shared/team computers separately and report capabilities /',
    '  degradation honestly.',
  ]),
  block([
    '- [ ] **P1.12 — Pluggable user-owned computer backends.** Put local CUA and the existing cloud-computer',
    '  path behind one conformance-tested backend contract, then allow optional Docker / E2B / Daytona-',
    '  compatible implementations without making a Cumea-managed sandbox or cloud service mandatory.',
    '  Model per-agent private and explicitly shared/team computers separately and report capabilities /',
    '  degradation honestly.',
    '  - [ ] P1.12a — Add the backend conformance suite and a user-owned BYO-VPS implementation using a',
    '    preconfigured SSH alias / Docker transport: no app-stored private key, no auto-accepted host key,',
    '    no public container ports, explicit transport-vs-missing states, bounded status/lock timeouts,',
    '    hardened managed-container verification, disposable-filesystem copy, and no SSH alias on mobile.',
    '  - [ ] P1.12b — Add explicit Team/Project computer scope distinct from Private agent computers. Shared',
    '    files and graphical-session capability are separate; each run gets a fenced display/session lease,',
    '    stale claims are rejected, and completion/rollback/takeover release the exact lease deterministically.',
    '  - [ ] P1.12c — After the generic backend contract is stable, evaluate an explicitly paired user-owned',
    '    phone/device backend (for example USB Android) as an agent computer. Keep it separate from the',
    '    companion control surface and require the same capability/permission/lease evidence as other backends.',
  ]),
  "P1.12",
);

const lastLog = '| 2026-08-19 | P0.12a | Added activity-based lifecycle projections, explicit waiting-on-human exemption, advisory no-signal/dead recovery, bounded repeated-effect detection, provider-vs-lifecycle attention ownership, semantic-only Workspace persistence, and Work/Needs You recovery UX. P0.12 is complete. |';
todo = replaceOnce(
  todo,
  lastLog,
  lastLog + '\n| 2026-08-19 | Competitive audit | Re-pinned Cumea `ea3d751b`, Rakazo `c3d386d8`, and OpenMausBot `70805c0a`; promoted conversation separation, local history compaction, steady-state renderer evidence, resilient companion candidate rotation, BYO-VPS, and fenced Team/Private computer semantics without adopting mandatory hosted identity/control-plane assumptions. |',
  "execution log",
);

writeFileSync("TODO.md", todo);

let readme = readFileSync("README.md", "utf8");
readme = replaceOnce(
  readme,
  block([
    'P0.11 is complete, so the immediate engineering priorities have shifted from transcript storage to',
    '**runtime diagnostics, draft-#9 extraction, steady-state renderer/thread scaling, lifecycle correctness,',
    'mobile completion, package closure, and provider/computer capability parity**. The first small tranche is',
    'a desktop-local per-thread Events/Raw inspector over logs Cumea already writes; raw provider material must',
    'remain outside the paired mobile surface.',
    '',
    'The current competitive audit is pinned to Cumea `4b897646`, Rakazo `9622c388`, and OpenMausBot',
    '`e7d71f4b`. It adopts ideas such as bounded diagnostics, engine-session freshness, busy-user steering,',
    'app-wide keyboard/reduced-motion treatment, trusted connector continuation, discovery-before-pairing,',
    'and package spawn-closure checks while explicitly rejecting mandatory hosted identity or a Cumea-operated',
    'control plane.',
  ]),
  block([
    'P0.11 and P0.12 are complete, so the immediate priorities are **draft-#9 extraction, steady-state',
    'renderer/thread scaling, resilient mobile completion, conversation/memory separation, package/release',
    'evidence, and a pluggable user-owned computer contract**. Storage, session freshness, busy steering and',
    'lifecycle evidence are foundations to preserve, not features to rewrite.',
    '',
    'The current competitive audit is pinned to Cumea `ea3d751b`, Rakazo `c3d386d8`, and OpenMausBot',
    '`70805c0a`. It adapts conversation reset into multi-conversation agents, hosted-memory compaction into an',
    'owner-local provenance-first memory contract, Team/Private computer screens into fenced run leases, and',
    'BYO-VPS / resilient host discovery into user-owned backend and transport contracts. Mandatory hosted',
    'identity, a Cumea-operated control plane, and hosted memory remain outside the local default.',
  ]),
  "README direction",
);
readme = replaceOnce(
  readme,
  block([
    'See [ROADMAP.md](ROADMAP.md) for the ordered backlog,',
    '[the 2026-08-18 Rakazo/OpenMaus engineering audit](docs/competitive-audit-2026-08-18.md) for the latest',
    '`adopt / adapt / reject` decisions, and [docs/UPSTREAM.md](docs/UPSTREAM.md) for the earlier upstream',
    'issue/PR audit.',
  ]),
  block([
    'See [ROADMAP.md](ROADMAP.md) for the ordered backlog,',
    '[the 2026-08-19 Rakazo/OpenMaus engineering audit](docs/competitive-audit-2026-08-19.md) for the latest',
    '`adopt / adapt / reject` decisions, [the 2026-08-18 audit](docs/competitive-audit-2026-08-18.md) for the',
    'previous pin, and [docs/UPSTREAM.md](docs/UPSTREAM.md) for the earlier upstream issue/PR audit.',
  ]),
  "README audit link",
);
writeFileSync("README.md", readme);

let changelog = readFileSync("CHANGELOG.md", "utf8");
changelog = replaceOnce(
  changelog,
  block([
    '- Re-audited Cumea `4b897646` against Rakazo `9622c388` and OpenMausBot `e7d71f4b`. With transcript',
    '  persistence/search now complete, the explicit next gates are local Runtime/Raw diagnostics, focused',
    '  draft-#9 extraction, steady-state renderer/thread scale, app-wide focus/reduced-motion behavior,',
    '  session freshness, busy-user steering, package spawn closure, trusted connector continuation,',
    '  mobile discovery/notifications, provider onboarding, inspectable memory, and bounded subagents.',
    '  Mandatory hosted identity/control-plane assumptions remain out of scope for the local default.',
  ]),
  block([
    '- Re-audited Cumea `ea3d751b` against Rakazo `c3d386d8` and OpenMausBot `70805c0a` after P0.12.',
    '  Newly explicit gaps are Agent→Conversations separation, owner-local bounded history compaction,',
    '  steady-state typing/streaming/idle evidence, resilient mobile host-candidate rotation, BYO-VPS, and',
    '  fenced Team/Private computer sessions. Cumea keeps SQLite/local identity as the default and does not',
    '  adopt mandatory Better Auth/Postgres, hosted memory, or a Cumea-operated control plane.',
  ]),
  "CHANGELOG audit",
);
writeFileSync("CHANGELOG.md", changelog);
