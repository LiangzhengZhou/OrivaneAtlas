# ADR 0062 — Local Application staging and commit boundary

Status: implementation in progress; not Local Runtime acceptance.

Persistence ports belong to Application. IndexedDB is an adapter; Application
must not import storage-local or duplicate WorkService rules. The candidate
contracts are exported by Application, with adapter re-exports for compatibility.

Existing asynchronous Application transactions cannot remain inside a live
IndexedDB transaction across arbitrary awaits. Stage the operation against
durable reads, then commit changed entities, outbox envelopes and internal
records in one short read-write transaction. Resolve only after completion.

A versioned internal workspace revision guard serializes concurrent staged
mutations, including list-based relationship checks and phantom inserts. CAS
failure rejects the entire operation; do not silently retry structural changes
or overwrite newer state. Store a revision number, never a serialized workspace.

Internal records include Markdown bodies, revisions and Activity. They use a
reserved `$local.` collection namespace and have CAS versions, but do not emit
independent remote mutations. Public entity changes always carry stable mutation
IDs and actor/device identity. No business record may bypass the outbox through
the internal-record path. Audit remains a separate boundary.

Derived Wiki repair uses a separate narrowly scoped adapter operation accepting
only `$local.wikiSources` records plus the workspace revision guard. It cannot
write entities, bodies, revisions or Activity, change document versions, or
emit fake business mutations. Repair is CAS-atomic and only runs for incompatible
or missing indexes; clean startup must not reparse Markdown. This extension is
under implementation and requires corruption/restart/concurrency tests.

Compound business operations may write the same entity more than once. Preserve
every consecutive expected-version transition and mutation envelope in order;
validate the first version against durable storage once, then apply the complete
chain in the same transaction. Reject forks, gaps and duplicate mutation IDs.
Do not collapse these into an unversioned last write or discard causal events.

Metadata manifests retain explicit unloaded-body state. Bodies and original
binary bytes are separate; no empty-body substitution or Base64 metadata.
Workspace binding remains explicit; local identity does not authorize a server.

Application adapters, crash/rollback/concurrency tests and offline product wiring
must verify this design before it is marked accepted. Android physical runtime
and native background notification integration remain separate acceptance gates.

## Application port evidence

LocalWorkUnitOfWork now adapts the existing WorkTransaction, with request-scoped
Notebook and Library ports sharing its staged commit. Metadata manifests, exact
Markdown bodies, immutable revisions, Activity, sequence changes and mutation
envelopes commit together. Read-only staged operations reject a workspace
revision change rather than returning a mixed snapshot. Structural Library
validation prefers metadata without hydrating unrelated bodies.

Wiki source syntax is parsed during document writes and persisted with its source
version. Clean reads resolve titles/aliases from metadata; they do not reparse all
Markdown. An incompatible or corrupt source index is rejected explicitly;
derived-index maintenance remains pending. Bootstrap now assembles LocalRuntime
with these ports; first-class Files and full Phase9 acceptance remain pending.

Existing Markdown image ports decode their legacy input at the boundary, store
hash-verified Blob chunks separately, and expose an image only after its final
metadata commit. Failed metadata writes can leave unreferenced immutable blobs,
which require later garbage collection; they cannot expose a partial image.
This is not the first-class File model or its binary sync implementation.

Actual IndexedDB tests cover Application services, refresh recovery, hierarchy,
body/revision preservation and cross-service rollback. The isolated Windows
WebView2 probe additionally forces process termination with live connections and
recovers real Work/Notebook/Library data. Android instrumentation compiles with
these assertions but has no attached device. Production browser E2E now blocks
all API requests and verifies Task creation and reload through the actual App.
Commit invalidation hints carry only workspace identity, follow transaction
completion, and never serve as data or as sync correctness. Purge relation
changes use the same staged transaction and mutation journal as the entity.
