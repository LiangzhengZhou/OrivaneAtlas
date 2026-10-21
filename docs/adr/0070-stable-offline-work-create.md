# ADR 0070 — Stable offline Work creation through Application

Status: implementation in progress; authenticated sync runtime pending.

Offline entities already use stable UUIDs. Server reconciliation must preserve
them while deriving workspace/principal from authenticated context. Introduce an
explicit Application entry for creating a Work entity with a validated UUID v4
or v7; reuse the existing WorkService creation rules, hierarchy checks, effects
and transaction boundary. Generated auxiliary edge/event IDs remain server-side.

This entry is not an unchecked database insert, permission grant, import bypass
or second ownership model. It must retain work:create/graph:write and project
lifecycle rules. Normal product creation continues to use the injected generator.
Duplicate IDs must conflict unless the enclosing mutation receipt matches the
original operation. Receipt persistence and auth belong to the existing host and
storage request transaction; creating a stable ID alone is not replay idempotency.

No public endpoint or external capability is introduced by the Application entry
alone. Formal sync envelope, receipt contract, field rebase, canonical ACK/cursor
commit and explicit account binding still require separate runtime wiring/tests.
