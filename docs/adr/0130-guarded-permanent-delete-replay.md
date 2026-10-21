# ADR0130 — Complete-effect permanent delete replay

2026-10-20, implementation in progress. Not release acceptance.

Existing Work/Note/Library local purge commands are durable but were not accepted
by the sync coordinator. Add a separate complete-effect contract, without opening
the narrow Work/Knowledge replay guards to arbitrary destructive writes.

The authenticated Host runs ordinary purge Application services in the existing
business/Activity/Outbox/receipt transaction. A metadata snapshot before and after
must exactly match the requested effects and original versions, including related
edges, organization, project references, workflow updates and the current owner's
Memo. Extra, missing, stale or unrelated effects roll back the entire transaction.
Other owners' private Memo content is never read or returned. Database-owned
cleanup of their rows remains internal to the existing purge semantics.

Original command/device identity and idempotency digest remain immutable. Lost
responses recover through the existing authenticated receipt lookup and atomic
ACK; deletion is never inferred from an untrusted404. Canonical private Memo IDs
are mapped from the captured owner binding. Remote deletes remain durable journal
events. No schema change or relaxed CAS, bearer, CSRF or owner rule is introduced.

Public mutation documentation must register the new optional syncCommand shape.
Tests must exercise real Host/IndexedDB recovery, stale and forged-effect rollback,
private owner isolation, and affected SQLite/PostgreSQL purge parity.
