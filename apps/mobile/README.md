# Cumea mobile companion

This Expo app is an authenticated companion for a Cumea desktop or user-owned
VM. Cumea does not provide or silently provision a cloud host. Provider CLIs,
credentials, tools, task history, and scheduled routines remain on the paired
host; the phone is a control surface.

No source code or assets from `margelo/ai-chat-demo` are included. Its public
interaction examples were treated only as product references because the
repository had no explicit software license when reviewed.

## Agent-first navigation

After onboarding and pairing, the root screen is the searchable agent list—not
a chat-history screen. It shows each named agent, role, latest activity, unread
state, Mote avatar, and “Needs you” state. Selecting an agent opens its chat.

The current source includes:

- onboarding that explains the self-hosted model;
- in-app QR scanning, explicit paste, and manual pairing paths;
- SecureStore persistence for the returned device bearer token;
- agent-list home, search, pull-to-refresh, and per-agent chat;
- text/file send, stop, bot creation, mark-read, and approval/question responses;
- “Needs you” and routine-status screens;
- native Mote avatars and reduced-motion behavior;
- an explicit local demo mode for interface review.

Demo data never proves that an agent or routine ran on a real host.

## Host and pairing contract

Production enrollment requires HTTPS and the one-time, high-entropy secret in
the host's `cumea://pair` payload. That string is an internal QR/paste format,
not an operating-system pairing flow: the app does not register `cumea` as a
custom scheme and never consumes pairing credentials from launch URLs or route
parameters. Credentials are populated only by scanning the QR inside the app,
explicitly pasting the payload, or entering the host, session, and secret fields
manually. The app claims `/api/pairing/claim`, stores the returned long-lived
token in SecureStore, and sends it as a bearer token on later calls. The
six-digit value shown on both devices is only a human verification code; it is
never accepted as a credential.

Camera access is requested only when the user chooses QR scanning. The host
stores only a SHA-256 hash of the device token and device revocation takes
effect on the next request.

See [`../../docs/self-hosted-mobile.md`](../../docs/self-hosted-mobile.md) for
the host listener, HTTPS, and reverse-proxy requirements.

## Live updates

The client consumes the authenticated, allowlisted `/api/events` SSE stream and
applies assistant deltas, settled messages, bot state, and workspace updates as
they arrive. It reconciles from `/api/mobile/bootstrap` after each connection,
pauses while inactive, and reconnects unexpected closures with bounded
exponential backoff. The host removes provider reasoning, credentials, raw
computer frames, and unknown event kinds before they reach the companion.
There are no push or background notifications yet.

## Current limits

- Real host execution requires the host and its provider runtime to remain
  online. Pairing does not move execution onto the phone.
- Attachment-only sends require a short instruction. The client uploads raw
  bytes to the selected bot before sending the returned attachment IDs. If a
  later upload or the send fails, already-uploaded files are deleted on a
  best-effort basis without hiding the original delivery error. The host also
  enforces 25 MiB per file and a persistent 100-file / 250-MiB quota per bot.
- Paired-host routine editing is read-only on mobile.
- Bootstrap is bounded; opening a chat requests 50-message cursor pages and
  loads older pages progressively while preserving the visible scroll anchor.
- Provider credentials, connector administration, live computer control,
  device administration, voice dictation, and model configuration remain
  local-only. When a host explicitly enables the capability, mobile can show a
  read-only computer preview that refreshes every four seconds in the
  foreground. Otherwise computer and microphone controls explain the limit
  instead of implying that an action happened.
- No store-signed build, physical-device camera/paste acceptance run,
  VoiceOver/TalkBack pass, or background-delivery test is claimed here.

## Develop and verify

Install workspace dependencies from the repository root, then run:

```sh
pnpm --filter @cumea/mobile start
pnpm --filter @cumea/mobile typecheck
pnpm --filter @cumea/mobile export
```

The app uses Expo SDK 57. A development build is the release-faithful path for
camera, permission, and distribution testing. Type checking or a JS export
alone is not evidence of a signed physical-device build.

Third-party licenses are listed in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
