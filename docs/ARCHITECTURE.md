# Orivane Atlas 2.0 architecture

Current implementation overview. The [original v0 specification](architecture/arclattice-v0-architecture.md)
and historical ADRs record design history and future ideas; they are not claims
that every planned component exists. [Runtime audit](UNIFIED_UPGRADE.md) records
the integrated 2.0 boundaries.

## Frontend

AppShell, Sidebar, Topbar, WorkspaceRouter and InspectorHost organize features.
Neutral light/dark tokens, collapsible navigation, Command Palette and Undo are
shared Shell behavior. Web features call application contracts through bootstrap;
UI does not construct SQL repositories or invoke provider SDKs.

Project navigation is Overview / Tasks / Knowledge. Knowledge owns explicit space
binding workflows. DocumentWorkspace supports Markdown, revisions, diff/merge,
Wiki completion and same-Space document hierarchy. Assistant uses the actual active
document tab, server-generated approval manifests and durable session APIs.

## Application and domain

The dependency direction is UI → Application → Domain / Ports → Adapters.
Domain has no framework, database or AI SDK dependency. All business access is
workspace-bound; changes identify a principal and important entities use versions.

ProjectKnowledgeScope is shared by knowledge search, Wiki autocomplete, Knowledge
Graph and Retrieval. Ordering is current Space, primary owned, other owned,
linked, inherited, workspace fallback. Retrieval combines full text, aliases,
Wiki links/backlinks and recency. Shared capabilities delegate to authorized
application services; they never call database adapters directly.

## Storage

SQLite is the shipped account/HTTP Host backend. PostgreSQL provides real knowledge
Library, ProjectMaterial and AgentSession application adapters with shared parity
tests. Schema targets are SQLite24 / PostgreSQL17. This is not a PostgreSQL account
server or cross-backend automatic replication feature.

Document metadata, revisions, aliases, Wiki index, session changes and their
Activity/Outbox share transactions. Audit remains independent. Soft deletion and
workspace isolation continue. Wiki indexes are rebuildable; original Markdown and
immutable revision history are preserved. See [migration](MIGRATION_2.0.md).

## AI

Assistant → Capability / Retrieval → approved AiContext → Model Gateway → Provider
Adapter → provider. Context versions, route fingerprints, content policy and
session ownership are checked before approval/use. Gateway controls vault access,
reservations, budgets, usage, cancellation, timeout and uncertain-send settlement.

Adapters implement actual SSE streaming or explicitly opt out and use complete.
Unknown send outcomes and observed provider events cannot trigger automatic
fallback. UI consumes authorized transient events; final messages are persisted
in AgentSession, while AgentRun records one execution. Model tools/jsonSchema are
not advertised by adapters that cannot support them.

Administrator-managed exact endpoint trust participates in real DNS-pinned network
authorization; it does not bypass workspace content policies. Assistant and MCP
share capability implementations, with explicit risk and approval boundaries.
See [capability permissions](agent/ai-capabilities.md).

## Graph and removed UI

Project Dependency Graph is scoped Task → Task by default. Knowledge Graph is
document/Wiki relationships with local, space and workspace scopes. GraphCanvas
and its old layout worker are removed; there is no parallel legacy graph runtime.
Old independent project documents/graph/timeline/activity tabs are consolidated
into current navigation. The former long parent select and obsolete AI console
are replaced by the existing hierarchy picker and Assistant/settings flows.
