<!--
Please read CONTRIBUTING.md first. Keep one concern per PR; large changes
should have an issue agreeing on the approach before implementation.
-->

## What changed

<!-- What changed, and why? -->

## Why

## Verification

- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] Relevant build, export, package, or UI checks are listed below

<!-- Paste concise command results and note anything not tested. -->

## Screenshots (UI changes)

<!-- Before/after images; video for anything animated. -->

## Generated output

- [ ] This PR does not change `server/`, or I ran `pnpm build:server`
- [ ] Any `dist-server/` changes are generated counterparts of this PR's `server/` changes only
- [ ] `pnpm verify:dist-server` passes from the committed checkout

## Product and risk review

- [ ] Security, privacy, accessibility, platform, and migration effects were considered
- [ ] UI changes include screenshots or video where useful
- [ ] Publishing, signing, deployment, tagging, and release actions are called out explicitly
- [ ] New server behavior has tests
- [ ] macOS-only code is platform-gated; no shell-built command strings were introduced
- [ ] No secrets were added to logs, responses, events, argv, fixtures, or screenshots
