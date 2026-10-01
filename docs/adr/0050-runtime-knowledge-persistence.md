# ADR 0050 — Runtime knowledge and assistant persistence

Continue the existing application services and workspace-bound transaction ports.
Scope resolution is shared by search, autocomplete, graph and retrieval. Retrieved
content is policy filtered before entering the persisted, version-bound approval
manifest. Provider invocation remains within the existing Gateway reservation,
authorization, timeout, usage and unknown-outcome semantics.

Document parent is a same-Space document reference. Reject self/cycles, reject
deleting a parent with live children, and reject restoring a child beneath a
deleted parent. Spaces remain top level. Rename retains the previous title as a
normalized persistent alias; alias collisions are rejected within a workspace.
Deletion disables resolution while retaining aliases for restoration. Metadata
and derived Wiki index writes share the document/revision/Activity/Outbox transaction.

Append new SQLite/PostgreSQL migrations; never rewrite applied migration SQL.
AgentSession represents the actor-owned conversation; AgentRun retains execution
approval, reservation and usage. Session mutations use actor authorization and
version checks. Backend parity is established with shared application scenarios,
not schema assertions alone. Restore pre-upgrade backups into a new database.

Endpoint trust reuses the existing versioned instance_setting envelope. Only an
administrator with a human session and CSRF can replace actor-derived workspace
entries. Exact normalized bases are checked again at DNS-pinned provider sends;
trust grants bounded private-network egress, not content-policy exceptions.
Receipt replay reads current committed configuration and cannot restore revoked
trust. Credentials remain in the existing vault.

Streaming uses real SSE adapters; compatibility/non-streaming adapters advertise
false. Transient authorized events drive the UI; final conversation messages are
durable. Unknown send outcome or any observed provider event forbids fallback.
Session history sent to models includes only successful, revalidated runs. Every
new run binds the session version; rejection and completion append session events.
