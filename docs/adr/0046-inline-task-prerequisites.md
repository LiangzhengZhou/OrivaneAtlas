# ADR 0046: Inline task prerequisites

- Status: Accepted
- Date: 2026-09-21

## Decision

Task detail may submit a complete canonical prerequisite task-id set together with the task mutation. The application applies edge additions/removals in the same workspace transaction and requires `graph:write` only when that set changes. Only TASK to TASK execution dependencies are accepted; the stored canonical direction is prerequisite -> dependent, while legacy REQUIRES remains readable through the existing projection.

The editor sends the prerequisite set it read plus `expectedPrerequisiteIds`. A changed set returns VERSION_CONFLICT instead of silently overwriting another editor. Project endpoints, self edges, deleted tasks, duplicates and cycles are rejected.

## Consequences

Edge activity and task mutation share the transaction. Edge rows still have no independent version; the expected set is the concurrency token for this command. Existing graph commands remain compatible.
