# Orivane Atlas 2.0 architecture

> Current local v2.3 implementation changes are recorded below; older sections
> describe the accepted 2.0 design and must not override current runtime contracts.

## v2.3 runtime changes under acceptance

The local shell mounts before session requests. Runtime initialization is shared
and explicit. `loadWorkspace()` first reads the authorized WorkspaceBootstrap
metadata manifest, then applies durable sequence changes in metadata body mode.
Notes and library entries have an explicit unloaded-body state; active document
opening reads the body through the application contract. Cache keys include server
generation, actor, entity and version; recovery clears cached bodies. Unloaded
metadata never becomes an empty draft or replaces Markdown content.

SQLite and PostgreSQL project metadata without returning Markdown bodies to the
host bootstrap serializer. Note/library search uses authorized RetrievalService
storage queries. Wiki index version and dirty state persist in append-only
migrations, with transactional write marking and clean-start rebuild gating.
Finite HTTP JSON negotiates Brotli/gzip; SSE remains streamed. Native JSON uses
UTF-8 while binary responses retain Base64 and existing transport guards.

Tasks presentation has a retained store subscribed only by TasksRoute; GraphRoute
owns graph URL and viewport updates. These controls no longer require a global
Workbench rerender. Documents opened from Graph display their active pane and
return to the preserved graph context. These changes remain under full visual,
performance and native acceptance; see ADR0056 and the v2.3 cold-start report.

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

## Interaction consistency upgrade (2026-10-02)

Project parent, Task membership/filter, AI configuration scope, plan preview and
recurrence membership share ProjectDrilldownPicker on HierarchyPicker. Document
parent uses the same browser restricted to its Space and excluding its own branch.
Search only inspects direct children; selection chips are separate from browsing.
Space selection groups recent/project/other spaces and keeps AI configuration
scope separate from explicit conversation context.

Atlas's main route renders conversation sessions, messages, approvals, visible
ContextBar and a sticky composer. Configuration and execution Activity are in
Settings. Browser fetch SSE is authorized for the owning principal on initial
access and each emitted frame. Native/disconnection fallback polls; replay events
are bounded transient memory, and durable AgentSession messages remain the source
of truth after restart.

NoteKnowledgeService promotes to an explicit-Space Document under the existing
SQLite request transaction, preserving text/policy/provenance and adding a source
KnowledgeLink. Optional source archival uses soft deletion and version checks.
Linking to Space creates no Document. Note/Journal Wiki references are derived
with wiki-core and shown as references/backlinks; no schema or PostgreSQL Note
adapter is introduced. The deprecated HTTP project-document command requires
spaceId; legacy plan publication without an explicit Space cannot silently create
one.

Workspace sync accepts incremental=1 and a cursor. An actor/workspace-scoped,
bounded snapshot cache returns collection upserts/removals and scalar changes;
unknown cursors reset to a full snapshot. Browser reconciliation preserves unchanged
entity references. The server still assembles the authoritative snapshot: this is
an incremental wire protocol, not database change capture or a reliable event bus.
Task status is optimistic with version-aware rollback, action pending blocks only
the affected task, and committed saves close the matching editor without invoking
the discard guard.

Knowledge Graph defaults to Document/local, Space/space, Project/project or
Workspace/workspace, resolves explicit search selections and groups broad scopes
by Space. Project dependency graphs optionally display one-hop external blockers,
not their entire remote dependency tree. Old #knowledge/#dependencies bookmarks
redirect to Library or the Tasks dependency view; generic relations remain advanced
Settings tools. NoteEditor and ProjectParentTree are removed.
