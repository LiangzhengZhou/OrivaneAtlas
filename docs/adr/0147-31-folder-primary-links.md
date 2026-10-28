# ADR0147 — 3.1.0 folder primary location and reusable folder links

2026-10-29. Status: accepted, staged implementation.

## Context

ADR0138 stores note folder membership in `organization(kind=NOTE).folderId`. That made the folder a note-only axis, and forced folder reuse to be represented as unrelated folder trees. The 3.1.0 redesign needs a persisted primary location on the note itself, a reusable folder-to-resource relationship, and distinct space/project folder associations.

The change spans two storage adapters and incremental sync, so it is staged. No stage may write two competing authoritative locations.

## Decision

1. `Note.primaryFolderId` is the authoritative note location after cutover.
   - SQLite `notebook.primary_folder_id` and PostgreSQL `notebook.primary_folder_id` are added and backfilled from the existing `organization(NOTE).folderId` during migration.
   - Phase 1 keeps the Note payload field absent/optional and reads the column when present.
   - Phase 2 writes `primaryFolderId` through the notebook service and stops writing `organization(NOTE).folderId`. The old organization row remains only for legacy icon/presentation compatibility and is ignored for location.
   - No operation writes both locations after cutover. A rollback restores the previous adapter/code together with its backup, not a mixed read.

2. Folders gain `scope`:
   - `NOTE`: the primary note folder tree (one primary location per note).
   - `GENERAL`: reusable collections that may link to notes, documents, files, projects and spaces.
   - Existing FOLDER rows backfill to `NOTE`.
   - A folder's scope is immutable after creation in this release.

3. `FolderLink` is a first-class many-to-many membership row:
   - `workspace_id, id, version, folder_id, target_kind, target_id, created_by, created_at, deleted_at`
   - `target_kind` is one of `NOTE`, `DOCUMENT`, `FILE`, `PROJECT`, `SPACE`.
   - A target may belong to many `GENERAL` folders. A `NOTE`-scope folder cannot be used as a reusable link target.
   - At most one active row per `(workspace_id, folder_id, target_kind, target_id)`.
   - Removing a link is a soft delete; resource deletion cascades link cleanup in the same transaction.

4. Space and project folder associations are separate rows:
   - `space_folder_link(workspace_id, space_id, folder_id, ...)`.
   - `project_folder_link(workspace_id, project_id, folder_id, ...)`.
   - They do not go through `FolderLink`; this avoids a polymorphic scope table and lets each parent enforce its own permission and deletion rules.

5. Folder trash keeps the existing folder identity:
   - Deleting a folder subtree sets `archived=true` and one `trashBatchId`; descendants are included in the same transaction.
   - `Note.primaryFolderId` is retained until the folder is permanently removed, so restoring the folder restores the note location.
   - Permanent folder deletion removes only the folder/link rows after explicit purge; notes and their bodies are never cascaded.

6. Sync and contracts:
   - New collections: `folderLinks`, `spaceFolderLinks`, `projectFolderLinks`.
   - Every mutation uses the existing workspace transaction, version CAS, Activity/Outbox, idempotency and guarded replay.
   - Read-write credentials require `knowledge:write` for link mutations; delete uses `knowledge:delete`/the existing granular grant mapping. Server-side authorization remains authoritative.
   - OpenAPI and native read-only allowlists are updated with every public route.

7. Not in this ADR: covers/assets, drag reordering, folder-level permissions, cross-workspace moves.

## Rollout

- Migration adds nullable/backfilled columns and empty tables; old code continues to work.
- Application read/write cutover, storage repositories, sync replay, API and UI follow in separate checked increments.
- Current increment (2026-10-29): note primary storage/API/backfill, FolderLink service + SQLite adapter, explicit GENERAL folder creation. Organization NOTE.folderId remains the UI write authority until note outbox/sync cutover and FolderLink replay are complete.
- The old `organization(NOTE).folderId` is not deleted by automatic migration; permanent removal is a later, separately tested cleanup.

## Validation

- SQLite/PostgreSQL migration parity and old-row preservation.
- Backfill from organization NOTE rows, including unfiled and archived folders.
- Note move through the notebook service increments note version and outbox exactly once.
- Link uniqueness, soft-delete/relink, scope rejection, deletion cascade and authorization tests.
- Workspace import/merge/replay tests for the new collections.
