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
| [#10 Windows hardening](https://github.com/milind-soni/OpenMausBot/pull/10) | Candidate, not wholesale merge | Best of the overlapping Windows directions, but old-base conflicts and overlap with Linux portability should be resolved through shared abstractions first. |
| [#5](https://github.com/milind-soni/OpenMausBot/pull/5), [#7](https://github.com/milind-soni/OpenMausBot/pull/7), [#17](https://github.com/milind-soni/OpenMausBot/pull/17) Windows variants | Do not merge wholesale | Useful individual ideas, but overlapping scope and unsafe `cmd.exe`/shell quoting patterns make selective reimplementation safer. |
| [#30 Antigravity](https://github.com/milind-soni/OpenMausBot/pull/30) | Defer | Defaults to full-auto because the protocol lacks a headless consent hook. That does not meet Cumea's default consent boundary. |
| [#22 AI Counsel](https://github.com/milind-soni/OpenMausBot/pull/22) | Optional plugin candidate | Large external/homelab coupling and turn-continuity limitations do not belong in the core fleet. |
| [#31 morphing mascot](https://github.com/milind-soni/OpenMausBot/pull/31) | Defer | Polished work, but tightly coupled to the upstream identity while Cumea needs its own visual system. |
| [#33 icon grid](https://github.com/milind-soni/OpenMausBot/pull/33) | Reimplemented independently | Cumea's supplied artwork is padded for native icon masks without copying upstream art. |
| [#34 trial box TTL](https://github.com/milind-soni/OpenMausBot/pull/34), [#35 dictation locale](https://github.com/milind-soni/OpenMausBot/pull/35), [#36 connected-app prompt](https://github.com/milind-soni/OpenMausBot/pull/36), [#37 screen-frame gating](https://github.com/milind-soni/OpenMausBot/pull/37) | Reimplemented now | Small, bounded improvements that match Cumea's existing Box, speech, Composio, and computer-preview contracts. |
| [#38 pasted images](https://github.com/milind-soni/OpenMausBot/pull/38), [#39 per-bot drafts](https://github.com/milind-soni/OpenMausBot/pull/39), [#40 multiline composer](https://github.com/milind-soni/OpenMausBot/pull/40) | Adapted now | Cumea reuses its own attachment pipeline, clears drafts on agent switches, guards IME composition, and supports Shift+Enter in an auto-growing composer. |
| [#41 Windows CLI shims](https://github.com/milind-soni/OpenMausBot/pull/41), [#42 Windows permission pipe](https://github.com/milind-soni/OpenMausBot/pull/42), [#43 Windows process tree](https://github.com/milind-soni/OpenMausBot/pull/43), [#44 cross-platform user data](https://github.com/milind-soni/OpenMausBot/pull/44) | Selective/defer | Cumea already resolves its CUA descriptor through Electron's exact `userData` path with platform fallbacks. CLI shims, authenticated named pipes, and process-tree cleanup belong in one Windows tranche with quoting, ACL, packaged-Electron, and real-host tests; the open branches are useful references but are overlapping and not safe to combine wholesale. |
| [#45 message editing and branches](https://github.com/milind-soni/OpenMausBot/pull/45) | Defer to a dedicated design | Branching changes the persistence model and must cover tasks, runs, artifacts, attachments, pagination, mobile synchronization, crash recovery, and accessible version switching. A transcript-only import would make the audit trail inconsistent. |
| [#23 README diagram](https://github.com/milind-soni/OpenMausBot/pull/23) | Absorb concept | Documentation is being rewritten around Cumea rather than patching the upstream README. |
| [#14 PATH detection](https://github.com/milind-soni/OpenMausBot/pull/14) | Superseded/selective | Much of the problem is already addressed by `env-path.ts`; remaining deterministic probe work can be added independently. |

## Issue priorities

- **Now:** reliability/privacy hardening ([#20](https://github.com/milind-soni/OpenMausBot/issues/20)),
  shutdown hangs ([#15](https://github.com/milind-soni/OpenMausBot/issues/15)), and clear key setup
  ([#19](https://github.com/milind-soni/OpenMausBot/issues/19)).
- **Next:** staged Ubuntu support ([#29](https://github.com/milind-soni/OpenMausBot/issues/29)) and a
  deliberate default-provider decision ([#28](https://github.com/milind-soni/OpenMausBot/issues/28)).
- **Later:** additional cloud-computer providers
  ([#4](https://github.com/milind-soni/OpenMausBot/issues/4)) after the provider boundary is stable.
- **Not a default today:** Antigravity ([#26](https://github.com/milind-soni/OpenMausBot/issues/26))
  until its consent and authentication model is appropriate for a local agent workspace.

This file records a time-bounded audit, refreshed on 2026-08-13 against upstream `main` at
`8511f02557f19cf6ac1976d3115b08c0c4643754` and the open pull requests through #45. Recheck
upstream state and actual branch diffs before taking future work.

## Dependency-update policy

Cumea does not use scheduled Dependabot version PRs. GitHub vulnerability alerts, automatic security
fixes, secret scanning, push protection, and private vulnerability reporting remain enabled. Turning
off security-fix PRs is a separate security decision. Maintainers resolve alerts through reviewed,
SHA-pinned update tranches that pass the full matrix. In the first upstream-hardening tranche, the
individually green Actions updates were applied manually; a failing grouped development-dependency
update and an unreviewed icon-library major were left out.
