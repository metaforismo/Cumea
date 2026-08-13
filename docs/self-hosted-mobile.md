# Self-hosted mobile access

Cumea does not provide or silently provision a cloud machine. The desktop
harness remains loopback-only by default. A user who wants mobile access while
their laptop is off can run the same harness on a machine they control (for
example a home server or VM) and keep that host online.

## Security model

- `CUMEA_PORT` is the existing desktop listener. It always binds to
  `127.0.0.1` and keeps the local Electron workflow unchanged.
- Remote access creates a **second** listener. It is disabled unless
  `CUMEA_REMOTE_ACCESS=1` is set and every request on it is authenticated,
  except the one-time pairing claim.
- The remote listener binds to `127.0.0.1` by default. Put an HTTPS reverse
  proxy, authenticated tunnel, or private-network gateway in front of it.
- Pairing secrets are 256-bit random values, expire after five minutes by
  default, and can be claimed once. Pairing sessions are memory-only and do not
  survive a harness restart.
- Mobile bearer tokens are shown once. Only SHA-256 hashes are written to
  `~/.cumea/mobile-devices.json`, with owner-only file permissions.
- Remote snapshots and events are structural allowlists, not copies of the
  local state: hidden bots, provider errors, system prompts, model reasoning,
  provider-native request details, raw computer frames, and configuration
  fields are omitted. Conversation and handoff messages are included. Approval
  cards include the minimum title/subtitle/options plus request identifier/type
  and tool name required for an authenticated mobile user to answer `Needs you`.
- Provider keys, connector administration, instance configuration, computer
  execution, routine administration, and device administration are not
  available on the mobile listener. Mobile snapshots omit provider/model
  selection, provider resume cursors, per-bot admin policy, computer
  configuration, and profile email.
- Read-only computer preview is a separate, disabled-by-default capability. It
  never starts a capture or controls the host; it can return only the latest
  frame already captured by an active desktop session or transcript.

The bearer token grants access to the user's bot conversations and actions.
Transport encryption is therefore mandatory outside local development. Cumea's
Node listener is HTTP; TLS must terminate at the user's reverse proxy or secure
tunnel. Do not expose its raw port to the public internet.

## Enable a host

Example environment for a reverse proxy on the same machine:

```sh
CUMEA_REMOTE_ACCESS=1 \
CUMEA_REMOTE_PUBLIC_URL=https://cumea.example.com \
CUMEA_REMOTE_PORT=8800 \
pnpm dev:server
```

The remote listener remains on `127.0.0.1:8800`; configure the HTTPS proxy to
forward only to that address. `CUMEA_REMOTE_PUBLIC_URL` must be a bare HTTPS
origin (no path, query, fragment, or embedded credentials).

Binding directly to a non-loopback interface requires the additional explicit
`CUMEA_REMOTE_ALLOW_DIRECT_BIND=1` acknowledgement. That mode still serves
plain HTTP internally and should only be used behind a correctly firewalled
private network or TLS gateway. HTTP public URLs are rejected unless
`CUMEA_REMOTE_ALLOW_INSECURE=1` is explicitly set; that escape hatch is for
loopback development and tests only.

To let paired devices view the latest already-captured computer frame, add
`CUMEA_REMOTE_SCREEN_PREVIEW=1`. This grants every active paired-device token
read access to that preview. Leave it unset on hosts where screenshots may
contain sensitive information. Responses are restricted to validated PNG/JPEG
data up to 5 MiB, are marked `Cache-Control: no-store`, and do not expose live
computer input or an on-demand capture endpoint.

## Pairing protocol

The trusted local UI creates a short-lived session:

```http
POST http://127.0.0.1:8799/api/pairing/sessions
Content-Type: application/json

{}
```

The response is never cached and includes:

```json
{
  "session": {
    "id": "uuid",
    "secret": "one-time-base64url-secret",
    "hostUrl": "https://cumea.example.com",
    "hostName": "My Cumea host",
    "claimUrl": "https://cumea.example.com/api/pairing/claim",
    "expiresAt": 1780000000000,
    "verificationCode": "123456",
    "pairingUri": "cumea://pair?..."
  }
}
```

The QR code should encode `pairingUri`. That URI is an internal QR/paste payload,
not an operating-system deep link: the mobile app deliberately does not register
the `cumea` scheme or accept pairing credentials from launch URLs, because a
different installed app could claim the same custom scheme. Scan it inside
Cumea, paste it explicitly, or enter the fields manually. The six-digit
verification code is for the user to compare on both screens; it is not a
replacement for the embedded high-entropy secret.

The mobile app claims the session through the remote listener:

```http
POST https://cumea.example.com/api/pairing/claim
Content-Type: application/json

{"sessionId":"uuid","secret":"...","deviceName":"Francesco's iPhone"}
```

The response contains the bearer `token` once. Store it in the operating
system's secure credential store, never AsyncStorage or application logs.
Because the session is one-time, a client that loses the successful claim
response must create a new pairing session; reusing the old secret is rejected.

## Mobile API

Send `Authorization: Bearer <token>` on every subsequent remote request.
The intentionally narrow first mobile surface is:

- `GET /api/mobile/bootstrap` — host name, profile display name, visible bots
  with their latest 50 messages, enabled capabilities, and the durable work
  snapshot.
- `GET /api/bots` and `GET /api/work` — bounded reconciliation snapshots.
- `GET /api/events` — authenticated event stream for clients capable of
  supplying an Authorization header.
- `GET /api/bots/:id/messages?limit=…&before=…` — a bounded message page;
  `limit` is capped at 200.
- `POST /api/bots` — create a bot using only `name` and `title`; provider and
  policy selection stay local.
- `PATCH /api/bots/:id` — update only the `unread` flag from mobile.
- `POST /api/bots/:id/attachments` — upload one raw file, up to 25 MiB, with
  `Content-Type` and an encoded `X-File-Name`; use the returned ID when sending.
  Persistent per-bot quotas cap storage at 100 files and 250 MiB.
- `DELETE /api/attachments/:id` — best-effort rollback of an unused upload;
  attachments already referenced by the audit trail are retained.
- `POST /api/bots/:id/messages` — start a bot turn.
- `POST /api/bots/:id/respond` — answer a provider question or approval.
- `POST /api/bots/:id/interrupt` — stop the current turn.
- `GET /api/bots/:id/computer-preview` — only when the host explicitly enables
  the capability; latest read-only PNG/JPEG frame or `{ "available": false }`.
- `GET /api/health` — authenticated remote health check without the local PID.

Editing or deleting bot configuration, routines, providers, connectors,
computer control, and all device-admin routes remain local-only.

The local UI can list and revoke devices with `GET /api/devices` and
`DELETE /api/devices/:id`. Revocation takes effect on the next request.
