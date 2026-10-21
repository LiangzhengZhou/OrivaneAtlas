# ADR 0120 — Revalidate invalidated read-only File snapshots

2026-10-16. Implemented; targeted verification, not full acceptance.

## Evidence

A two-connection real IndexedDB test reads a local original Blob while the other
connection commits a Task. The read-only transaction correctly rejects its stale
workspace revision, but the image otherwise remains in a failed state. Concurrent
File deletion produces the same snapshot rejection. Original failing evidence:
`.artifacts/codex-file-read-contention-reproduction.log` (2 failures).

## Decision

Keep the read-only transaction's revision validation. Its invalidation throws a
distinct `LocalReadSnapshotChangedError`, retaining `VERSION_CONFLICT` externally.
Only `LocalRuntime.readFile` and `readFileBytes` restart this read-only operation,
at most three total attempts. Each attempt creates a fresh transaction and reruns
Application authorization, workspace/target visibility and original-byte hash
validation. Results from failed snapshots never escape.

Writes, entity CAS, sync validation and generic Domain version conflicts are not
retried by this mechanism. An error at the third attempt still propagates. No
Outbox, business entity or Activity is created by rereading.

## Verification

Real IndexedDB tests cover unrelated changes (original exact bytes returned),
concurrent deletion (NOT_FOUND; no bytes), and continuous contention (bounded
VERSION_CONFLICT; exactly three unrelated writes). File versions and Outbox
counts are asserted. Existing restore-CAS, hydration provenance and image error
regressions: 4 files, 25/25 PASS in
`.artifacts/codex-file-read-contention-bounded.log`. Browser/build regression is
still required before claiming closure.
