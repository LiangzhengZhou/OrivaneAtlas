# ADR0134 — Scoped legacy image read-through

2026-10-22. Implementation under regression; not final acceptance.

The legacy Library Asset endpoint retains valid chunked image bytes, while the
local-first bootstrap does not replicate legacy asset records. A synced Markdown
reference therefore cannot rely exclusively on LocalImageAssets. The client may
fetch the original authorized endpoint, pinned to the durable binding's server,
principal, workspace and epoch. No URL rewriting, replacement File entity, merge,
business mutation, or permission bypass is permitted.

Verified raster bytes may be stored content-addressed in the existing Blob store.
A derived `$local.legacyImage` pointer is keyed by the full remote binding and
asset ID. It contains the content hash, MIME and length only. Pointer publication
uses the existing replica transaction with workspace revision and binding CAS,
unchanged cursor, and no ACK or Outbox mutation. This adds no IndexedDB object
store or schema migration. Existing backup includes generic metadata and Blob
bytes; restore and isolation must be tested before final acceptance.

Every cached read validates the current binding before and after IO. Failed
permissions, missing assets, bad MIME/signature and changed bindings are never
cached. Offline reading can reuse only previously verified bytes for the same
binding. Server-side permission revocation cannot be discovered offline; this is
the same boundary as existing hydrated Files and document bodies. Online reads
must still use the authorized endpoint, so an online denial is not bypassed with
cached bytes. No request failure other than explicit device offline selects cache.

The in-memory Blob URL loader identity changes with account/server generation.
Retired requests fail closed, and decode retries invalidate only that scoped URL
without revoking mounted readers in other views.
