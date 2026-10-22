# ADR0136 — Complete account replica bootstrap before delta replay

2026-10-22. P0 confirmed from a hash-verified read-only copy of the installed
Windows IndexedDB and the server's read-only pre/post-upgrade SQLite snapshots.

The account replica has the correct remote identity and cursor, but contains only
entities that appeared in the change log. Pre-log Projects are absent. Binding an
empty replica at the current epoch with cursor zero does not constitute a complete
snapshot. Incremental replay cannot discover untouched historical entities.

Production transport must read the existing authorized metadata bootstrap before
its first delta replay. A durable, binding-scoped completeness marker is published
in the same replica transaction as the validated snapshot, provenance, cursor and
workspace revision. Already partial replicas without this marker use the same
repair. Existing rows absent from the snapshot are retained; no omission becomes a
delete. Pending local commands and bodies remain protected by the existing pull
projection rules. Equal-version divergence and ID collisions fail closed; no LWW,
new workspace, automatic cross-workspace merge, ACK or receipt fabrication.

Snapshot descriptors have no change-log sequence numbers. A separate internal
projection path shares canonical entity validators and pending-command handling
with delta projection, while delta sequence validation stays unchanged.

Before repairing a nonempty production replica, persist and read back a verified
credential-free original archive in the independent existing backup store, pinned
to its original revision and binding. Backup failure prevents the repair. New
empty replicas need no recovery backup. No production data is modified by this
development session; original-device audits use isolated copies only.

The marker is generic local metadata; no new object store, schema migration or
public HTTP endpoint is needed. Original remote bytes and full Markdown remain
lazy through their existing authorized hydration contracts. Owner-private Memo
history retains its separate scoped bootstrap, after work/knowledge completeness.
