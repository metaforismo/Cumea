# Local runtime inspector

Cumea records two owner-local diagnostic streams per thread while providers run:

- `events/<threadId>.ndjson` — normalized `RuntimeEvent` records used by the harness;
- `native/<threadId>.ndjson` — provider-native protocol records already written by the driver tee.

P1.11a adds a desktop-only inspector over those existing files. It does **not** add telemetry, another capture stream, or a Cumea-operated diagnostics service.

## API boundary

Desktop-local only:

```text
GET /api/bots/<botId>/inspector?limit=<1..400>
```

The route resolves the bot first and therefore never accepts a caller-supplied filesystem path or raw thread filename. It is intentionally absent from the paired mobile allowlist.

## Bounds

The reader:

- accepts only bounded alphanumeric/underscore/hyphen thread identifiers;
- reads at most the newest 4 MiB from each diagnostic file;
- parses valid complete JSON lines and skips torn/corrupt diagnostic lines instead of failing the whole panel;
- returns at most 400 valid rows per lens;
- strips `RuntimeEvent.raw` from the normalized Events lens;
- clips long normalized text fields;
- caps each native payload projection to a small JSON budget and returns an omission/preview object when the payload is larger;
- reports when older rows exist outside the returned window.

The UI defaults to 180 recent rows and refreshes while the inspector is open.

## Privacy model

The Events lens contains normalized runtime metadata and bounded visible summaries. The Raw lens can contain conversation/provider protocol material and is therefore intentionally treated as **sensitive local diagnostics**.

Raw diagnostics:

- are never included in desktop bootstrap state;
- are never folded into transcript search;
- are never exposed through the remote/mobile allowlist;
- are not exported by transcript export;
- are not uploaded by Cumea.

The raw tee is still only as private as the local user account and the provider adapter that produced it. Cumea does not claim this protects against code already running with the same OS-user privileges.

## UX

The chat header opens a right-side **Runtime inspector**. It shares the same visual slot as Settings, Computer, Work, Apps, and other desktop panels.

The inspector has two lenses:

- **Events** — normalized turn/session/tool/request/usage/error records with a human-readable summary and expandable bounded JSON;
- **Raw** — inbound/outbound native protocol records with source labels and expandable bounded payloads.

Opening the inspector closes the other right-side panels. Changing the selected agent closes the inspector instead of silently showing diagnostics for a different thread.

## Evidence boundary

This feature helps diagnose provider and harness behavior; it is not an observability or support-upload system. No diagnostic contents should be used as public benchmark or release evidence unless separately reviewed for privacy and relevance.
