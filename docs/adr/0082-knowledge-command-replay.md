# 0082 — Stable knowledge commands and transactional replay

Status: narrow implementation in progress, 2026-10-13.

Notes and Library create operations allocate stable primary UUIDs through the
existing optional ID-purpose port. Revision, Activity and Outbox allocation stays
on the ordinary generator; legacy zero-argument randomUUID remains supported.
Authorization precedes stable-ID validation and entity lookup. Existing Markdown,
hierarchy, privacy, revision and provenance policies remain in Application services.

LocalRuntime captures original save/delete/purge intent in the same durable local
transaction as entity effects and Outbox. The original body, primary UUID,
create/update distinction and original version survive restart and backup restore.

Human Cookie/CSRF Host save/delete requests may carry a scoped command envelope.
Stable create ID and device ID are paired; Bearer tools cannot use these fields or
command replay. The original raw request digest and device-stamped receipt remain
in the existing authenticated business transaction. KnowledgeReplayEffects checks
original versions and the complete declared set of Note/Library saves. Missing,
extra, foreign or stale writes reject the transaction. Canonical receipts are
detached, versioned and preserve original accepted values on duplicate requests.

Purge, binary writes, Project knowledge creation/link effects and additional
collection effects require separate complete-effect contracts. They are not
accepted by this narrow guard. Knowledge command serialization, local canonical
ACK/body hydration, all-family pull, explicit binding and conflict review remain
open; this decision does not claim complete bidirectional synchronization.

Verification: shared real SQLite/PostgreSQL stable knowledge/revision scenario;
offline IndexedDB restart and new-device backup restore with exact original intent;
real Host stable creation, duplicate/read-only receipt, stale conflict and whole
transaction rollback after a missing declared effect. No paid AI or production
server is required.
