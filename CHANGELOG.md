# Changelog

## [2.0.2]

Product Hardening & UX Upgrade.

- Lazy root-only Projects, portal menus, dirty-safe dialogs, expanded graphs and Settings reorder.
- Authorized permanent purge and soft-delete Undo across Work, Notes and Library.
- Explicit recurrence state, occurrence expiry/reconciliation and Today/7 Days/natural Month statistics.
- Snapshot Library, bounded AI Activity reads, derived indexes, persistent scoped picker Recent and App route extraction.
- Notification planner with Windows scheduled toast and Android WorkManager adapters; device acceptance limits documented.
- SQLite schema26 / PostgreSQL schema19 migrations with legacy defaults and verified backups. Upgrade the matching server before clients.

## [2.0.1]

Interaction consistency and product cleanup release.

- Shared current-level Project/Document drill-down selectors across editing, filters, AI scope and workflows.
- Sidebar collapse controls remain in the Sidebar; document popovers work on desktop and mobile.
- Atlas opens conversations with explicit context and a sticky composer; configuration and Activity live in Settings.
- Notes/Journal support explicit-Space promotion, linking and Wiki references/backlinks without losing Markdown.
- Project Knowledge opens Pages in DocumentWorkspace; implicit Space creation and legacy editors are removed.
- Entity/action pending, optimistic Task status rollback and cursor incremental transport preserve responsive editing.
- Browser SSE uses authenticated streaming with native polling fallback; graphs have contextual scope, Space clusters and optional external blockers.
- No new database migration. Upgrade the matching server before clients to enable the new commands and streaming/sync endpoints.


## [2.0.0]

Major release of the unified knowledge and Assistant platform. Native packages
are built from the 2.0.0 source and use the existing update-signing identities.

### Added

- New Workspace Shell, light/dark design tokens, collapsible Sidebar and Command Palette.
- Project Knowledge Spaces with Owned, Linked, Inherited and Primary bindings.
- Wiki system with links, persistent aliases, backlinks, unresolved-link resolution,
  autocomplete, Slash commands and rebuildable indexes.
- Knowledge Graph at local, space and workspace scopes, separate from task dependencies.
- Atlas Assistant runtime with shared knowledge scope, retrieval and approved AI context.
- Shared AI capability implementations for Assistant and MCP with risk-based authorization.
- Provider adapters, real SSE streaming and persistent AgentSession conversations.
- Explicit administrator trust for bounded local/private AI endpoints.
- Persistent document hierarchy and SQLite/PostgreSQL knowledge application adapters.

### Changed

- Project navigation is Overview / Tasks / Knowledge; older separate document,
  graph, timeline and activity tabs are consolidated into the current workspace.
- Document Workspace uses current editing, diff/merge and recovery flows.
- Dependency Graph contains scoped Task → Task dependencies by default; Knowledge
  Graph represents document relationships. The old GraphCanvas/worker is removed.
- AI requests use server-loaded, permission-filtered and version-bound context;
  approved results remain proposals until explicitly applied.
- Storage adds aliases, hierarchy, knowledge bindings, Wiki index and sessions
  without rewriting Markdown bodies or immutable historical revisions.

### Migration

- Existing Project SPACE material is projected/backfilled into knowledge bindings.
- Wiki index is derived and rebuildable; unresolved links can resolve as targets appear.
- SQLite migrations 0021–0024 and PostgreSQL migrations 0012–0017 cover Wiki links,
  knowledge binding, version constraints, metadata, runtime repositories and sessions.
- See [Migration to 2.0](docs/MIGRATION_2.0.md) for fresh install, upgrade and restore.

### Compatibility

- Existing projects, documents, Markdown content and revisions are preserved.
- Workspace isolation, actor authorization and optimistic versions remain enforced.
- Old project URLs are mapped by the existing route compatibility code; custom
  navigation integrations should use Overview / Tasks / Knowledge.
- Account/HTTP deployment remains SQLite. PostgreSQL parity covers the knowledge
  application adapters rather than a replacement PostgreSQL account server.
- Older binaries must not write to upgraded schemas; rollback restores a verified backup.

### Known limitations

- Cargo check and release-profile native tests passed (15 passed, 1 strict-host
  fixture ignored). Android JVM tests passed 3/3. Windows installed-app upgrade
  and Android physical-device acceptance have not been performed.
- Windows updater signature verification is not Authenticode publisher signing.
- Paid real-provider compatibility and physical native-device validation are not
  represented by automated controlled-network/browser tests.
- Semantic embedding indexing is optional; baseline retrieval does not require it.
  Autonomous provider tools are not advertised. Existing large-chunk warning remains.
