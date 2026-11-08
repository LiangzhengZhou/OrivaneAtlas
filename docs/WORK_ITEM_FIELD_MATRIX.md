# WorkItem field legality matrix

Status: 2026-11-04. Current `WorkItem` is one interface with runtime validation.
This matrix is the prerequisite for a later discriminated union; no type or
database change is made here.

| Field | PROJECT | TASK | MILESTONE | GOAL / DECISION / REMINDER |
| --- | --- | --- | --- | --- |
| id, workspaceId, title, descriptionMd | yes | yes | yes | yes |
| status | yes | yes | yes | yes |
| priority | yes | yes | yes | yes |
| executionMode | yes | yes | yes | yes |
| assigneePrincipalId | yes | yes | yes | yes |
| parentProjectId | yes (hierarchy) | no | no | no |
| lifecycle | yes | null | null | null |
| categoryId | yes | no | no | no |
| projectCoverAssetId / Focus | yes | no | no | no |
| archivedAt | yes | no | no | no |
| archiveBatchJson (application-owned) | yes | no | no | no |
| projectIds | no | yes | no | no |
| activationState / Policy | yes | yes | yes | yes |
| startDate / dueDate / dueTime | yes | yes | yes | yes |
| timerStartedAt / timerAccumulatedMs | no | yes | no | no |
| completedAt | yes | yes | yes | yes |

## Current validation ownership

- `WorkService` validates field groups for create/update.
- `validatePlanning`, membership and timer helpers enforce runtime rules.
- Storage hydrates nullable columns back into this one DTO shape.
- Local replay and HTTP DTOs validate at the external boundary.

## Proposed direction

1. Keep external DTO validation unchanged.
2. Introduce a compile-time discriminated union internally:
   `ProjectItem | TaskItem | MilestoneItem | ...`.
3. Migrate Application services and selectors first; leave persistence columns
   unchanged.
4. Only after callers migrate, consider storage-table separation.

Implemented in Session394:

- `WorkItem` is a discriminated union of `ProjectWorkItemShape`,
  `TaskWorkItemShape` and `OtherWorkItemShape`.
- Project-only fields (lifecycle, cover, archive) live on the project shape;
  task timer/project membership fields live on the task shape; other work types
  reject those fields at compile time.
- The external HTTP DTO and SQL storage remain one shape for compatibility; the
  Application construction boundary validates dynamic input before narrowing.
- Ad-hoc spreads in tests/performance fixtures are cast at those fixtures only.
- Type guards remain in `work-item-types.ts`.

The migration is complete at the Domain/Application/Storage/Host/UI compile
boundary; only external wire DTOs intentionally retain the legacy shape.
