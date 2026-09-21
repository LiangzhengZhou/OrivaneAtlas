# ADR 0047 — Product completion contracts

Accepted 2026-09-21.

Task creation accepts prerequisiteIds and writes the new task, validated TASK-only edges, Activity and Outbox in the same transaction. Updates capture the canonical prerequisite set when the editor opens; background refresh must not change that concurrency token. Derived availability uses the authoritative calendar day and the editor's pending fields and edges.

New edge Activity retains nullable fromId, toId and edgeType after removal. Old events remain readable with null endpoints; absent history is not reconstructed. Additive migrations and backup/restore tests cover persisted events.

Workspace calendar preferences are versioned, workspace-scoped and transactional with Activity/Outbox. A null override inherits the validated host timezone. Existing dates and recurrence zones remain unchanged. Reads and execution gates resolve the same override; mutation uses work:update authorization and the existing HTTP idempotency boundary.

Parent selection uses the existing domain eligibility rule, with hierarchical browsing and search. Inspector actions call existing application contracts and retain version/dirty-draft protection. Theme and density remain non-secret local UI preferences. Mobile navigation and desktop lists project the same data and preserve reachable actions.

Dashed Canvas hierarchy/ownership edges are a read model of projectId, not stored WorkEdge records, and cannot be deleted as execution dependencies. Existing graph deletion and task transition rules remain authoritative. Atomic task mutations validate readiness against the resulting graph, so removing a blocker and starting the task can commit together, while adding an unfinished prerequisite to started work is rejected.
