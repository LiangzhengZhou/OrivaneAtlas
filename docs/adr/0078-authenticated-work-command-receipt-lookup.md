# 0078 — Read-only recovery of device-scoped Work receipts

Status: implementation in progress, 2026-10-13.

An interrupted sender first queries the existing durable request ledger by its
original command UUID and device UUID. Application exposes MutationReceiptReader;
SQLite and PostgreSQL authenticate current workspace membership before querying
the workspace/principal/key/device tuple. Missing and foreign-device receipts both
return null. Legacy receipts without a device, including secret-once operations,
cannot be returned. Reads do not execute a business callback or append events.

GET /api/sync/receipt and its /api/v1 alias require the owner's authenticated
session; Bearer integrations cannot recover these human-owned receipts. Neither
workspace nor principal is accepted from the caller. The result is the original
stored canonical value, even after subsequent remote edits. No new migration or
second receipt ledger is introduced.

The live isolated browser test queries this endpoint before applying its atomic
IndexedDB acknowledgement and verifies that a different device receives 404.
This endpoint is recovery infrastructure, not a completed bidirectional sync
coordinator. Production binding, receipt-first attempted-command recovery,
pull/rebase/push ordering and all remaining FINAL phases still require wiring.
