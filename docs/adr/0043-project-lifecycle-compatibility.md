# ADR 0043 — Project lifecycle commands and completion boundary

Accepted 2026-09-20. Extends ADR0040/0042. No schema rewrite.

## Domain and storage compatibility
Project lifecycle is PLANNED, ACTIVE, PAUSED, COMPLETED or CANCELED. Domain projects expose projectLifecycle and lifecyclePatch; task workflow remains WorkStatus. The existing storage columns encode lifecycle: TODO -> PLANNED; IN_PROGRESS + INACTIVE -> PAUSED; other IN_PROGRESS -> ACTIVE; DONE -> COMPLETED; CANCELED -> CANCELED. Explicit project lifecycle changes write MANUAL and ACTIVE (INACTIVE for PAUSED). This is an adapter compatibility encoding, not project task availability. Unrelated project edits preserve historical activation fields. A future dedicated column can migrate this losslessly.

Project normalization and dependency reconciliation must not apply task execution policies to projects. Legacy project status updates still work, but pass all completion and parent invariants. New projectLifecycle input is project-only and cannot mix with status/activation fields. Legacy raw activation changes on projects are rejected; values already stored remain readable and preserved.

## Commands and invariants
Lifecycle changes are explicit versioned updates, never inferred from task completion. COMPLETED requires all live structurally owned tasks and descendant projects to be terminal. CANCELED counts as terminal but remains separately reported. References do not contribute. Validation uses the entire owner subtree so a legacy inconsistent completed child cannot hide unfinished tasks. Project cancellation does not cascade task status or availability.

Creating, moving, restoring or reopening unfinished owned work under a completed ancestor is rejected with PROJECT_REOPEN_REQUIRED. Metadata edits of existing legacy inconsistent work remain allowed, enabling repair without silent lifecycle changes. Completing a project with unfinished work returns PROJECT_HAS_UNFINISHED_WORK, with task/project counts. Paused projects do not pause tasks.

CreateWork accepts optional reopenProjectVersion: explicit consent to reopen its immediate completed parent and create new work in ONE transaction. Both work:create and work:update permissions required. Stale parent version, validation, event failure or completed ancestor rejection rolls back both operations. No automatic cascade reopen. UI offers an explicit checkbox and action label; ordinary create remains blocked. Host idempotency remains mandatory. Existing mutation permissions are not expanded for Agent tools; their declared schemas remain unchanged.

## Validation
Repository contracts run against memory, SQLite and PostgreSQL. Include legacy compatibility, pause, terminal counts, references, child projects, restore/move/reopen, atomic rollback and stale versions; backup round-trip verifies compatibility encoding. Browser regression covers lifecycle commands, completion refusal and explicit reopen/create in both languages and mobile.
