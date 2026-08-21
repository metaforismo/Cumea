# Configurable ACP profiles

Cumea can connect a bot to any locally installed CLI that implements the Agent Client Protocol
(ACP) over JSON-RPC stdio. Each profile defines a trusted executable, its exact arguments, and the
models available through that login or subscription. Different bots may select different profiles
and models.

This is deliberately narrower than “every AI subscription”. A provider must expose an
ACP-compatible CLI; a web-only subscription or an arbitrary chat executable does not become ACP
because it is listed in Settings. The provider's own terms, authentication, quotas, and charges
still apply.

## Add a profile

Open **App Settings → CLI subscriptions & ACP** and provide:

- a display name;
- the executable name or absolute path;
- one exact command-line argument per line;
- one `model-id | Label` entry per supported model plus a default;
- optional ACP authentication method and absolute working directory;
- whether the CLI is enabled and whether Cumea must fail if ACP authentication is unavailable.

Use `{model}` inside an argument to substitute the model selected for that bot. Cumea calls the
executable directly with an argument array; there is no shell interpolation, quoting language, pipe,
redirect, command substitution, or environment-secret editor.

For example, a compatible CLI might require these four argument lines:

```text
agent
stdio
--model
{model}
```

The profile editor stores configuration in the user-owned Cumea config. Sign in through the CLI
itself. Do not put tokens in arguments because other local processes may be able to inspect argv.

## Agent collaboration

Every compatible ACP turn receives the same peer-agent MCP server as Cumea's built-in collaborative
providers. It offers:

- `list_bots` to discover visible agents and their current state;
- `ask_bot` to give one selected agent a bounded question/task and await its exact turn.

The handoff is recorded in Cumea's conversation and task evidence. This does not merge provider
accounts or share hidden bots. It is a Cumea-owned bridge mounted into each agent process.

## Consent and trust

The executable runs as the current operating-system user and receives the selected bot's prompts.
Only add CLIs you trust. Tool requests remain subject to the agent's approval policy unless **Always
approve tool requests** is explicitly enabled for that profile. That high-trust option is visible
and never inferred from a provider name.

Profile administration is loopback-desktop only. A paired mobile device can work with the bot it is
authorized to see, but cannot add executables, alter arguments, or read profile configuration.

## Current limitations

- The model catalog is explicit; Cumea does not yet import a changing provider catalog automatically.
- Availability uses the configured version command and a real turn, not a vendor-specific health API.
- Connected-app support depends on what the ACP CLI accepts through ACP/MCP; Cumea does not claim
  parity merely because chat works.
- Provider-native memory and subscription accounting remain outside Cumea unless the driver reports
  evidence through the canonical runtime contract.
