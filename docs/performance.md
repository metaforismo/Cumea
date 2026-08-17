# Desktop performance evidence

Cumea treats responsiveness as a tested product property, not a screenshot claim. Performance
reports are local, opt-in files: the application does not upload them, add telemetry, or include
provider prompts, transcripts, credentials, file paths, or connected-app payloads.

This first tranche establishes timing marks, a versioned report format, summary/comparison tooling,
and deterministic bundle budgets. A packaged multi-sample runner and fixed-machine trend history are
tracked separately in `TODO.md`; until they land, collection is an explicit local procedure.

## Collect one timing report

Set a report path before starting Electron. The directory is created with owner-only intent and the
file is replaced atomically as new marks arrive.

```sh
CUMEA_PERFORMANCE_FILE=.context/performance/baseline-01.json \
CUMEA_PERFORMANCE_LABEL=baseline \
pnpm dev:desktop
```

For a packaged executable, the same environment variables work. A benchmark harness may also set
`CUMEA_PERFORMANCE_AUTO_QUIT=1`; Cumea then quits only after the usable shell has painted and the
report has been flushed.

Optional metadata is deliberately narrow:

- `CUMEA_PERFORMANCE_LABEL` — human-readable run label;
- `CUMEA_PERFORMANCE_SAMPLE` — sample identifier;
- `CUMEA_PERFORMANCE_COMMIT` — commit under test, with `GITHUB_SHA` as a fallback.

Do not put secrets or user data in those values. Unknown renderer marks and malformed clocks are
rejected by an exact allowlist in the Electron main process.

## Summarize repeated samples

Collect multiple reports under a fixed machine, operating system, build mode, data fixture, and
measurement protocol. Then produce JSON and Markdown evidence:

```sh
pnpm perf:summary -- \
  --label baseline \
  --out .context/performance/baseline \
  .context/performance/baseline-samples
```

The summary records sample counts, median, p95, minimum, maximum, commit, application version,
platform, architecture, and whether the app was packaged.

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
can be compared without assuming that their `performance.timeOrigin` values are identical.

| Metric | Definition |
|---|---|
| `main.module-to-ready` | Electron main module evaluated → Electron `ready` event |
| `main.cua-initialization` | current blocking local-computer initialization start → settle |
| `main.server-startup` | packaged harness startup request → verified harness readiness |
| `main.window-creation` | `BrowserWindow` construction start → constructor returned |
| `main.navigation` | `loadURL` request → renderer `did-finish-load` |
| `renderer.entry-to-shell-painted` | renderer entry evaluated → initial shell received two paint opportunities |
| `renderer.entry-to-shell-usable` | renderer entry evaluated → SSE connected, configuration present, an active agent present, and that committed state received two paint opportunities |
| `desktop.module-to-shell-usable` | Electron main module evaluated → the usable-shell paint above |

The current usable-shell definition is intentionally explicit and versioned. Later atomic-bootstrap
work may tighten the readiness contract; that change must bump or document the metric semantics
rather than silently comparing unlike measurements.

## Cold, warm, and reopen terminology

Do not call a sample “cold” without saying what was cleared.

- **Chromium cache-cold** means Chromium HTTP and code caches were cleared. It is not an operating-
  system filesystem cold start.
- **Warm launch** means the process fully quit and relaunched while retaining the same primed profile
  and caches.
- **Dock reopen** will mean restoring a hidden, sanitized warm window. It is not comparable with a
  full process launch.
- **First-run profile** and **returning profile** must be reported separately.

The forthcoming packaged runner will encode those profiles so manual naming cannot accidentally mix
their results.

## Bundle budgets

After the production UI and harness are built, run:

```sh
pnpm perf:budget
```

`performance-budget.json` currently applies conservative ceilings to total output and the largest
single file in `dist/` and `dist-server/`. CI writes a local JSON/Markdown inventory under
`.context/performance/` and fails when a ceiling is exceeded. The initial limits are guardrails, not
performance targets; tighten them only after measuring stable production artifacts.

## Publishing a benchmark claim

A public before/after table must include:

- exact before and after commits;
- hardware and operating-system version;
- packaged production build mode;
- profile/data fixture and cache treatment;
- number of samples;
- median and p95, not only the best run;
- raw or summarized report artifacts;
- any trade-off, including memory regressions;
- a statement when the PR combines changes and cannot attribute gains individually.

Until a fixed-machine multi-sample run exists, timing numbers are diagnostic only and must not be
presented as verified Cumea performance improvements.
