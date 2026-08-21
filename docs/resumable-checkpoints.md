# Resumable run checkpoints

Cumea persists a small, versioned checkpoint at canonical run boundaries: provider acceptance, session changes, tool activity, approval requests, and provider completion boundaries. A checkpoint records ownership, the active transcript leaf, provider instance/model identity, a digest of the private provider cursor, and a monotonic sequence. It never stores the provider cursor, prompt, provider payload, credential, or filesystem path.

After an unexpected host restart, a previously active run becomes `interrupted`; it is never marked complete and never resumed automatically. The desktop Work panel can explicitly resume an `available` checkpoint. The paired mobile client receives only a boolean availability status and cannot resume or administer checkpoints.

Resume is fail-safe:

- The run, task, bot, checkpoint ID, canonical task message, active conversation leaf, attachments, and current provider are revalidated under the bot resource gate.
- A provider-native cursor is used only when the provider declares resume support and instance, model, active leaf, and cursor digest all still match.
- Otherwise Cumea starts a fresh provider session from the complete surviving text path and sends a bounded internal continuation instruction without adding another user message.
- An applying or unknown external-effect receipt blocks resume. The effect must be resolved locally first; Cumea never replays an unknown effect.
- A resume creates one linked run attempt, consumes the old checkpoint atomically, and does not duplicate task, transcript, attachment, or artifact records.

Portable backups may include the bounded checkpoint metadata and cursor digest, but never the raw provider cursor. Restore validation rejects unknown checkpoint fields, invalid ownership, inconsistent lifecycle/linkage, or a transcript leaf that is absent from the archived conversation.
