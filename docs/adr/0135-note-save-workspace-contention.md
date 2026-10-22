# ADR0135 — Restart aborted Note staging on unrelated workspace contention

2026-10-22. Reproduction confirmed with two independent IndexedDB connections.

Saving an existing Note currently aborts when an unrelated Project write advances
the local workspace revision between staging and atomic commit. This reproduces
the VERSION_CONFLICT visible in the published CI Note traces; it does not prove
that every CI failure shares this cause.

Apply the existing restartAbortedWorkspaceWrite boundary (ADR0119) to saveNote,
as already used by saveLibrary. Only a storage conflict on the exact workspace
revision restarts the complete aborted transaction, at most twice. Keep the
original actor, input Markdown, entity ID and expected entity version. Repeat all
authorization and CAS checks and commit Activity/Outbox atomically. Same-Note
changes still fail; persistent unrelated contention stops after three attempts.
No network retry, latest-version substitution, schema or API change is added.

Follow-up: the same two-connection schedule reproduced all three remaining
workflow families from the historical cloud failures: Work create, category
restore and plan publish. Apply the identical boundary to those methods.
Original category versions still reject stale writes, plan publication remains
idempotent, and persistent contention has three attempts with no partial or
duplicate entity/Activity/Outbox effects. This reproduces a concrete product
failure mechanism; the unpushed cloud run itself remains outstanding.
