# 0080 — Atomic canonical Work delta and cursor projection

Status: Work-only implementation in progress, 2026-10-13.

Application validates authenticated journal scope, monotonic sequence, epoch and
projected values before preparing a local transaction. Receipt and pull paths share
canonical Work validation and JSON equality; Domain remains the policy authority.
One metadata read transaction captures revision, canonical bases and current rows.
Remote base provenance includes origin/workspace/principal/epoch. Pending local
content is retained while its canonical remote base advances. Untracked local ID
collisions require review rather than overwrite. Physical removals produce scoped
tombstones, preserving higher acknowledged deletion versions.

The strict replica transaction commits data/base and cursor together, creates no
user Outbox event and cannot acknowledge unrelated sending attempts. An unchanged
empty page returns no commit and performs no metadata read. Epoch recovery does not
clear pending changes. Unsupported collections stop cursor advancement rather than
silently dropping changes; Work-only support is not an all-collection sync claim.

Bootstrap exposes the guarded private Work delta transport, with the same identity
checks as receipt recovery and metadata body mode. Logging in does not call it.
The real isolated Host browser test runs offline create, authenticated push,
connection interruption, durable receipt recovery, ACK, delta pull and restart.
Subsequent offline edits remain pending. Explicit binding, rebase/push coordinator,
all-collection projections, body hydration and conflict UI remain open.
