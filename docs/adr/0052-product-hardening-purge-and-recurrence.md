# ADR 0052 — Explicit purge and recurrence windows

Accepted 2026-10-03.

Permanent deletion is an explicit authorized Application mutation, permitted
only for an already soft-deleted entity at its expected version. Adapters delete
the entity and related projections in the same workspace transaction. A project
with children and a space with documents require those children to be purged
first; no implicit recursive deletion is introduced. Activity and Outbox retain
the purge event, with no deleted Markdown in the event. Audit remains independent.
Public mutations use the existing idempotency boundary.

Recurrence state is ACTIVE, PAUSED or ENDED, independent of deletedAt. Occurrence
windows have expiresAt and closedAt; completion is reconciled before expiration
and generation. Expired incomplete occurrences become MISSED, optionally
canceling their task with reason RECURRENCE_WINDOW_EXPIRED. WorkStatus remains
unchanged. Definition endDate limits generation, never an occurrence window.
Immutable occurrence rule snapshots remain authoritative for historical backfill.
Defaults for old payloads are ACTIVE / END_OF_DAY / closeIncomplete=true;
SQLite and PostgreSQL migrations preserve history and support verified backups.
Legacy recurrence deletedAt represented Pause in v2.0.1: migration translates it
to PAUSED and clears deletedAt. Live definitions default to ACTIVE. Old CREATED
occurrences become OPEN; read normalization supplies expiry from their immutable
rule snapshot, or the definition, with a UTC end-of-day fallback for an orphan.

Statistics use occurrences, including historical MISSED slots, with local Today,
inclusive last seven calendar days and current natural month windows. A paused
interval must not manufacture expected occurrences.

Notification planning is platform-neutral Application logic. Native scheduling
must persist beyond the WebView lifetime and respect platform permissions;
frontend timers are not notification delivery.
