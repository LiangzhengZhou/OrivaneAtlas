# 0083 — Body-aware local knowledge receipt projection

Status: receipt/recovery foundation in progress, 2026-10-13.

Knowledge receipts share the existing exact command/device/attempt, actor/binding,
canonical-version, pending-edit and replica CAS checks. Unlike Work, a Note or
Library receipt must contain the authoritative original Markdown body, not an
unloaded bootstrap manifest. Validate ownership, versions, kind, timestamps,
provenance and privacy policy before any durable confirmation.

When no later pending mutation exists, project the canonical local manifest, body,
revision, precomputed search text and Library Wiki source in the same replica
transaction as remote base and complete Outbox ACK. The cursor does not advance
from a receipt. Derived records use the existing internal version CAS and paired
entity requirement. Original remote ownership remains in the remote base; local
projection maps to the installation namespace. No new user Outbox is generated.

If later pending edits exist, retain every local business/body/index/revision
record and update only the canonical remote base and accepted original group.
Wrong device, foreign workspace, malformed/unloaded body or stale receipt is
rejected. Accepted canonical data remains detached from caller mutation.

Private receipt-first recovery may process knowledge commands when supplied the
existing local Wiki parser/resolver. It uses original attempted command IDs and
installation device, never resets uncertain attempts or pushes. Bootstrap pins
server generation and authenticated origin/workspace/principal before/after IO.
Login alone never binds, merges or sends content.

This is not all-family pull/push acceptance. Metadata body availability and lazy
hydration, canonical refresh/rebase, conflict review and explicit first binding
remain open. These must not overwrite local Markdown or treat missing remote
bodies as empty drafts. Domain/business rules stay in Application, not Rust.
