# Packaged server runtime closure

Cumea's Electron package deliberately ships the compiled harness under `Resources/server` without a
server-side `node_modules` tree. That keeps the packaged boundary small, but it also creates a release
invariant that ordinary TypeScript/build checks cannot prove: every process the app can spawn must be
present in the staged package, and every runtime import reachable from those entrypoints must resolve
inside that same server tree or to an explicit `node:` builtin.

## Release-critical entrypoints

`scripts/package-runtime-closure.mjs` is the single manifest for the packaged server processes:

- `server/index.js` — desktop harness;
- `server/drivers/agents-proxy.js` — agent-delegation MCP sidecar;
- `server/computer-proxy.js` — cloud-computer MCP sidecar;
- `server/permission-proxy.js` — Claude permission MCP sidecar.

The source-manifest check also discovers every `server/**/*-proxy.ts` file. Adding another proxy without
classifying it in the release manifest fails root CI, so a new sidecar cannot silently exist in source
while being absent from package verification.

## Closure rules

`release:verify-package` runs against the freshly staged `Cumea.app/Contents/Resources/server` tree. It
starts at every release-critical entrypoint and follows literal static imports, re-exports, dynamic
imports, and `require(...)` calls transitively.

The package gate fails when:

- a declared entrypoint is missing or empty;
- a relative dependency is missing or empty;
- a relative import escapes `Resources/server`;
- a file resolves through a symlink outside the real server root;
- runtime loading uses a non-literal dynamic import/require that the verifier cannot close safely;
- a reachable file imports a bare package specifier instead of `node:` or a packaged relative file.

Bare imports are intentionally rejected because the current Electron layout claims that the compiled
server needs no `node_modules` at runtime. If Cumea later chooses to ship server dependencies, that must
become an explicit packaging design change rather than an accidental exception in this verifier.

## Mutation evidence

`scripts/package-runtime-closure.test.mjs` runs in the root test suite on macOS, Linux, and Windows. It
proves that each declared entrypoint is individually required and that the verifier rejects a missing
transitive dependency, a bare import, a path escape, a non-literal dynamic import, and an unclassified
future proxy. A positive fixture also proves that literal dynamic imports remain supported and are
included in the closure.

The macOS package-layout CI job is the stronger integration gate because it runs the same verifier on
the package produced by `electron-builder`, after `build:server` has generated the actual staged files.

## Evidence boundary

This is a **package structure and dependency-closure** check. It prevents a class of delayed
`ERR_MODULE_NOT_FOUND` / missing-sidecar failures, but it does not execute provider workflows, prove
that child processes can launch under the signed hardened runtime, or establish signing/notarization.
Those remain separate release and real-journey gates in `docs/releasing.md` and `TODO.md`.
