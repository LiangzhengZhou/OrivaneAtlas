# 0085 — Reminder stable original command replay

Status: implementation beginning, 2026-10-13.

Reminder remains its existing formal entity; no Task proxy and no parallel archive
or notification model. Local save/delete-state operations capture original input,
stable primary UUID, original version and deleted flag in the same entity/Outbox
transaction. Stable allocation uses optional ID purpose, leaving audit IDs ordinary.

Server replay invokes existing ReminderService through a narrow UnitOfWork guard
inside authenticated business/receipt transaction. It validates the complete single
Reminder effect and original version, rejects foreign or other business writes,
and publishes detached canonical accepted Reminder only after ordinary execution.
Human Cookie/CSRF only; stable ID/device paired; original command key preserved.
Legacy human and API tool save retain their ordinary ID/permission behavior.

Client original-intent serialization, canonical ACK/pull and coordinator routing
reuse existing scoped durable contracts. Reminder scheduling consumes the resulting
local durable entity after sync, not server timers. Full FINAL NotificationRecord,
local scheduler/attention policies and physical native acceptance remain separate
unfinished gates; Reminder replay does not claim their completion.

Verify real SQLite/PostgreSQL service+receipt transactions, duplicate/stale/rollback,
local restart/original command retention and real Host/coordinator browser path.
No schema rewrite or production data operation is needed.
