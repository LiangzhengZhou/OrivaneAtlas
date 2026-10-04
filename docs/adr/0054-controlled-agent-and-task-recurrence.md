# ADR 0054 — Task recurrence workflow and controlled Atlas agent

Accepted 2026-10-04.

Task recurrence editing preserves Definition / Occurrence / WorkItem identities.
A new repeat draft saves its definition and eligible first occurrence in one
Application transaction. Conversion binds the existing versioned task to the
first occurrence; it never creates a duplicate task. Conversion has its own
Activity/Outbox event. Series changes preserve immutable occurrence snapshots.
Both storage adapters append migrations, with existing backup/restore gates.

Model routing and retrieval context are separate resolvers. Provider HTTP belongs
in adapters. Atlas and MCP share one capability registry and authorized service.
Agent loops have bounded steps, tool calls, writes, time and context; real approval
state binds current route/context/entity versions and cannot be supplied by a model.
Credentials retain encrypted owner-scoped atomic vault storage and are never returned.

Implementation detail and official protocol references are recorded in
`docs/architecture/atlas-controlled-agent-runtime.md`. Provider catalog format 2
reads existing encrypted arrays and centralizes credentials with owner/version
CAS. Canonical capabilities generate MCP and Atlas tools; private preview is
separate from human-approved plan publication. Every additional model step has
a durable counted reservation. Mutation/tool audit/resume checkpoint are atomic.
Context changes invalidate approval; stopping a waiting run executes no tool.

Workspace SSE is a cursor-only in-memory invalidation mechanism, deliberately
not a reliable DB event log. Clients pull incremental snapshots and handle
reconnect, duplicate events, visibility, offline and coalesced cursor races.
Native/disconnected clients retain bounded polling fallback. Graph route state
and viewport selection are independent of topology-derived layout.
