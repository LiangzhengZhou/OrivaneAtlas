# ADR0027 — Approved model execution gateway

Accepted 2026-09-17. Incremental execution boundary, not the complete AI Gateway roadmap.

Move approved model dispatch checks and bounded execution into Application. The gateway accepts a trusted persisted RUNNING AgentRun plus its authenticated ActorContext, rechecks authorization through a host-owned callback immediately before dispatch, and resolves the current model after that check. Workspace, creator, approval, route fingerprint and input bounds must match. A route change invalidates approval; no automatic fallback is introduced because approval does not authorize another provider.

Use a private abort controller per execution. Both upstream cancellation and a finite deadline settle the request even if a provider ignores cancellation; aborted or expired execution cannot become success. Remove listeners and timers on every exit. Return stable sanitized failures without provider exception bodies, prompts or credentials. Host remains responsible for durable run CAS, approval quota, audit, and finish persistence. No external model calls are made during tests.

This does not claim provider/model registry, durable usage ledger, retry/fallback policies, full ADR0006 data guardrails, secret management UI, or admin routing have been implemented. Existing secure vault and single-route adapters remain unchanged. No schema/API changes or expanded Agent permissions.

2026-09-17 follow-up: immediately before dispatch, an authorized storage transaction reloads the RUNNING run/version and all approved context. Changed version/title/body, deletion, foreign workspace, deleted document parent, invalid kind or route-space mismatch rejects sending. This narrows stale-approval risk; it does not lock content across the external network call, implement DataPolicy, or constitute a usage ledger.
