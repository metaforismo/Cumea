# Desktop performance evidence

Cumea treats responsiveness as a tested product property, not a screenshot claim. Performance
reports are local, opt-in files: the application does not upload them, add telemetry, or include
provider prompts, transcripts, credentials, connected-app payloads, screenshots, or user-selected
file paths.

The performance tooling has three layers:

1. allowlisted Electron/renderer timing marks and a versioned raw report;
2. a packaged multi-sample runner with isolated profiles, data, cache treatment, timeouts, and a
   deterministic default fixture;
3. summary/comparison tools and production bundle budgets.

A fixed-machine workflow and trend history remain tracked separately in `TODO.md`. Until that gate
lands, timings collected on arbitrary hosted runners or different developer machines are diagnostic,
not verified Cumea improvement claims.

## Run the packaged benchmark

On macOS, the default command builds an unsigned directory package and then measures five returning-
profile warm launches:

```sh
pnpm perf:desktop -- --label baseline
```

The default runtime is `fixture`. It still exercises the packaged Electron main process, embedded
harness, durable store seed, HTTP API, SSE transport, React renderer, and normal shell readiness, but:

- uses an empty provider fleet, so it does not probe or launch Claude, Codex, Grok, Gemini, or Box;
- removes known external API-key environment variables from child processes;
- disables remote access;
- records an unavailable local-computer descriptor without loading the native CUA SDK or daemon;
- stores Electron profile/session/log/crash data and Cumea data inside the run directory.

This is the reproducible startup fixture. It is not evidence that a live provider or computer-use
journey works.

### First-run profile

Each sample receives a new Electron profile and Cumea data directory. The terminal mark is the first
onboarding screen after two paint opportunities:

```sh
pnpm perf:desktop -- \
  --label first-run \
  --profile first-run \
  --cache fresh-profile \
  --samples 5
```

A first-run benchmark cannot be labelled warm or Chromium-cold. The runner rejects mixed semantics
rather than silently producing incomparable samples.

### Returning warm profile

The runner creates one isolated profile, performs one uncounted priming launch, and then reuses that
profile and its caches for measured full-process relaunches:

```sh
pnpm perf:desktop -- \
  --label returning-warm \
  --profile returning \
  --cache warm \
  --samples 5
```

The prime report remains in `raw/prime.json` for inspection but is excluded from median and p95.

### Returning Chromium-cold profile

Before every measured launch, a separate maintenance process opens the same profile, calls Chromium
`clearCache()` and `clearCodeCaches({})`, writes a cache-clear report, and quits before creating a
window or starting the harness. The measured launch follows afterwards, so cache clearing is not
included in the usable-shell duration:

```sh
pnpm perf:desktop -- \
  --label returning-chromium-cold \
  --profile returning \
  --cache chromium-cold \
  --samples 5
```

This is **Chromium cache-cold**, not an operating-system filesystem cold start. The machine's page
cache, filesystem cache, dynamic loader state, and other OS-level effects are not reset.

### Reuse an existing package

Pass a packaged executable or a macOS `.app`; supplying `--app` automatically skips the build:

```sh
pnpm perf:desktop -- \
  --app release/mac-arm64/Cumea.app \
  --label candidate
```

Outside macOS, automatic packaging is not claimed by this runner. Build on the target platform and
pass `--app`, or use `--skip-build` when a compatible package already exists under `release/`.

### Explicit real-runtime measurement

`--runtime real` preserves ambient provider/CLI environment and follows the production CUA path. It
may inspect authenticated local CLIs, start native components, contact configured third parties, or
show operating-system permission prompts depending on the isolated configuration and host state:

```sh
pnpm perf:desktop -- \
  --runtime real \
  --label real-local-runtime
```

Use this only for an explicitly controlled acceptance run. Never mix `fixture` and `real` samples in
one before/after claim.

## Runner options

```text
--label <name>             report label
--samples <1-50>           measured launches; default 5
--profile <kind>           first-run | returning
--cache <kind>             fresh-profile | warm | chromium-cold
--runtime <kind>           fixture | real; default fixture
--app <path>               packaged executable or macOS .app
--skip-build               reuse an existing release package
--out <directory>          evidence root; default .context/performance
--timeout-ms <ms>          per-launch ceiling, 10000–300000
--commit <sha>             commit recorded in every report
--machine-label <label>    optional non-secret machine label
```

Each launch has a bounded timeout. On timeout the runner terminates the process tree, retains a failed
manifest, and stops rather than mixing partial samples into a summary. Captured stdout/stderr is
bounded to 2 MiB per process. Known working-directory, evidence-directory, profile, data, and home
paths are redacted from logs and manifest errors.

## Evidence layout

A successful run writes an ignored local directory such as:

```text
.context/performance/returning-warm-2026-08-17T12-00-00-000Z/
├── manifest.json
├── summary.json
├── summary.md
├── raw/
│   ├── prime.json
│   ├── cache-clear-01.json       # Chromium-cold only
│   └── sample-01.json
├── logs/
│   ├── build.log                 # when the runner built the package
│   ├── prime.log
│   └── sample-01.log
├── profiles/                     # isolated Electron state
└── data/                         # isolated Cumea state
```

`manifest.json` records the scenario, requested sample count, timeout, commit, package name, build
command, individual run receipts, artifact paths, and machine evidence. Machine evidence includes
platform, architecture, OS release, CPU model, logical core count, and total memory. Its fingerprint
is derived only from those fields; hostname, username, and hardware serial numbers are not collected.

Profiles and Cumea data may still contain the deterministic seeded conversation used by the fixture.
Do not publish the `profiles/` or `data/` directories. Raw timing reports, bounded logs, manifest, and
summary are the intended review artifacts.

## Collect one raw report manually

The lower-level interface remains useful while developing a mark. Set a local report path before
starting Electron:

```sh
CUMEA_PERFORMANCE_FILE=.context/performance/manual.json \
CUMEA_PERFORMANCE_LABEL=manual \
pnpm dev:desktop
```

`CUMEA_PERFORMANCE_AUTO_QUIT=1` quits a returning profile only after the usable shell has painted and
the report has flushed. For a `first-run` performance profile, the terminal mark is the painted
onboarding screen instead. The multi-sample runner should be preferred for comparisons because it
also controls the profile, data, cache, timeout, and package boundary.

Unknown renderer marks and malformed clocks are rejected by an exact allowlist in the Electron main
process. The preload reconstructs only `name`, `timeOrigin`, and `startTime`; arbitrary renderer
properties are never forwarded.

## Summarize or compare existing reports

The packaged runner writes a summary automatically. Existing raw reports can also be summarized:

```sh
pnpm perf:summary -- \
  --label baseline \
  --out .context/performance/baseline \
  .context/performance/baseline-samples
```

The summary records sample counts, median, p95, minimum, maximum, commit, application version,
platform, architecture, packaged status, profile, cache treatment, runtime, machine fingerprint, and
optional machine label.

Compare two summaries:

```sh
pnpm perf:compare -- \
  --out .context/performance/baseline-to-candidate \
  .context/performance/baseline.json \
  .context/performance/candidate.json
```

A negative percentage means the candidate took less time. Comparison output is descriptive evidence,
not proof that one individual code change caused the full difference when a PR combines several
changes.

## Timing definitions

All marks are converted to epoch milliseconds so Electron main-process and Chromium renderer clocks
can be compared without assuming their `performance.timeOrigin` values are identical.

| Metric | Definition |
|---|---|
| `main.module-to-ready` | Electron main module evaluated → Electron `ready` event |
| `main.cache-clear` | Chromium HTTP/code cache maintenance start → settle; maintenance reports only |
| `main.cua-initialization` | local-computer initialization or deterministic-disable start → settle |
| `main.server-startup` | packaged harness startup request → verified harness readiness |
| `main.window-creation` | `BrowserWindow` construction start → constructor returned |
| `main.navigation` | `loadURL` request → renderer `did-finish-load` |
| `renderer.entry-to-shell-painted` | renderer entry evaluated → initial shell received two paint opportunities |
| `renderer.entry-to-shell-usable` | renderer entry evaluated → SSE connected, configuration present, an active agent present, and that committed state received two paint opportunities |
| `renderer.entry-to-onboarding-painted` | renderer entry evaluated → first-run onboarding received two paint opportunities |
| `desktop.module-to-shell-usable` | Electron main module evaluated → returning usable-shell paint |
| `desktop.module-to-onboarding-painted` | Electron main module evaluated → first-run onboarding paint |

The readiness definitions are intentionally explicit and versioned. Later atomic-bootstrap work may
tighten them; that change must document or version the semantics rather than silently comparing
unlike measurements.

## Cold, warm, and reopen terminology

- **Fresh profile** means a new Electron profile and new Cumea data directory for each sample.
- **Chromium cache-cold** means Chromium HTTP and code caches were cleared in a preceding maintenance
  process. It is not an OS-filesystem cold start.
- **Warm launch** means the process fully quit and relaunched while retaining one primed profile and
  its caches.
- **Dock reopen** will mean restoring a hidden, sanitized warm window. It is not comparable with a
  full process launch.
- **First-run profile** and **returning profile** are separate scenarios and must never be combined in
  one summary.

## Bundle budgets

After the production UI and harness are built, run:

```sh
pnpm perf:budget
```

`performance-budget.json` applies conservative ceilings to total output and the largest single file
in `dist/` and `dist-server/`. CI writes a local JSON/Markdown inventory under
`.context/performance/` and fails when a ceiling is exceeded. The initial limits are guardrails, not
performance targets; tighten them only after measuring stable production artifacts.

## Publishing a benchmark claim

A public before/after table must include:

- exact before and after commits;
- matching machine fingerprint and an honest hardware/OS description;
- packaged production build mode;
- matching profile, data fixture, cache treatment, and runtime;
- number of samples;
- median and p95, not only the best run;
- raw or summarized report artifacts;
- any trade-off, including memory regressions;
- a statement when the PR combines changes and cannot attribute gains individually.

Until a fixed-machine workflow and trend series exist, timing numbers remain diagnostic and must not
be presented as independently verified Cumea performance improvements.
