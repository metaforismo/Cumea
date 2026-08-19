# Releasing Cumea

This checklist separates source confidence, package structure, platform behavior, and artifact
trust. Completing one layer is not evidence for another.

## Current release class

`v0.1.0` is a **Developer Preview**. macOS arm64 is the first binary candidate. Linux, Windows,
iOS, and Android remain source previews until the hands-on gates below have evidence. If signing or
notarization credentials are unavailable, publish source metadata only; do not attach an unsigned
desktop binary under a label that implies normal Gatekeeper installation.

## 1. Freeze the candidate

- [ ] Confirm `package.json`, `apps/mobile/package.json`, and `apps/mobile/app.json` use the intended
  version.
- [ ] Confirm `CHANGELOG.md` and `docs/releases/v0.1.0.md` match the candidate behavior.
- [ ] Confirm `THIRD_PARTY_NOTICES.md`, `licenses/`, `LICENSE`, and the generated SBOM cover the
  software and assets shipped in the package.
- [ ] Confirm no secrets, local credentials, generated screenshots, pairing payloads, or developer
  data are tracked.
- [ ] Work from a clean tree on the exact commit intended for `v0.1.0`.

```sh
git status --short
git rev-parse HEAD
pnpm install --frozen-lockfile
git diff --check
```

Record the candidate SHA in the release notes before building. Do not reuse artifacts made from a
different SHA.

## 2. Source and export gates

These are required on the exact candidate commit:

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm build:server
pnpm mobile:typecheck
EXPO_NO_TELEMETRY=1 pnpm mobile:export
pnpm --dir apps/landing --ignore-workspace install --frozen-lockfile
pnpm --dir apps/landing typecheck
pnpm --dir apps/landing build
pnpm release:sbom
```

The GitHub Actions workflow repeats root typechecking/tests on macOS, Ubuntu, and Windows; builds
the desktop UI and harness on Ubuntu; exports mobile JavaScript on Ubuntu; builds the independently
locked landing on Ubuntu; and performs an unsigned macOS arm64 package-layout smoke. Every required
job must be green for the candidate SHA. An Expo export is not a native mobile build.

The root suite also verifies the declared packaged-server process manifest on every CI OS. Every
`server/**/*-proxy.ts` sidecar must be classified as a release-critical entrypoint before it can land.
This catches source/package drift before a platform package is even staged.

## 3. macOS arm64 package gate

The CI smoke is intentionally unsigned:

```sh
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm package:mac:dir
pnpm release:verify-package
```

`package:mac:dir` first downloads the pinned official CUA Driver
`cua-driver-rs-v0.19.3` arm64 asset into the ignored `build/cua-driver/` directory, requires its
published 64,208,525-byte size and SHA-256
`4f147affe7015dffdb0faeecb784a72d4ff9808b571a2d888231ae11e7966034`, rejects ambiguous archive
structure, and extracts only the pinned top-level standalone executable (not the separate
`CuaDriver.app` copy in the archive). No third-party executable is committed to the repo.

The package smoke verifies that the app contains its UI, harness, native speech helper, the
executable CUA Driver with an arm64 slice reporting version 0.19.3, local-computer native runtime,
and that the packaged driver is byte-identical to the release-verified prepared executable. It also
checks the Screen Capture/Automation usage descriptions, MIT license, third-party notices, and
bundled license files.

The same smoke now treats the staged `Resources/server` directory as a closed runtime graph. It starts
from the harness plus every declared spawned proxy, follows literal relative static/dynamic imports and
`require(...)` transitively, and fails on missing/empty dependencies, path escapes, non-literal dynamic
loading, or bare package imports. This enforces the current packaging promise that the server needs no
runtime `node_modules`; see [packaged server runtime closure](package-runtime-closure.md).

The upstream asset currently carries a universal Mach-O (`x86_64 arm64`) even though its archive is
named `darwin-arm64`; Cumea preserves that signed upstream executable instead of thinning and
invalidating it. The smoke does not exercise macOS permissions, launch the Electron app, execute
provider sidecars end-to-end, or establish Cumea signing/notarization.

Before distributing a desktop binary:

- [ ] Build on a trusted macOS arm64 release host from the candidate SHA.
- [ ] Sign the app and every nested executable, framework, `.node`, and `.dylib` with the release
  Developer ID identity. Do not use ad-hoc signing.
- [ ] Verify the deep signature with `codesign --verify --deep --strict --verbose=2`.
- [ ] Submit the signed app/archive with `xcrun notarytool ... --wait` using a protected keychain
  profile or CI secret; inspect the notary log on failure.
- [ ] Staple and validate the ticket with `xcrun stapler staple` and `xcrun stapler validate`.
- [ ] Test first launch, provider authentication, one streamed turn, stop, one approval, local
  computer opt-in, dictation permission, relaunch persistence, and uninstall on a clean macOS user.
- [ ] Run `spctl --assess --type execute --verbose=4` on the final app and open the exact DMG/ZIP
  artifact that will be uploaded.

`electron-builder.yml` deliberately does not claim automatic notarization. Until a credentialed,
reproducible signing pipeline completes these checks, signing/notarization remains a release
blocker rather than a documentation checkbox.

## Entitlements review

The current plist is broader than an ideal final profile, but reducing it without a signed launch
matrix can produce a package that builds and then fails at runtime.

| Entitlement | Current reason | Reduction gate |
|---|---|---|
| `allow-jit` | Chromium/V8 execution under hardened runtime | Signed launch and streamed-chat smoke without it |
| `allow-unsigned-executable-memory` | Electron/Chromium compatibility fallback | Signed launch, renderer, and provider smoke without it |
| `allow-dyld-environment-variables` | Electron helper compatibility | Remove first, but only after a signed clean-machine launch matrix |
| `disable-library-validation` | Third-party native CUA/UBJS modules are loaded at runtime | Re-sign every nested native module with the release Team ID, then retest without it |
| `device.audio-input` | Microphone-backed dictation | Keep while dictation ships; verify the usage prompt and denial path |

Each entitlement change needs a signed-package regression test. A successful TypeScript build is
not evidence that an entitlement is unnecessary.

## 4. SBOM and checksums

`pnpm release:sbom` writes a deterministic CycloneDX 1.6 inventory of the locked desktop/mobile
production graph and package-declared licenses to `release/Cumea-<version>.cdx.json`. It also records
the separately downloaded CUA Driver executable's pinned release archive, distribution URL, version,
MIT license, and verified SHA-256. The inventory includes platform-optional packages, so it is not a
claim that every component is embedded in every binary. It omits timestamps and machine-local paths
so identical workspace dependency graphs produce identical bytes.

After all publishable assets are in `release/`:

```sh
pnpm release:checksums
shasum -a 256 -c release/SHA256SUMS
```

The checksum script includes desktop archives/installers and the CycloneDX JSON, while excluding
builder debug/config files. Sign `SHA256SUMS` with the project's documented release-signing key once
one is established. Do not invent a provenance or signature claim before that key and workflow
exist.

## 5. Other-platform evidence

Do not mark these supported from CI typechecks alone:

- **Linux:** build and install the native package on both Xorg and Wayland; verify feature
  degradation, provider processes, browser UI, files, routines, and uninstall.
- **Windows:** build/install x64 NSIS and ZIP on a real Windows host; verify paths, process-tree
  stop, provider discovery, attachments, persistence, and uninstall.
- **iOS/Android:** create signed development/release builds and test pairing, SecureStore, camera
  permission/denial, reconnect, attachments, reduced motion, VoiceOver/TalkBack, foreground/
  background transitions, and device revocation on physical devices.

For `v0.1.0`, record these as unverified instead of blocking a source-only Developer Preview.

## 6. Publish with an approval boundary

- [ ] Compare the release tag target to the recorded candidate SHA.
- [ ] Mark the GitHub release as a **pre-release** and use the reviewed notes in
  `docs/releases/v0.1.0.md`.
- [ ] Attach only artifacts produced and verified above, plus the CycloneDX SBOM and
  `SHA256SUMS`.
- [ ] Verify every uploaded asset by downloading it from the release and checking its digest.
- [ ] Update release URLs only after the artifacts exist.

Creating a tag, GitHub release, deployment, store submission, or update channel is an external
mutation and requires explicit action-time approval.
