# ADR 0041 — Versioned local draft recovery

Accepted 2026-09-19.

IndexedDB draft records are a recoverable local cache, not an authoritative store
or an offline write queue. Existing server/workspace/principal/document keys are
retained. Add entityId, baseVersion, baseUpdatedAt and savedAt to every new record.
Legacy records lacking metadata remain readable but require explicit recovery.

A draft may resume autosave only when its identity and base revision exactly match
the loaded entity. Older, newer or unknown bases enter the existing compare/merge
flow. Ordinary Save and autosave cannot bypass that flow. Explicit merge uses the
latest observed version with server optimistic concurrency; choosing the server
clears the cache. Draft metadata is never silently advanced during a conflict.

SELF_HOSTING already permits local drafts while DEVELOPMENT incorrectly prohibited
all user data in browser storage. Clarify the exception for these isolated draft
caches; credentials and secrets remain prohibited. Sensitive/secret content does
not generate new persistent drafts. Existing records are not silently deleted.
No database schema migration is needed for additive IndexedDB value fields.
