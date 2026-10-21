# ADR 0061 — Local storage candidate and atomic write contract

Status: implemented in the local product runtime; complete native acceptance pending.

FINAL v3 requires a durable local source independent of network connectivity.
The current Node SQLite adapter cannot execute in a WebView. Evaluate IndexedDB
metadata and a separate Blob database before selecting a native SQLite fallback.
Domain/Application rules remain TypeScript; persistence must not duplicate them.

The candidate contracts separate metadata, binary content, pending mutations and
sync state. An explicit batch commits version-checked entity writes and their
outbox envelopes in one transaction. Request success does not mean durable save;
the adapter resolves only on transaction completion. Do not expose arbitrary
async transaction callbacks: unrelated awaits can auto-close IndexedDB transactions.

All keys include workspace identity. Local mutation envelopes carry principal and
device identity, but these are not server authorization. Server binding and replay
must authenticate independently through Application contracts. Blob bytes are
hash-verified, never Base64 in metadata. Restart converts interrupted SENDING
envelopes to PENDING without discarding their mutation IDs.

This package is a candidate, not a wired Local Runtime. Acceptance requires real
browser and native WebView transaction/rollback/restart/migration benchmarks with
1500 tasks, 500 documents, 1000 file metadata and 50 pending mutations. Phase9
must adapt the existing Application ports before any Local-first claim.

## Recorded candidate evidence (2026-10-12)

The browser suite exercises actual IndexedDB with 1500 tasks, 500 document
metadata records, 1000 file metadata records and 50 pending mutations. Entity
CAS failures and duplicate mutation IDs roll back the complete transaction.
Separate binary storage preserves original bytes and rejects both invalid uploads
and corrupted stored content on read. Binary database names use a `.blobs`
namespace even when callers use the same workspace database stem.

An isolated release-mode Windows WebView2 harness uses the identical compiled
TypeScript adapter. Forced termination while database connections remain open,
followed by a new process using the same isolated profile, preserves all fixture
records and pending mutations. The raw exit cleanup warning remains in evidence.
Android instrumentation using the same bundle compiles, but no Android device
is attached; compilation and mobile Chromium emulation do not establish native
Android durability. The backend decision therefore remains proposed.

These measurements do not establish product offline usability, first-class Files,
sync replay, local Notification scheduling or completed v3 acceptance. See
`docs/benchmarks/v3-local-storage-candidate.json` for the scoped measurements.
