# ADR 0065 — Server-free local workspace backup

Status: implementation in progress.

FINAL section62 requires local metadata, documents, files and manifest without
server availability, separately from existing Host backups. Export one coherent
IndexedDB metadata/outbox/cursor snapshot in a readonly transaction. Immutable,
content-addressed original blobs can then be read and verified independently;
missing/corrupt referenced bytes abort export rather than create a false backup.

Use a versioned binary container with a UTF-8 manifest and raw Blob sections.
No Base64 binary JSON, credentials, provider vault or remote authentication state.
The manifest declares that the credential vault is excluded. Include bodies and
revisions from durable records, never replace unloaded manifests with empty text.

Restore must validate format, sizes, hashes, scope, IDs and schema before any write.
Initial restore targets an empty isolated local database; replacing an occupied
workspace or silently merging an account is forbidden. Preserve stable mutation
identities and pending state; device identity handling must be explicit.

Export/restore are exceptional full-data operations, not normal bootstrap/sync.
Budgets, corruption, upgraded stores and restart recovery require actual tests.
