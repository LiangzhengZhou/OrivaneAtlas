# ADR 0048 — Atlas upgrade target

Accepted 2026-09-23. The user's current upgrade request supersedes the
owner/reference target in ADR 0042 and compatibility lifecycle target in ADR 0043.

Tasks will have equal project memberships. Projects will use parentProjectId,
an explicit lifecycle, and a primary category with ancestor inheritance. Archive
remains independent. Persisted migrations must preserve Markdown and shared task
identity. Completion requires an explicit unfinished-work resolution.

Final stabilization removes category-side projectIds from runtime metadata and
category mutations. Classification changes use the versioned Project.categoryId
mutation, including import assignments. Historic category membership tables exist
only in pre-upgrade schemas and are dropped by the domain migration. Category
edits never overwrite project assignments.

Recurrence rules use equal projectIds only. Old persisted recurrence JSON is
normalized by storage adapters, including occurrence rule snapshots; it is not a
second business model. Legacy Planning/Board hashes redirect into Tasks views.

Task projections share one selector boundary: only live TASK records contribute;
Now means execution-active and unfinished; readiness uses the authoritative
calendar day and dependency graph. Overview, Focus and the task workspace use
these projections. Board and planning are views of that workspace.

This records the target, not a claim that the full model migration has shipped.
Implementation and validation evidence belongs in the session handoff.

Navigation preferences are versioned records keyed by workspace and principal,
not workspace-wide settings or unscoped browser storage. SQLite 19 and PostgreSQL
10 add user_navigation; mutations append Activity/Outbox in the same transaction.
Only human sessions can save preferences over REST. MCP gains no mutation tool.
Desktop order, visibility and pinned entries and 2–4 ordered mobile shortcuts are
validated in Domain. Settings and More remain reachable independently of hidden
desktop entries. Account transitions discard the prior snapshot.

On the first authenticated browser sync, a calendar preference at version zero
is initialized from the device IANA zone using the existing versioned mutation.
A concurrent initializer loses with VERSION_CONFLICT and reloads the winner.
Existing explicit settings, including an explicit null inheritance choice, are
never overwritten.

Migration rollback uses the migration runner's pre-upgrade backup restored into
a new database file with the matching old application. Do not open a schema-20
database with an older host or overwrite a live database for rollback. SQLite
backup/restore includes navigation records; PostgreSQL retains its existing
mandatory beforeUpgrade backup callback.
