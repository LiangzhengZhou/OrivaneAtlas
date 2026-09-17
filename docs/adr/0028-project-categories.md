# ADR0028 — Independent project categories

Accepted 2026-09-17. Categories are workspace-scoped versioned, soft-deleted entities, never synthetic WorkItems. A category has a name and a set of project memberships. Projects can have multiple categories; this is organizational metadata, not hierarchy, execution permission or inherited archive. Deleting a category preserves memberships for restoration; deleting a project does not delete category history. Reads may retain deleted project IDs; active UI resolves only live projects. Explicit membership edits accept only live same-workspace PROJECT entities.

Category CAS controls name, deletion and the complete membership set. Existing work permissions govern category reads/creation/updates/deletion. All changes run under the existing workspace UnitOfWork lock. Dedicated category Activity and Outbox tables commit with the category and junction replacement; they do not mislabel changes as Work events or imply a delivery worker. No secrets are stored.

Append-only SQLite14 and PostgreSQL6 migrations add categories, junctions and their event tables. Existing Work data is untouched. Verify isolation, CAS, soft delete/restore, invalid memberships and rollback across adapters, plus upgrade/backup restoration. HTTP mutations retain authentication, CSRF and idempotency. UI provides bilingual management and filtering.
