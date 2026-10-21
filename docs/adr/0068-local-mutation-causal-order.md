# ADR 0068 — Local mutation causal order

Status: implementation in progress; bidirectional replay acceptance pending.

Random UUIDs and equal millisecond timestamps do not preserve creation order.
Project, child project and task writes can share a timestamp; replay must not
accidentally reverse their dependencies. New Application transactions stamp each
mutation with the existing workspace revision and its operation offset. The
revision CAS and entity/Outbox commit already share one atomic transaction.

This optional additive JSON field requires no historical SQL/IndexedDB schema
rewrite. Stable entity, mutation and device IDs remain unchanged. Outbox reads
sort ordered mutations by revision/offset. Legacy unstamped records are retained
ahead of new records, with deterministic timestamp/ID fallback for inspection;
this fallback is not sufficient for structural replay. The future rebase/replay
planner must explicitly resolve legacy dependencies before push, not silently
assume this ordering is authoritative.

Backup/restore and metadata commit reject malformed order stamps. Sync attempt
state, acknowledgement, authenticated binding, cursor/epoch recovery and conflict
handling remain separate work. No automatic account binding is introduced.

## Attempt transition boundary

Application validates PENDING → SENDING and SENDING → PENDING/CONFLICT/REJECTED.
The IndexedDB adapter reads the binding and mutation in one strict transaction.
Expected binding version, remote workspace and origin plus mutation state,
attempt count and timestamp reject stale senders/responses. Sending increments
attempt metadata durably before transport; recovery retains original IDs/content.
Accepted acknowledgement is deliberately separate: deleting an Outbox entry must
share a durable canonical-entity/cursor operation, never just an HTTP success.

Real browser tests verify concurrent claims, retry, old attempt and changed
binding rejection, recovery and reopen. Worker ownership, legacy dependency
planning, authenticated server envelope and bidirectional runtime wiring remain
open. Startup recovery is not permission to recover another live worker's claim.
