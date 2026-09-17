# ADR0026 — Task project memberships

Accepted 2026-09-17. Extends ADR0024/0025.

TASK can belong to multiple live projects in the same workspace. An ordered junction table (workspace_id, task_id, project_id, position) is authoritative for new writes; legacy projectId remains the first membership for compatible clients. PROJECT projectId remains its single parent. Other work types retain single-project behavior. New projectIds replaces the entire set using the task version CAS; legacy projectId edits replace the set with zero/one member, so no invisible memberships survive an explicit legacy move. Unrelated updates preserve all memberships. Duplicate IDs, non-project/deleted/cross-workspace destinations and conflicting primary fields are rejected.

SQLite13/PG5 add a composite-FK junction with unique position and backfill all TASK project_id values, including soft-deleted tasks. No task content/version/history rewrite on migration. Normal adapter writes update WorkItem plus memberships under the existing workspace transaction lock; membership-only edits increment task version and emit normal Work Activity/Outbox. Association removal is set replacement, not deletion of the task. Project deletion is blocked by any live membership.

Recursive project summaries include shared tasks once within each project subtree. Explicit task archive wins; inherited task archive applies only if every membership is archived itself or via an ancestor. Any active membership keeps the task visible. Unassigned tasks have no inherited archive. Domain queries support old snapshots without projectIds.

Restoring a task filters memberships against currently live projects and promotes the first surviving membership to projectId; restoring a project later does not silently recreate removed memberships. Markdown and task identity are preserved.

Upgrade uses existing backup gates and atomic DDL/history, never edits applied SQL. Verify old-row backfill, rollback, backup restore and three-adapter contracts. PG backup hook tests do not constitute pg_dump/restore acceptance. No Agent permissions expanded; public mutation still requires host idempotency, authentication and CAS.
