# Data ownership

Status: 2026-11-04. Each business fact has one authoritative write source.
Anything else is a projection or a migration-compatible copy.

| Fact | Authoritative source | Read surfaces | Delete / lifecycle | Migration / sync |
| --- | --- | --- | --- | --- |
| Note folder membership | `Note.primaryFolderId` (`notebook.primary_folder_id`) | notebook service, folder selectors, folder counts, note filters | notebook move/delete/restore; folder trash retains it | migration 0046 backfills from `organization(NOTE).folderId`; note outbox/replay |
| Legacy note folder text | `Organization(NOTE).folder` | read-only Legacy Group | organization row compatibility only | no new writes; retained until explicit cleanup |
| Legacy note `folderId` | `organization(NOTE).folderId` | only a fallback when no `primaryFolderId` and local body is unavailable | organization row compatibility/fallback | backfilled; moves update/clear it; it never overrides a primary field |
| Folder hierarchy | `Organization(kind=FOLDER).parentId` | folder tree projection, move targets | soft delete + trash batch | organization outbox/replay |
| Folder link membership | `FolderLink` rows | folder-linked resource lists | soft delete, resource deletion cascade | `folderLinks` workspace change + replay |
| Space folder association | `SpaceFolderLink` rows | space folder lists | soft delete | `spaceFolderLinks` |
| Project folder association | `ProjectFolderLink` rows | project linked folders | soft delete | `projectFolderLinks` |
| Project ↔ resource relation | `ProjectMaterial` rows | project knowledge, project documents, file grouping | project material soft delete; owned document delete goes through library service | project material/local replay and workspace changes |
| Project ↔ space binding role | `ProjectMaterial` for kind=SPACE | `ProjectKnowledgeBinding` projection, scope resolver | soft delete material; owned space cannot be deleted through material service | project material replay; no separate binding table |
| Project document Space | `LibraryEntry.spaceId` | document workspace, file library | library delete/restore | library outbox/replay |
| Document content | `LibraryEntry.bodyMd` / revisions | document editor, reading views | soft delete then explicit purge | library replay; bodies are not silently rewritten |
| Note content | `Note.bodyMd` / revisions | notebook editor, note views | soft delete then explicit purge | notebook replay |
| File bytes and metadata | `LibraryFile` + blob stores | file picker/details | soft delete, explicit purge | file replay |
| Explicit knowledge relationships | `KnowledgeLink` rows | knowledge graph and backlinks | soft delete | knowledge link replay |
| Wiki references | derived index from Markdown | wiki backlinks/search | rebuilt from content | derived; never a second authored relation |
| Project archive batch | `WorkItem.archiveBatchJson` | recovery and guarded Work replay | records owned resource tombstone versions; restore excludes intervening changes | SQLite 51 / PG 46; work.update atomic multi-collection effects |
| Project archive | `WorkItem.archivedAt` (`work_item.archived_at`) | project lists/menus (archived projects hidden by default) | independent `archived` update; unarchive clears it | `work.update` command and workspace change |
| Work edges | `WorkEdge` rows | project graph, dependency views | delete edge/soft semantics | work replay |
| Local pending writes | IndexedDB outbox | sync coordinator | ACK/receipt/conflict state | outbox transitions + command replay |
| Server accepted mutations | server tables + `request_receipt` + `workspace_change` | cursors, delta pull, conflict review | server transaction/receipt lifecycle | canonical server authority |

## Rules

1. `ProjectKnowledgeBinding` is a projection of `ProjectMaterial`; do not add an
   independent writable binding table.
2. Project knowledge scope is computed by the shared resolver; UI must not
   reconstruct a different set of spaces.
3. Project document creation must use the project-space resolver, not a title
   match. The resolver selects only a single live PRIMARY; multiple PRIMARY
   bindings are a validation error.
4. A Document's `spaceId` is its canonical ownership boundary in the current
   product. Folder membership must not rewrite it.
5. Legacy fields remain readable only through explicit compatibility paths.
   They must not override migrated primary fields; the body-unavailable note
   compatibility path falls back only when primary is absent.
6. External HTTP/replay input is validated at the Application boundary even if
   TypeScript types are later tightened.

## Known compatibility debts

- Session393 implements atomic project archive/recovery batches; see ADR0148. Only live OWNED resources join the batch.

- `organization(NOTE).folderId` still exists and may be written by old clients;
  current web selectors ignore it for folder identity.
- The generic `FolderLink` and the dedicated Project/Space folder links coexist
  because ADR0147 assigns different semantics. Do not merge them without a new
  ADR.
- Archive is independent from lifecycle/completion. Legacy organization writes are a compatibility surface; new UI uses the versioned work.update archive contract.
