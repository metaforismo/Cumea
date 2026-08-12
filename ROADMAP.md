# Cumea roadmap

This is the bootstrap backlog as of 2026-08-12. It is deliberately ordered: reliability, privacy,
and consent come before provider count or visual expansion.

## P0 — trustworthy foundation

- [x] Establish an independent Cumea identity, bundle ID, data directory, and runtime namespace.
- [x] Remove embedded upstream analytics and remote email identification.
- [x] Wait for the Claude permission socket before spawning the agent process.
- [x] Bound desktop shutdown and stop dictation during quit.
- [x] Restrict external URL opening and renderer navigation.
- [x] Add request-origin checks, CSP/security headers, safe static-path resolution, and bounded JSON parsing.
- [x] Write configuration atomically with owner-only permissions.
- [x] Confirm the first Cumea CI matrix is green on macOS, Ubuntu, and Windows
  ([run 31627113168](https://github.com/metaforismo/Cumea/actions/runs/31627113168)).
- [x] Add focused regression tests for origin rejection and malformed JSON.
- [ ] Add a raw-request regression test for encoded static traversal attempts.

## P1 — usability and portability

- [ ] Reimplement API-key setup guidance with provider-specific billing and privacy copy
  ([upstream PR #27](https://github.com/milind-soni/OpenMausBot/pull/27)).
- [ ] Rebase the Linux desktop work onto Cumea's hardened core; validate both Xorg and Wayland
  before calling it supported ([upstream PR #32](https://github.com/milind-soni/OpenMausBot/pull/32)).
- [ ] Build one shared platform abstraction for executable shims, process trees, sockets/pipes,
  paths, and icons before taking a Windows port
  ([upstream PR #10](https://github.com/milind-soni/OpenMausBot/pull/10)).
- [ ] Reassess the default provider fleet and authentication expectations
  ([upstream issue #28](https://github.com/milind-soni/OpenMausBot/issues/28)).
- [ ] Harden persistence further: unique temporary files, full-write guarantees, recovery tests,
  and crash-consistency documentation.
- [ ] Add a privacy/settings page showing exactly which integrations are enabled and where data goes.

## P2 — extensibility

- [ ] Define an out-of-process provider/plugin contract before adding experimental drivers.
- [ ] Evaluate Antigravity only with per-action consent or a clearly labeled explicit full-auto mode
  ([upstream PR #30](https://github.com/milind-soni/OpenMausBot/pull/30)).
- [ ] Treat AI Counsel as an optional adapter, not a built-in dependency
  ([upstream PR #22](https://github.com/milind-soni/OpenMausBot/pull/22)).
- [ ] Design a Cumea-native visual identity and replace remaining upstream-derived mascot internals.
- [ ] Add accessibility, keyboard-navigation, reduced-motion, and screen-reader acceptance checks.
- [ ] Define signed release, SBOM, provenance, and update-channel requirements.

## Explicitly deferred

- Large mascot animation work is deferred until Cumea has its own visual system
  ([upstream PR #31](https://github.com/milind-soni/OpenMausBot/pull/31)).
- Overlapping Windows branches will not be merged wholesale. Useful ideas will be reimplemented on
  one reviewed portability foundation.
- Provider drivers that require blanket approval will not become defaults.

This roadmap is a starting point, not a promise of compatibility. New feature proposals should
state the user problem, consent model, third-party data flow, platform scope, and verification plan.
