# Upstream provenance and triage

## Provenance

Cumea started from [`milind-soni/OpenMausBot`](https://github.com/milind-soni/OpenMausBot) at
commit `dea4de8` on 2026-08-12. The upstream repository is MIT licensed. Cumea retains the complete
Git history, the original copyright notice, and an `upstream` remote for future comparison.

Cumea is otherwise independent. It uses its own name, bundle ID, data directory, configuration
namespace, security contact, releases, and governance. No OpenMausBot user data is imported.

## Review method

Open issues and pull requests were reviewed for user value, evidence, overlap, consent boundaries,
platform risk, and fit with Cumea's direction. “Adopt” below means the idea belongs in the roadmap;
it does not mean an upstream branch was merged without review.

## Pull-request decisions

| Upstream work | Decision | Reason |
|---|---|---|
| [#24 quit timeout](https://github.com/milind-soni/OpenMausBot/pull/24), [#25 stop speech](https://github.com/milind-soni/OpenMausBot/pull/25) | Reimplemented now | Small, high-impact lifecycle fixes; Cumea adds duplicate-quit protection and rejection handling. |
| [#21 reliability/privacy/CI](https://github.com/milind-soni/OpenMausBot/pull/21) | Audited and selectively reimplemented | Cumea adopted thread-scoped event IDs, UTF-8 process streams, bounded Codex RPC, provider-reload recovery, mention boundaries, fresh OAuth polling, and stronger atomic persistence. It did not copy the proposed invalid-JSON path, which can leave a promise unresolved, or reintroduce telemetry. |
| [#27 API-key guidance](https://github.com/milind-soni/OpenMausBot/pull/27) | Reimplemented now | Cumea adds keyboard-accessible help, current provider links, explicit billing/data-flow language, local URL validation, and least-privilege guidance. |
| [#32 Ubuntu beta](https://github.com/milind-soni/OpenMausBot/pull/32) | Candidate for P1 | Strongest Linux foundation and useful packaged evidence. It still needs rebase plus hands-on Wayland validation. |
| [#10 Windows hardening](https://github.com/milind-soni/OpenMausBot/pull/10) | Superseded/selective | Earlier design reference; its old-base conflicts and overlap were resolved through Cumea's shared process abstraction rather than merging the branch. |
| [#5](https://github.com/milind-soni/OpenMausBot/pull/5), [#7](https://github.com/milind-soni/OpenMausBot/pull/7), [#17](https://github.com/milind-soni/OpenMausBot/pull/17) Windows variants | #17 selectively reimplemented | After #17 merged as `d3c4c316b3f4e2a97c96022ba71f3473f6493486`, Cumea adopted CLI-shim resolution, process-tree termination, named pipes, Box protocol compatibility, and native title-bar treatment through its own tested abstraction. It added a per-turn broker secret and retained honest macOS-only computer-use/dictation degradation. No physical Windows package claim is made. |
| [#30 Antigravity](https://github.com/milind-soni/OpenMausBot/pull/30) | Merged upstream; not adopted | The merged driver defaults to full-auto because the protocol lacks a headless consent hook. That does not meet Cumea's default consent boundary, so merge status alone is not a reason to weaken approvals. |
| [#22 AI Counsel](https://github.com/milind-soni/OpenMausBot/pull/22) | Optional plugin candidate | Large external/homelab coupling and turn-continuity limitations do not belong in the core fleet. |
| [#31 morphing mascot](https://github.com/milind-soni/OpenMausBot/pull/31) | Defer | Polished work, but tightly coupled to the upstream identity while Cumea needs its own visual system. |
| [#33 icon grid](https://github.com/milind-soni/OpenMausBot/pull/33) | Reimplemented independently | Cumea's supplied artwork is padded for native icon masks without copying upstream art. |
| [#34 trial box TTL](https://github.com/milind-soni/OpenMausBot/pull/34), [#35 dictation locale](https://github.com/milind-soni/OpenMausBot/pull/35), [#36 connected-app prompt](https://github.com/milind-soni/OpenMausBot/pull/36), [#37 screen-frame gating](https://github.com/milind-soni/OpenMausBot/pull/37) | Reimplemented now | Small, bounded improvements that match Cumea's existing Box, speech, Composio, and computer-preview contracts. |
| [#38 pasted images](https://github.com/milind-soni/OpenMausBot/pull/38), [#39 per-bot drafts](https://github.com/milind-soni/OpenMausBot/pull/39), [#40 multiline composer](https://github.com/milind-soni/OpenMausBot/pull/40) | Adapted now | #39 and #40 are now merged upstream. Cumea already reuses its own attachment pipeline, clears drafts on agent switches, guards IME composition, and supports Shift+Enter in an auto-growing composer. |
| [#41 Windows CLI shims](https://github.com/milind-soni/OpenMausBot/pull/41), [#42 Windows permission pipe](https://github.com/milind-soni/OpenMausBot/pull/42), [#43 Windows process tree](https://github.com/milind-soni/OpenMausBot/pull/43), [#44 cross-platform user data](https://github.com/milind-soni/OpenMausBot/pull/44) | Consolidated/selective | #44 is now merged upstream. Cumea already resolves its CUA descriptor through Electron's exact `userData` path; the remaining useful CLI, named-pipe, and process-tree ideas are consolidated in `server/procs.ts` with authenticated broker handshakes. |
| [#45 message editing and branches](https://github.com/milind-soni/OpenMausBot/pull/45) | Reimplemented end to end | After #45 merged as `aac0cf212f9846350db66b71c8c69943de5c5da1`, Cumea implemented a crash-safe parent-linked store, legacy migration, active-leaf SSE/mobile projection, task/run reruns, attachment retention, provider-session rewind, replay for non-Grok drivers, and accessible desktop/mobile editing and version switching. |
| [#51 routines/navigation](https://github.com/milind-soni/OpenMausBot/pull/51) | Open; mostly superseded | Cumea already has durable routines, sections, ranked sidebar search, Work/Needs-you views, and `Cmd/Ctrl-K` search focus. A second command-palette surface should be justified against the existing agent-first navigation rather than copied wholesale. |
| [#52 design foundations](https://github.com/milind-soni/OpenMausBot/pull/52) | Open; selectively superseded | Cumea already has global keyboard focus treatment and reduced-motion fallbacks for its Mote motion system. Selection, scrollbar, and broader transition policy remain useful review references, but this PR has not merged upstream. |
| [#53 Hermes](https://github.com/milind-soni/OpenMausBot/pull/53), [#55 Reasonix](https://github.com/milind-soni/OpenMausBot/pull/55) | Covered by configurable ACP profiles | Cumea does not need one hard-coded driver per ACP CLI. A validated local profile supplies executable, exact argv, model catalog, auth behavior, and explicit consent mode while reusing the tested ACP runtime and peer-agent MCP bridge. Custom ACP children now receive a minimal host environment instead of all of `process.env`; built-ins also lose unrelated Cumea-managed credentials, while each owning adapter retains only its own explicit credential. This reduces credential exposure but is not an OS sandbox. Neither CLI becomes a default without live evidence. |
| [#57 deterministic context compaction](https://github.com/milind-soni/OpenMausBot/pull/57) | Independently implemented with stricter replay semantics | Cumea bounds replay by UTF-8 bytes and message count, preserves active-branch provenance and original roles, keeps current input outside history, persists structural run statistics, and distinguishes estimates from provider usage. It does not turn assistant output into synthetic user instructions or claim savings for native sessions. |
| [#56 OpenAI-compatible provider manager](https://github.com/milind-soni/OpenMausBot/pull/56) | Defer API-provider surface | Useful for API endpoints, but it is not subscription reuse and its chat-only shape does not establish ACP tools, approvals, or peer-agent communication. Cumea implements the requested subscription path through ACP profiles first. |
| [#59 task budgets](https://github.com/milind-soni/OpenMausBot/pull/59) | Independently implemented with durable accounting | Cumea persists strict optional task policy and run-local usage, starts deadlines before provider dispatch, aggregates attempts without a thread-keyed in-memory guard, counts only canonical tool/computer/delegation events, and uses token deltas only after real telemetry establishes a baseline. Exhaustion is auditable and interrupts once without fabricating an answer. Mobile cannot administer or receive budget policy. |
| [#60 checkpoints](https://github.com/milind-soni/OpenMausBot/pull/60) | Independently implemented with stricter recovery | Checkpoints share the canonical run model and preserve only bounded provider-neutral cursor digests and branch identity. Restart marks active work interrupted; resume is explicit, local, linked as a new attempt, and blocked by stale branches/providers or uncertain external effects. |
| [#64 objective evidence](https://github.com/milind-soni/OpenMausBot/pull/64) | Independently implemented with stricter semantics | Acceptance requirements now attach to Cumea's existing durable tasks and observations reference canonical run steps or artifacts with a snapshot digest. Task completion is separate from verification: provider prose and generic tool success never become verified, and only an explicit trusted verifier integration can produce that state. Policy administration and full evidence metadata remain desktop-local; the mobile projection omits requirements, labels, paths, output, verifier details, and digests. |
| [#61 local MCP manager](https://github.com/milind-soni/OpenMausBot/pull/61), [#62 reusable skills](https://github.com/milind-soni/OpenMausBot/pull/62) | Independently implemented with narrower trust boundaries | Cumea has an exact-command local MCP registry and a separate instruction-only local skill contract. Skill versions use strict manifests, SemVer, content SHA-256, bounded history, explicit per-agent assignment/rollback, desktop-only administration, backup integrity checks, and visible `local-unsigned` provenance. Unlike the prompt-only upstream registry, v1 cannot carry scripts, hooks, binaries, arbitrary assets, network installers, or auto-execution. |
| Rakazo SecretStore boundary | Adapted as a stricter egress boundary; at-rest encryption deferred | Cumea inventories only explicit credential sources into an atomic bounded catalog, redacts provider events before diagnostic persistence and fan-out, strips raw/cause payloads, and refreshes on config, MCP, push, memory-capability and computer-session changes. Credential delivery to an explicitly configured adapter remains separate. OS-backed at-rest encryption needs its own migration and recovery design and is not claimed here. |
| Merged rooms, bot channels, and stream-context work through upstream `4bb92cf` | Selectively adapted | Cumea already has audited `list_bots`/`ask_bot` handoffs and visible handoff cards. Full group rooms remain a product decision; the useful performance idea was adopted by moving desktop token deltas into a dedicated paint-batched context. |
| [#65 task templates](https://github.com/milind-soni/OpenMausBot/pull/65), [#66 execution timeline](https://github.com/milind-soni/OpenMausBot/pull/66), [#67 per-thread drafts](https://github.com/milind-soni/OpenMausBot/pull/67) | #67 independently implemented; #65 defer; #66 superseded | Cumea now preserves bounded local text drafts per agent. Its existing Activity panel already projects durable tasks, runs, tool steps, approvals, and artifacts; a second transcript timeline would duplicate that evidence. Templates remain useful only after instructions gain explicit visibility, editing, and versioning semantics. |
| [#68 long-paste chips](https://github.com/milind-soni/OpenMausBot/pull/68), [#69 file drop](https://github.com/milind-soni/OpenMausBot/pull/69) | Adapted safely | A long paste becomes a bounded UTF-8 text attachment and file drops use Cumea's existing audited upload path, per-file limits, ownership checks, rollback and deletion transaction. Cumea deliberately does not send arbitrary host paths to providers. |
| [#70 fused computer steps](https://github.com/milind-soni/OpenMausBot/pull/70) | Benchmark candidate, not copied | One act-and-observe round trip, JPEG frames, and batched actions may reduce live computer latency. Cumea's current Box and local-computer paths have different permission, frame-size, lifecycle, and deletion guarantees; any fusion must preserve those boundaries and first prove a win on a live Box trace. |
| [#71 Windows shell polish](https://github.com/milind-soni/OpenMausBot/pull/71), [#72 Windows release runbook](https://github.com/milind-soni/OpenMausBot/pull/72) | UI concept covered; release evidence still pending | Cumea already renders native traffic-light spacing only in the macOS Electron shell and no faux controls on the web. The Windows packaging notes are useful reference material, but Cumea will not claim Windows support without a packaged, hands-on Windows run. |
| [#75 auto approval and pinned approval UI](https://github.com/milind-soni/OpenMausBot/pull/75) | Independently covered with stricter semantics | Cumea keeps Needs-you requests visible and answers them commit-on-success. The oldest unresolved request on the visible branch now replaces the composer with one focused, keyboard-accessible decision surface; the transcript copy is read-only and failed responses remain actionable. Remembered allow/deny rules are keyed to a tool and normalized command program, visible/revocable on desktop, excluded from backups and bot duplication, and re-evaluated against destructive, secret, privilege, interpreter, transfer and obfuscation guards on every request. Questions and paired-mobile responses remain one-shot. |
| [#76 ACP agents receive their computer](https://github.com/milind-soni/OpenMausBot/pull/76) | Independently covered | Every compatible Cumea ACP profile can receive the selected agent's local or Box computer MCP plus the peer-agent MCP bridge. Computer choice remains per agent and fail-closed when the host/permission contract is unavailable. |
| [#80 multiple contexts per bot](https://github.com/milind-soni/OpenMausBot/pull/80) | Product problem covered without a second transcript model | Cumea keeps named agents as the primary navigation while adding per-agent FIFO task queues, a **Fresh context** action, durable message branches/version switching, and Quick bots. This supports multitasking and sensitive context separation without making users manage a parallel hidden thread hierarchy. |
| [#74 multi-provider/media/artifacts](https://github.com/milind-soni/OpenMausBot/pull/74) | Open; do not import wholesale | The provider expansion is API-oriented rather than subscription reuse and substantially widens media, billing, storage, and consent surfaces. Cumea already supports a different compatible CLI subscription/model per agent through ACP profiles, with peer-agent communication; media generation should be a separately reviewed plugin contract. |
| [#92 structured computer observations](https://github.com/milind-soni/OpenMausBot/pull/92) | Independently implemented with tighter bounds | Cloud-computer observations now validate shape and size, redact sensitive URL material, deduplicate screenshots, and expose bounded metrics. Raw browser state remains untrusted context and never becomes an approval bypass. |
| [#94 secure HTML artifact previews](https://github.com/milind-soni/OpenMausBot/pull/94) | Independently implemented with a narrower static boundary | Cumea reuses its existing per-agent path ownership, realpath/symlink checks, byte quotas, opaque capability tokens, TTL, and deletion revocation. Only complete generated workspace HTML is previewable; uploads remain download-only. The preview is opaque-origin and non-interactive, with no sandbox tokens, no React HTML injection sink, and server-enforced CSP/Permissions Policy that deny script, network, forms, navigation, nested content, workers, popups, and downloads. The upstream PR remains useful design evidence but is not copied because its stacked diff also includes unrelated provider work. |
| [#97 no-CLI recovery](https://github.com/milind-soni/OpenMausBot/pull/97), issue [#108](https://github.com/milind-soni/OpenMausBot/issues/108) / PR [#112 Claude login detection](https://github.com/milind-soni/OpenMausBot/pull/112) | Independently implemented | An empty provider registry is now a recoverable setup state, with PATH rescan/reset and install guidance. Claude authentication is detected through the official bounded `claude auth status` command rather than inferring it from a private credential file. Cumea accepts only a real boolean, strips inherited identity/billing variables from the probe, and leaves malformed/unsupported output unknown instead of reviving storage heuristics. Returning focus triggers a throttled, in-flight-deduplicated re-probe that preserves the last known snapshot on failure. |
| [#100 Cua Local VM](https://github.com/milind-soni/OpenMausBot/pull/100), [#101 duplicate tab](https://github.com/milind-soni/OpenMausBot/pull/101) | Adapted behind Cumea's computer-provider boundary | The opt-in Local VM uses Cua Driver 0.19.3 inside a digest-pinned, checksum-verified container derivative, the official Cua MCP bridge, loopback-only viewing, resource/capability limits, exclusive per-thread leases, and fail-closed routing. Cumea did not adopt the closed custom-proxy variants or silently create/start/remove a container. |
| [#103](https://github.com/milind-soni/OpenMausBot/pull/103), [#105](https://github.com/milind-soni/OpenMausBot/pull/105), [#107](https://github.com/milind-soni/OpenMausBot/pull/107) group-chat/call polish | Defer as a distinct product surface | Cumea's named-agent threads, queues, visible handoffs, and mobile client already cover parallel work. Shared rooms and conference calls add participant, transcript, audio, interruption, and privacy semantics that should not be smuggled in as UI polish. |
| [#106 Chief of Staff](https://github.com/milind-soni/OpenMausBot/pull/106) | Reimplemented as one explicit Coordinator | The role is exclusive and persisted, receives a current visible-team roster, uses the existing peer-agent tools and depth/accounting limits, fails closed when those tools are unavailable, and remains accountable for verifying and synthesizing delegated work. |
| [#104 updater rejection handling](https://github.com/milind-soni/OpenMausBot/pull/104) | Not applicable today | Cumea has no `electron-updater` execution surface in this tree, so importing its new coordinator would add dead machinery. The rejection/concurrency pattern should be reused if an updater is introduced. |
| [#110 Telegram gateway](https://github.com/milind-soni/OpenMausBot/pull/110) | Defer | Mobile pairing plus opt-in push already gives Cumea a first-party remote surface. A Telegram bot would add a second externally reachable identity, token, attachment, deletion, and authorization boundary. |
| [#111 Ubuntu preview/control beta](https://github.com/milind-soni/OpenMausBot/pull/111) | Review after the open PR settles | The staged, fail-closed design and real GNOME evidence are valuable, but the PR remains open with active review fixes. Cumea will not claim host Ubuntu control without its own packaged X11/Wayland evidence; the isolated Local VM does not imply host-desktop support. |
| [#115 responsive sidebar drawer](https://github.com/milind-soni/OpenMausBot/pull/115) | Useful concept; current patch not adopted | Narrow-window navigation is worthwhile, but the open PR documents that its closed drawer remains in the tab/accessibility tree, transformed ancestors disturb fixed overlays, and settings/approval/computer surfaces can still overflow. Cumea will only add a compact shell with inert hidden content, portal-safe overlays, focus trap/restore, and browser acceptance at the actual breakpoints. |
| [#116 bundled Ubuntu CUA](https://github.com/milind-soni/OpenMausBot/pull/116) | Defer pending independent Linux evidence | Pinning and checksumming the helper is directionally sound, but the PR is open and stacked on the Ubuntu control work. Cumea will not turn packaging evidence into a host-control claim without its own x64 package, dependency-provenance, Xorg/Wayland, permission, and failure-path acceptance. |
| [#23 README diagram](https://github.com/milind-soni/OpenMausBot/pull/23) | Absorb concept | Documentation is being rewritten around Cumea rather than patching the upstream README. |
| [#14 PATH detection](https://github.com/milind-soni/OpenMausBot/pull/14) | Superseded/selective | Much of the problem is already addressed by `env-path.ts`; remaining deterministic probe work can be added independently. |

## Issue priorities

- **Now covered locally:** Claude login issue [#108](https://github.com/milind-soni/OpenMausBot/issues/108)
  through official CLI state; cloud-computer extensibility [#4](https://github.com/milind-soni/OpenMausBot/issues/4)
  through an explicit provider/capability/lease boundary.
- **Review next, with platform evidence:** Ubuntu roadmap [#29](https://github.com/milind-soni/OpenMausBot/issues/29)
  and its preview/control phases [#77](https://github.com/milind-soni/OpenMausBot/issues/77),
  [#79](https://github.com/milind-soni/OpenMausBot/issues/79), and
  [#109](https://github.com/milind-soni/OpenMausBot/issues/109).
- **Still a deliberate product decision:** default provider [#28](https://github.com/milind-soni/OpenMausBot/issues/28),
  openai-compatible API endpoints [#54](https://github.com/milind-soni/OpenMausBot/issues/54),
  Composio alternatives [#47](https://github.com/milind-soni/OpenMausBot/issues/47), and signed releases
  [#49](https://github.com/milind-soni/OpenMausBot/issues/49).
- **No local code surface:** updater issue [#78](https://github.com/milind-soni/OpenMausBot/issues/78)
  until Cumea introduces an updater.

This file records a time-bounded audit, refreshed on 2026-08-14 against OpenMausBot `main` at
`13a1bb72f120e5e99759ee2e93c1352da039b3d4`: 48 merged PRs, 34 open PRs, 13 closed-unmerged
PRs, 13 open issues, and 7 closed issues, through PR #116. Recheck upstream state and actual branch
diffs before taking future work.

## Rakazo comparison

[`elie222/rakazo`](https://github.com/elie222/rakazo) was re-reviewed on 2026-08-14 at
`d29c009861e9a255de60f4d39fbf75e898316a3f` (Apache-2.0); it has no issues, one merged PR
([#1 connector tool-name sanitization](https://github.com/elie222/rakazo/pull/1)), and one open draft
([#2 Pi OAuth persistence](https://github.com/elie222/rakazo/pull/2)). No code or assets were copied. Its useful
differences are a clear provider billing/auth catalog, explicit adapter boundaries for model,
sandbox, memory, wakeup, secret and artifact services, revisioned Markdown memory, and approachable
routine scheduling. Cumea adopts the first idea through ACP profile copy that distinguishes local
CLI subscriptions from API billing. Its existing provider registry, task/run audit, routines, Box
adapter, and cursor-paged mobile client already cover the nearest local-product contracts.

Rakazo's lifecycle separation also highlighted a useful cost-control gap around cloud computers.
Cumea now implements its own host-side Box idle manager: the conservative default requests sleep
after ten minutes of real inactivity, can be disabled or changed locally, and re-checks the bot,
selected computer, turns, queues, routines, approvals, screen polling, resource leases and deletion
state before sending `/stop`. Activity reschedules one keyed timer per agent. A failed provider
request is reported honestly and is retried only after new activity, avoiding an API or billing
loop; a successful HTTP request is shown as accepted, not as proof that archiving has completed.
The policy and controls are deliberately absent from paired-mobile projections. No Rakazo source
code was copied.

Rakazo's shared chat Markdown policy also exposed drift between Cumea's desktop and mobile
renderers. Cumea now uses one dependency-free URL/control-character and streaming-fence policy on
both clients. Desktop deliberately retains its separate capability-scoped local-file buttons;
mobile never gains local path navigation, and unsupported links remain inert text. Percent-encoded
controls and directional spoofing fail closed without rewriting valid Unicode URLs.

The mobile comparison showed that Cumea's server already privacy-projected visible peer handoffs,
but the companion discarded their structure. The mobile client now preserves a bounded complete
handoff only when the host supplied both visible peers, renders from/to, textual status, prompt and
result, and opens the destination only while it remains in the visible roster. Missing, hidden, or
deleted peers stay inert. The existing paged `FlatList` architecture is unchanged.

The routine comparison was adopted at the presentation layer, not as a second execution model.
Desktop routine details can replace the write-only prompt, edit the canonical schedule without
changing its IANA timezone, show projected occurrences, and derive lossless attempt history from
the existing task/run records. Rakazo/OpenMaus-style parallel `routineRuns` storage was not added.

Rakazo PR #2 is not applicable to Cumea's current provider boundary: Cumea delegates subscription
authentication to user-installed CLIs and does not host Pi request-scoped OAuth credentials. Adding
an internal OAuth vault only for architectural symmetry would create a new secret lifecycle without
a consumer.

Rakazo's revisioned memory idea is now implemented through a local per-agent contract: bounded
Markdown documents, optimistic revision conflicts, retained history, user/agent provenance, pinned
and relevant context selection, exact successful-use accounting, opt-in agent writes, credential
rejection, and hard deletion with the agent. Draft PR #1 is not copied because Cumea does not own a
Pi-style connector-to-model naming boundary; its MCP servers define and dispatch their own tool names.
If Cumea later proxies those tools, it must preserve a collision-safe mapping from normalized model
names back to original execution names rather than mutating the registry.

Rakazo's per-agent export was also used as product evidence, not source code. Cumea extends the
portable-data idea with full-workspace and selective archives, a versioned file inventory, SHA-256
and byte-count verification, application-secret/session exclusions, bounded path-safe inspection,
same-volume staging, an atomic directory swap, rollback, and a retained pre-restore snapshot. Rakazo's
database dump scripts solve a different multi-service deployment problem and were not imported.

Rakazo's external-effect table also exposed a useful missing boundary, but its executor marks an
effect completed before running the mutation and returns duplicate rows without proving the first
attempt's outcome. Cumea instead persists `intended` and `applying` before a controlled adapter
crosses the boundary, settles as failed only after a proven pre-mutation rejection, treats generic
timeouts and disconnects as unknown, recovers in-flight effects as
`unknown`, and never replays an unknown outcome automatically. Provider-native opaque writes are
honest post-boundary observations rather than synthetic idempotency claims. See
[External-effect receipts](external-effect-receipts.md).

The same durable-boundary review led to provider-neutral resumable checkpoints. Cumea does not copy
provider process state or auto-replay a run: restart marks it interrupted, the local user explicitly
resumes, unknown effects block, and a native cursor is used only after exact capability and identity
matching. See [Resumable run checkpoints](resumable-checkpoints.md).

Rakazo's Graphile/Postgres, Docker/E2B and multi-tenant service topology is not a free improvement
for Cumea's single-user local harness: porting it would increase deployment and secret-management
surface without proving a user-visible benefit.

## Dependency-update policy

Cumea does not use scheduled Dependabot version PRs. GitHub vulnerability alerts, automatic security
fixes, secret scanning, push protection, and private vulnerability reporting remain enabled. Turning
off security-fix PRs is a separate security decision. Maintainers resolve alerts through reviewed,
SHA-pinned update tranches that pass the full matrix. In the first upstream-hardening tranche, the
individually green Actions updates were applied manually; a failing grouped development-dependency
update and an unreviewed icon-library major were left out.
