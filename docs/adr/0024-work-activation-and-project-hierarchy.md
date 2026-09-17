# ADR0024 — Work activation and project hierarchy

Accepted 2026-09-17. Extends ADR0002/0003; preserves existing data and Markdown.

## Activation

MANUAL respects ACTIVE/INACTIVE (SCHEDULED is invalid without a scheduled policy). IMMEDIATE normalizes to ACTIVE. WHEN_DEPENDENCIES_COMPLETED is ACTIVE exactly when all prerequisite tasks are DONE, including the empty set. Canceled/missing prerequisites do not satisfy it. Recompute dependent activation on status changes and dependency add/remove, in the same transaction with individual version increments, Activity and Outbox. Do not activate completed/canceled items implicitly. Reopening prerequisites deactivates unfinished automatic dependents; existing prohibition on invalidating started dependents remains.

AT_SCHEDULED_TIME requires startDate and stores SCHEDULED. Eligibility is derived from the injected clock's UTC calendar date, inclusive of startDate. No hidden writes in GET/snapshot and no claim of a background scheduler or persisted activation event at midnight. UI labels this UTC rule explicitly. Execution checks use the same rule; blockers apply independently. Manual inactive work cannot start/complete until activated; terminal history can still be edited. Enum/null validation at Application boundary protects every adapter.

Planning retains inactive and future-scheduled work. Ready/Focus excludes ineligible work; dates and policy are visible/editable. Old default ACTIVE/MANUAL behavior remains unchanged.

## Project hierarchy

Reuse existing nullable projectId as a PROJECT's parent; for other work it remains the primary project. No schema rewrite or destructive backfill. Parent must be a live PROJECT in the same workspace; self/ancestor cycles rejected under the existing workspace transaction lock. Delete is blocked while live children exist; restore validates hierarchy. UI labels parent separately and displays parent context. This is not yet independent category, multi-project membership, inherited archive, or recursive progress aggregation. These need their own additive model/migrations.

No Agent execution permission expansion. Existing work mutation permissions, CSRF/idempotency and version checks remain mandatory. Public schemas are extended; no secret or credential storage changes.
