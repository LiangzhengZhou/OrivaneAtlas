# 0087 — Original manual-order command replay

Status: implementation beginning, 2026-10-13.

ManualOrderService already owns authoritative scoped membership, sparse positions,
entry versions, aggregate CAS and Activity/Outbox. Preserve it. LocalRuntime move
captures detached original scope/version/entity/anchor/placement in the existing
atomic entity/Outbox transaction; do not reconstruct intent from the current rank
table or issue direct SQL/replica user mutations.

Guard the complete single manualOrders aggregate effect using its existing scope
key. Authenticated Host invokes ordinary service in the business/receipt transaction;
membership and invalid anchors remain ordinary Application checks. Other business
writes and mismatched scope/base/version rejected. No new entity, schema or second
manual-order mechanism. Original UUID/device/idempotency key survives restart.

Canonical aggregate validation must preserve individual entry identities/positions/
versions/ownership, unique members/positions and exact scope key. Share formal Domain
validation for scope/state where needed rather than copying it into Rust. Common
ACK/delta/recovery/coordinator must retain later pending aggregate edits. Structural
scope/membership conflicts cannot be silently overwritten; explicit conflict review
remains a separate unfinished Phase12 gate.

Verify real SQLite/PostgreSQL rollback/CAS/scope isolation, original intent retention,
canonical boundary, duplicate receipt and real Host+IndexedDB restart. Native policy
must explicitly allow only required method/path; no blanket /api/v1 authorization.
REST contract and generated/validated alias/reference checks updated together.
