# 0072 — Atomic local canonical replica and acknowledgement

Status: implementation in progress, 2026-10-13.

Application prepares canonical records; the local adapter commits them with the
durable cursor and accepted Outbox removal in one strict IndexedDB transaction.
The transaction checks installation ownership, binding version/origin/workspace/
epoch/cursor, workspace revision, record versions and the exact sending attempt.
An accepted receipt requires a matching canonical remote base. Pending edits are
retained; canonical business records cannot overwrite another unsent mutation for
the same entity. Internal projections must be prepared by Application against the
same workspace revision. No user mutation or new Outbox entry is synthesized.

Append-only backend schema 4 adds a per-entity Outbox index, preserving previous
entities, identity, mutations, search index and backup schema. Completion means
transaction completion, never individual request success. Input is detached
before asynchronous callbacks. Invalidation hints follow successful completion.

This port is not server authorization, a sync coordinator, binding UX or epoch
recovery. Those remain separate Application/runtime work and acceptance gates.
