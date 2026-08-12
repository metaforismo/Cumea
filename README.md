# Cumea

> A council of agents. One clear voice.

Cumea is an open-source desktop workspace where each conversation is a real AI agent. Agents can
use different local CLI runtimes, keep separate context, ask one another for help, request approval
for sensitive actions, and optionally work with connected apps or computers.

> **Project status:** early development. Build from source; no signed or notarized Cumea release is
> published yet. macOS is the primary desktop target while the harness is continuously tested on
> macOS, Linux, and Windows.

[![CI](https://github.com/metaforismo/Cumea/actions/workflows/ci.yml/badge.svg)](https://github.com/metaforismo/Cumea/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Why Cumea

Most assistants are a single chat attached to a single model. Cumea treats agents as a small,
visible team:

- one thread and persona per agent;
- Claude Code, Codex, Grok, and Gemini CLI adapters behind one driver contract;
- agent-to-agent delegation with recursion limits;
- explicit allow/deny cards for actions that need consent;
- optional local or cloud computer use;
- optional connected-app tools through Composio;
- local transcripts, configuration, and event logs.

The product name comes from the Sibyl of Cumae: one interface that gives a clear voice to a council
of agents.

## Privacy and security defaults

- Cumea ships with **no analytics or telemetry SDK**.
- App data is stored under `~/.cumea/`; there is no migration from or shared state with OpenMausBot.
- The harness binds to `127.0.0.1` and rejects state-changing browser requests from foreign origins.
- Configuration secrets are never returned by the API and `config.json` is written with owner-only
  permissions where the platform supports them.
- External links are limited to HTTPS, with HTTP allowed only for loopback development URLs.
- Agents do not receive blanket approval by default. Provider modes that bypass consent remain an
  explicit user choice.

Third-party services are contacted only when you configure or invoke them. Their own terms, data
handling, subscriptions, and usage charges still apply.

See [SECURITY.md](SECURITY.md) for the reporting policy and threat boundaries.

## Optional credentials

No third-party credential is required to open Cumea or use an already-authenticated local agent CLI.
The Settings help icon explains where each optional secret is obtained, when it leaves the machine,
and where charges may apply.

| Credential | What it enables | Sent to |
|---|---|---|
| [Composio Connect API key](https://docs.composio.dev/docs/composio-connect) | App discovery, OAuth connection, and app actions | `connect.composio.dev`, only when connected apps are used |
| [Composio project API key](https://docs.composio.dev/reference/authenticating-to-composio) | Full connected-app catalog; optional and preferably scoped | `backend.composio.dev`, only while loading that catalog |
| [Cloud computer token](https://box.ascii.dev) | Remote desktop provisioning and control | `box.ascii.dev`, only for cloud-computer actions |

Credentials are stored in `~/.cumea/config.json` with owner-only permissions where supported. Cumea
does not proxy them through a Cumea-operated service.

## Run from source

Requirements:

- Node.js 24+
- pnpm 10.33+
- at least one supported agent CLI installed and authenticated to run real turns
- macOS for the current Electron computer-use and dictation integration

```sh
git clone https://github.com/metaforismo/Cumea.git
cd Cumea
pnpm install
```

Start the harness and UI in separate terminals:

```sh
pnpm dev:server
pnpm dev
```

For the Electron shell:

```sh
pnpm dev:desktop
```

The browser UI runs on `http://127.0.0.1:5199`; the local harness uses
`http://127.0.0.1:8799`.

## Verify a change

```sh
pnpm typecheck
pnpm test
pnpm build
```

The CI matrix runs type checking and tests on macOS, Ubuntu, and Windows, plus a production UI build
on Ubuntu. A green CI run is not evidence that native desktop behavior was exercised on every OS;
platform validation is tracked separately in the roadmap.

## Architecture

| Path | Responsibility |
|---|---|
| `src/` | React desktop UI and client-side state folding |
| `server/index.ts` | loopback HTTP/SSE harness and turn orchestration |
| `server/contracts.ts` | provider driver and canonical event contracts |
| `server/drivers/` | Claude, Codex, Grok, Gemini, computer, and peer-agent adapters |
| `server/harness/` | provider registry and event bus |
| `electron/` | desktop shell, native permissions, dictation, and local computer use |

The renderer owns no provider transport. Commands cross the local API, providers emit one canonical
event stream, and the UI folds that stream into visible conversation state.

## Direction

The immediate priorities are reliability and consent, then a shared portability layer for Linux
and Windows. Provider experiments and large visual changes follow only after the core is dependable.
See [ROADMAP.md](ROADMAP.md) for the ordered backlog and
[docs/UPSTREAM.md](docs/UPSTREAM.md) for the upstream issue/PR audit behind it.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening an issue or pull request. Small, testable
changes are preferred; security-sensitive changes need an explicit threat-boundary explanation.

Scheduled Dependabot version-update PRs are disabled. GitHub vulnerability alerts and automatic
security fixes remain enabled as the safer default; maintainers still review every proposed update
and may replace it with a pinned, manually tested tranche. Disabling security-fix PRs is a separate
repository-security decision.

## Provenance

Cumea began from the MIT-licensed
[OpenMausBot](https://github.com/milind-soni/OpenMausBot) codebase at commit `dea4de8`. It is an
independent project: it does not share application data, release artifacts, telemetry, or governance
with OpenMausBot. The original Git history and copyright notice are retained.

## License

[MIT](LICENSE). Copyright remains with the original OpenMausBot authors for their work; subsequent
Cumea contributions remain with their respective contributors under the same license.
