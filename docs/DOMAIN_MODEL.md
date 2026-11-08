# Orivane Atlas Domain Model

Status: working document, 2026-11-04. This document records the current code's
domain boundaries and the rules that are already enforced. It does not invent
new product behavior.

## Domain boundaries

| Area | Responsibility | Current objects |
| --- | --- | --- |
| Workspace / Identity | workspace isolation, principals, authorization | `Workspace`, `Principal`, `ActorContext`, `WorkspaceOwner` |
| Work | projects, tasks, milestones, dependencies | `WorkItem`, `WorkEdge`, `WorkflowRecord` |
| Knowledge | authored content and its navigation | `Note`, `LibraryEntry` (SPACE/DOCUMENT), `LibraryFile`, `Organization` folder |
| Project–Knowledge | explicit project/resource context | `ProjectMaterial`, `ProjectKnowledgeBinding` (read projection) |
| Sync | local mutations, receipts, remote changes | `Outbox`, `request_receipt`, `workspace_change`, local replica |
| AI | model configuration, runs, retrieval | provider vault, `AgentSession`, `AgentRun`, retrieval services |
| Host | HTTP boundary and service assembly | `packages/host/src/server.ts`, routes, request context |

Dependency direction remains `UI -> Application -> Domain/Ports -> Adapters`.
Domain code does not import UI, HTTP, storage or AI SDKs.

## Entities

### WorkItem

- Identity: `id` within `workspaceId`.
- Types: PROJECT, TASK, MILESTONE, GOAL, DECISION, REMINDER (see
  `packages/domain/src/index.ts`).
- Lifecycle: `deletedAt` soft delete; project `lifecycle`; task `status`.
- Common fields: title, descriptionMd, status, priority, executionMode,
  assigneePrincipalId, parentProjectId, categoryId, dates, version, audit fields.
- Type-specific fields currently remain on one interface:
  - projectCoverAssetId / projectCoverFocus / archivedAt / archiveBatchJson: PROJECT
  - projectIds: task membership
  - timerStartedAt / timerAccumulatedMs: TASK timer
- Runtime validation still lives in Application services; this is the current
  authoritative boundary for external HTTP/sync input.

### Note

- Identity: `id` within workspace.
- Parent/navigation: `Note.primaryFolderId` is the authoritative folder
  membership after migration 0046. Legacy `Organization.folderId` is read only
  as a fallback when the note has no primary field and the local body is
  unavailable; moves update/clear the legacy row so it cannot override a move
  to Unfiled.
- `Organization.folder` free text remains a read-only Legacy Group until a
  later cleanup.
- Body: `bodyMd`; versions and revisions follow notebook storage.

### Space / Document / File

- `Space` and `DOCUMENT` are `LibraryEntry` kinds; `FILE` is a first-class
  `LibraryFile` with library metadata.
- `Document.spaceId` is a canonical ownership boundary in the current storage
  and API. It is not merely a UI view; changing it is restricted by the library
  service.
- Folder membership does not change `Document.spaceId`.
- Project context is expressed through `ProjectMaterial`, not by rewriting
  document ownership.

### Folder

- `Organization(kind=FOLDER)` with `scope`:
  - `NOTE`: note primary tree.
  - `GENERAL`: reusable folder collections.
- Hierarchy: `parentId` on the folder. UI trees are projections.
- Deletion: soft delete, folder subtree and trash batch semantics; notes retain
  their bodies and primary folder identity.

### ProjectMaterial

- Identity: its own row id; belongs to one project.
- Kinds: SPACE, DOCUMENT, FILE.
- Ownership: OWNED or LINKED.
- Role for SPACE materials: PRIMARY, SUPPORTING, REFERENCE.
- Compatibility projection: `ProjectKnowledgeBinding` is derived from
  `ProjectMaterial`; it is a read model, not a second writable fact.
- The project-space resolver now selects only a single live PRIMARY binding;
  multiple live PRIMARY bindings are an invariant error.

### Folder relationships

The three relationship rows remain separate by ADR0147:

- `FolderLink`: general reusable membership. As amended on 2026-11-04,
  new writes allow only NOTE, DOCUMENT and FILE. Legacy PROJECT/SPACE rows are
  preserved read-only but rejected by Application, Host, Replay and DB guards.
- `SpaceFolderLink`: dedicated Space-to-Folder association.
- `ProjectFolderLink`: dedicated Project-to-Folder association.

The guide's proposal to narrow `FolderLink` to resources only conflicts with
the accepted ADR text. No narrowing was applied; this needs an ADR amendment
before code or database constraints change.

### KnowledgeLink / Wiki link

- Explicit `KnowledgeLink` records are authored relationships.
- Markdown wiki references are derived indexes, not a second handwritten
  relationship source; they are rebuilt from content.

## Project knowledge scope

`packages/application/src/project-knowledge-scope.ts` is the shared resolver.
It:

- walks parent projects before resolving scope;
- includes direct and inherited SPACE bindings (inheritance only when
  `inheritToChildren` is true);
- ranks OWNED PRIMARY above other OWNED, then LINKED;
- supports the current space and optional workspace fallback;
- filters deleted library entries and absent spaces.

UI consumers should use this resolver's projection (`projectKnowledgeScope` /
`scopedKnowledgeDocuments`) rather than rebuilding scope rules.

## Explicit open decisions

1. Legacy PROJECT/SPACE rows may be purged only after old clients and pending
   replay commands are gone; this is a later cleanup, not a current write path.
2. Whether a project-owned knowledge space should be a real folder entity in
   the file library rather than a hidden project space (current implementation
   uses a project space).
3. Project archive is now an independent `archivedAt` field/command; lifecycle
   and completion remain separate. Session393 uses one Application transaction
   for owned-resource Trash and a versioned recovery batch (ADR0148).
