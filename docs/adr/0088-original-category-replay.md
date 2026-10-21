# 0088 — Category stable original save and reorder replay

Status: implementation beginning, 2026-10-13.

Preserve CategoryService naming uniqueness, presentation validation, soft deletion,
membership-aware reorder and CategoryChange transaction. Primary category creation
uses optional CATEGORY ID purpose; next() stays zero-argument and audit IDs ordinary.
Stable create checks authorization first and existing UUID including deleted rows
inside the same ordinary service UnitOfWork. No new category or ordering mechanism.

Local save/reorder captures original input and full ordered member/version list in
the existing entity/Outbox transaction. Reorder effects include only actual changed
categories; unchanged members remain validated by ordinary service against the
captured list. Do not reconstruct order from current projections or transmit ranks
as an alternative to original reorder intent.

Human authenticated Host runs through complete-effect guard inside business/receipt
transaction, consumes exact declared saveCategory versions and permits the matching
ordinary CategoryChange journal. Other business writes/foreign scope/stale members/
missing or extra effects reject and roll back. Shared client ACK/delta/recovery/
coordinator use canonical category boundaries and retain later pending local edits.
No schema rewrite. Original UUID/device/idempotency survives restart/backup.

Verify authorization before stable validation/lookup, SQL/PostgreSQL duplicate/CAS/
rollback, exact original request, partial reorder refusal, real Host/IndexedDB
restart and native exact method policy. Update REST contracts and tests. Remaining
all-family sync/binding/rebase/review and FINAL gates are still unfinished.
