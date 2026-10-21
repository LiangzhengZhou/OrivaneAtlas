# 0074 — Stable business effect IDs without reusing client audit IDs

Status: implementation in progress, 2026-10-13.

Local entity/Outbox staging allocates IDs that do not exist in SQL repository
execution. Replaying a flat list of all local allocations would shift subsequent
edge IDs and could confuse client mutation IDs with server audit/event IDs.

WorkService therefore identifies WORK, EDGE, ACTIVITY and OUTBOX allocation
purposes through optional nextFor on the existing Application IdGenerator port.
The original next() remains argument-free, including adapters that directly use
Node randomUUID; purposes must never be passed as UUID options.
Stable Work/Edge entry points retain the
ordinary authorization, hierarchy, dependency and transactional rules. A server
command replay adapter may supply approved expected business effect IDs for WORK
and EDGE; ACTIVITY/OUTBOX IDs and attribution remain server controlled.

Domain has no new database or transport dependency. No Rust rule copy, direct SQL
mutation, client-authorized audit or server replay completion is introduced.
Authenticated grouped replay/effect preconditions and receipt contract remain
separate acceptance work.
