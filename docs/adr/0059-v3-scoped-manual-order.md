# ADR 0059 — Scoped manual ordering

Status: Accepted and implemented in local v3 worktree. Memory, SQLite and
PostgreSQL contracts, Host/Web runtime wiring and scoped ordering browser
regressions are verified; whole-product v3 acceptance remains pending.

Tasks can belong to several projects. A global task rank would couple unrelated
views. Workspace tasks, project task views and sibling projects therefore have
distinct order scopes. Root project scope is distinct from a project named ROOT.
Sidebar ordering continues to use NavigationPreference. Project categories keep
their existing position column rather than acquiring a second ordering store.

Project task order membership uses the existing projectScope SUBTREE rule,
matching the default Project Tasks view. DIRECT and filtered presentations are
subsets of that ordered scope. A child project's own scope remains independent
from its parent's order. Task membership still comes exclusively from projectIds;
no dependency-graph DIRECT_PROJECT boundary or task ownership rule is changed.

Application services authorize and validate membership inside the transaction,
compute sparse safe-integer positions, and write order changes with versions and
durable change records. Clients supply placement intent and expected versions,
never authoritative positions. Scope initialization and gap exhaustion may
rebalance only that scope. A scope revision protects concurrent anchor moves and
membership changes; individual entries retain their versions for synchronization.

Pure Domain helpers contain no persistence or UI dependencies. SQLite and
PostgreSQL require equivalent append-only migrations before runtime adoption.
Persist each task/project scope as a versioned JSON aggregate in manual_order_scope;
its entries retain entity versions and sparse positions. This provides a single
CAS boundary and one durable workspace change for each reorder, including a
rebalance, rather than exposing intermediate positions to synchronization. The
scope payload is metadata only and contains no task/document bodies. Category
ordering continues to use its existing relational representation.
Tests must cover multi-project isolation, stale versions, invalid membership,
root scope, sparse insertion, gap exhaustion and transaction rollback.

Direct Sidebar movement reuses the complete NavigationPreference aggregate and
its existing CAS/Activity/Outbox transaction. Domain validation permits only
visible siblings in the same fixed navigation group and pinned segment, keeping
other groups, hidden slots and mobile shortcuts unchanged. A no-op has no new
revision or durable change. The Host endpoint is owner-session only.

Project insertion edges operate on PROJECT_CHILDREN; a row body resolves a
reparent operation and a category header resolves a category operation. Both
structural operations use WorkService.update and its existing cycle, depth,
workspace and version checks. UI eligibility reuses eligibleProjectParents;
dragging never changes WorkItem.type or task.projectIds. Touch target registration
belongs to the containing gesture scope, rather than a possibly virtualized row.
