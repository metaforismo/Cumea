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
| [#21 reliability/privacy/CI](https://github.com/milind-soni/OpenMausBot/pull/21) | Split and reimplement | Valuable themes, but the proposed invalid-JSON path can leave a promise unresolved and the atomic-write helper needs stronger failure handling. Cumea adopted audited pieces instead of cherry-picking the branch. |
| [#27 API-key guidance](https://github.com/milind-soni/OpenMausBot/pull/27) | Reimplement in P1 | Good onboarding improvement; needs Cumea copy, accessibility review, and explicit provider billing/data-flow language. |
| [#32 Ubuntu beta](https://github.com/milind-soni/OpenMausBot/pull/32) | Candidate for P1 | Strongest Linux foundation and useful packaged evidence. It still needs rebase plus hands-on Wayland validation. |
| [#10 Windows hardening](https://github.com/milind-soni/OpenMausBot/pull/10) | Candidate, not wholesale merge | Best of the overlapping Windows directions, but old-base conflicts and overlap with Linux portability should be resolved through shared abstractions first. |
| [#5](https://github.com/milind-soni/OpenMausBot/pull/5), [#7](https://github.com/milind-soni/OpenMausBot/pull/7), [#17](https://github.com/milind-soni/OpenMausBot/pull/17) Windows variants | Do not merge wholesale | Useful individual ideas, but overlapping scope and unsafe `cmd.exe`/shell quoting patterns make selective reimplementation safer. |
| [#30 Antigravity](https://github.com/milind-soni/OpenMausBot/pull/30) | Defer | Defaults to full-auto because the protocol lacks a headless consent hook. That does not meet Cumea's default consent boundary. |
| [#22 AI Counsel](https://github.com/milind-soni/OpenMausBot/pull/22) | Optional plugin candidate | Large external/homelab coupling and turn-continuity limitations do not belong in the core fleet. |
| [#31 morphing mascot](https://github.com/milind-soni/OpenMausBot/pull/31) | Defer | Polished work, but tightly coupled to the upstream identity while Cumea needs its own visual system. |
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

This file records a time-bounded audit. Recheck upstream state and actual branch diffs before taking
future work.
