# Final stabilization domain audit

2026-09-24. Applies to the uncommitted upgrade on HEAD 40f1868, not the deployed server.

| Surface | Classification | Final semantics |
| --- | --- | --- |
| ownerProjectId / linkedProjectIds / taskOwnership | DELETED | No runtime model or API fields remain. |
| Task.projectId / structural task parent | DELETED | Task.projectIds contains equal memberships; task parentProjectId is null. |
| Category.projectIds | DELETED | Category metadata cannot assign projects. Versioned project mutations set categoryId. |
| Recurrence primary project | DELETED | New rules and generated tasks use projectIds; order has no owner meaning. |
| Old recurrence JSON projectId | COMPATIBILITY ONLY | SQLite/PostgreSQL readers convert old definitions and occurrence snapshots, then remove the field. |
| Old work_item.project_id and category membership tables | COMPATIBILITY ONLY | Historical migrations and upgrade fixtures; SQLite20/PG11 convert and drop the old category relation. |
| Project hierarchy | STILL ACTIVE | parentProjectId, bounded ancestors/descendants, cycle and depth checks. |
| projectLifecycle / projectLifecyclePatch | STILL ACTIVE | Typed accessor and enum validation for persisted lifecycle only; no status/activation projection. |
| Planning / standalone Board | DELETED | Legacy hashes redirect to Tasks; one selector/workspace and reusable Board view. |
| Project material OWNED / LINKED | STILL ACTIVE | Knowledge ownership, unrelated to Task membership. |
| ProjectPlan project context / MOVE target projectId | STILL ACTIVE | Explicit operation scope/destination, never a Task owner field. |
| Manifest category project references | STILL ACTIVE | Import assigns each Project.categoryId through versioned project mutations; no Category membership array is persisted. |

Task scope, progress, graph, archive visibility and path presentation consider all
memberships. Completing a shared task updates one identity. INBOX/MOVE completion
resolution removes only memberships inside the completed project scope. CANCEL
changes the shared task itself. Contract tests run against all three repositories.

Project lifecycle is PLANNED/ACTIVE/PAUSED/COMPLETED/CANCELED, independent of archive.
Task execution status remains TODO/IN_PROGRESS/DONE/CANCELED. Ancestor archive is
effective visibility, not a cascade rewrite; independently archived children remain
archived after restoring an ancestor. Category inherits from the nearest classified
ancestor. Milestones are separately displayed and editable, appear in Timeline,
and do not inflate Task progress or Overview counts.

Overview/Focus/Tasks use selectTasks. Navigation preferences remain versioned and
workspace/principal scoped. Desktop inspector preserves unsaved drafts; mobile
uses a modal detail. Native application identity is app.orivane.atlas.

No additional relational migration was required for this cleanup. SQLite20/PG11
remain the upgrade target. Old recurrence JSON is normalized at the adapter boundary
without rewriting immutable historical records. Existing migration backup/restore
and fresh-database tests remain required before release.

## Bundle review

P2: GraphCanvas/React Flow, CodeMirror/LiveMarkdown and AI administration are currently
statically imported. Introducing asynchronous editor loading requires preserving
draft, focus and autosave initialization behavior, so this stabilization does not
change that lifecycle. No Mermaid runtime import was found. The large-chunk warning
does not block functional validation; no unsupported claim of reduced bundle size.

Exact validation results and artifact paths are recorded in session 075.
