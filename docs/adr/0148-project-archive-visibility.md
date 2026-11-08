# ADR 0148 — Atomic project archive and recoverable trash batches

2026-11-06. Accepted by the user in Session393.

Archive moves live OWNED project materials, their spaces, space documents and
files into Trash. LINKED references and already deleted resources are unchanged.
A shared OWNED target is rejected instead of silently affecting another owner.
Subprojects are independent; this operation does not archive their resources.

WorkService.update(archived) runs the complete operation in the workspace
transaction, with Activity and Outbox. WorkItem.archiveBatchJson stores a stable
project/version batch identity and each affected collection/id/tombstone version.
The field is application-owned and cannot be supplied through mutation input.
SQLite 51 / PostgreSQL 46 add its nullable column. Existing unshipped archive
migrations also backfill old project archive flags without deleting metadata.

Restore processes parents before children and only restores unchanged versions
from that batch. Independently deleted pre-existing resources are never members.
Later edited, separately restored/deleted or purged members are left untouched.
A still-deleted parent blocks dependent restoration atomically. Markdown and
file bytes are preserved; only lifecycle metadata and versions change.

Work replay now guards the exact items/library/files/projectMaterials effects.
Unexpected effects, version conflicts or failures roll back the entire batch.
The existing work.update endpoint, authentication and idempotency receipt remain
in use. Archiving requires work:delete in addition to work:update; restore needs
work:update. It is not a reliable-message claim about in-memory adapters.

Local metadata-only bodies must be hydrated through the authenticated body
reader before the durable transaction can succeed. Offline clients without the
required bodies fail without partial changes; cached bodies support offline
archive/recovery and one replayable command batch.

Validation covers CAS, rollback, ownership, previous deletion, intervening edits,
replay effects/ACK, IndexedDB restart, SQL migration/backup recovery, and UI
archive/restore in all three browser configurations.

## Legacy organization compatibility (Lead review 2026-11-07)

The legacy `/api/organize` archive action for WORK remains metadata-only for
backward compatibility and continues to write `organization.archived`. It is
not silently rerouted to the new work transaction, because routing it would
suddenly cascade resource deletion for old clients and break the existing
contract tests. The new UI and any new client use `work.update { archived }`,
which is atomic and batch-recoverable. Removing or migrating the legacy endpoint
requires a separately announced client cutover. Existing project archive flags
are backfilled by the additive migration, so new readers see the correct
archived projection.
