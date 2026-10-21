# ADR0129 — Lazy Note organization and lifecycle preparation

2026-10-20. Incremental correction; full acceptance pending.

Folder movement does not consume Markdown. Organization preflight uses the
existing authorized Notebook manifest contract, preserving workspace identity,
entity version, organization version and deleted-state checks. It must not
hydrate all Notes or invent empty bodies. Older isolated adapters may fall back
to their existing full list when the manifest port is unavailable.

Note delete/restore/purge continue to use the existing full Note lifecycle
transaction and preserve exact Markdown, CAS, Activity and Outbox behavior.
Bootstrap prepares a metadata-only target with the already scope-checked body
reader before invoking that transaction. It captures account generation, checks
the original requested entity version, and never substitutes the current version.
An unavailable body or changed account/epoch fails closed; no empty-body fallback
or Last-Write-Wins is introduced. Offline operations remain available for bodies
already durable on the device. A never-hydrated body needs its existing remote
source before these full-record lifecycle commands can run.

For Note bulk delete, prepare only the explicitly selected Notes. Folder movement
remains metadata-only. Each Application transaction still performs its own
authorization and CAS checks. No schema, protocol or public HTTP change is needed.

Library Document/Space lifecycle uses the same prepared-body boundary. Their
existing parent/deleted-source permissions and original version remain checked
by the shared body reader and subsequent Library transaction.

Session289 extends the existing metadata boundary to reading a Document's parent
Space. The optional LibraryStore.getMetadata port reads only that exact identity;
LibraryService retains its Space type, workspace and deleted-state checks after
ordinary read authorization. Adapters without the port retain listMetadata
fallback. This avoids scanning all Document metadata on every body read, without
hydrating Space bodies or changing public HTTP contracts. Wiki availability reads
remain inside the same staged transaction with bounded concurrency; staged writes
override durable reads and the final workspace revision still validates the
result. No cross-transaction body or permission cache is introduced.
