# ADR 0049 — Project knowledge bindings and derived Wiki index

Project spaces reuse existing SPACE ProjectMaterial identities. A derived binding
table stores ownership, role and inheritance without moving or deleting content.
SQLite migration 22 backfills existing live SPACE materials; adapter writes keep
the table and material payload in the same request transaction. Soft-deleted
materials retain their payload and can rebuild the binding when restored.

Wiki links are a derived Markdown index, separate from KnowledgeLink. Library
adapter saves replace outgoing links in the same transaction as document revision,
Activity and Outbox. Unresolved targets remain null. Workspace keys constrain all
queries. The original schema-only PostgreSQL delivery was superseded by ADR0050:
real Library/ProjectMaterial/AgentSession adapters now share the knowledge
application contract. This does not introduce a replacement account/HTTP Host.

Audit amendment: PostgreSQL migration14 enforces the same positive Wiki version
constraint as SQLite without rewriting migration12. Both adapters reject missing
knowledge tables even when migration history remains intact. SQLite reads hydrate
the legacy material role/inheritance from the derived binding table.

Session 092 connects ProjectKnowledgeScope, RetrievalService, capability and
provider contracts to the actual Assistant/MCP/knowledge consumers. The current
runtime audit and retained compatibility endpoints are recorded in
../UNIFIED_UPGRADE.md.

Rollback follows the existing verified pre-upgrade backup into a new database
file; never downgrade or overwrite a live database in place.
