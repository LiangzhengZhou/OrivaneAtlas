# ADR 0119 — Preserve entity CAS while restarting aborted local lifecycle staging

Status: implemented and targeted-verified, 2026-10-16.

A real two-connection IndexedDB reproduction demonstrated that an unrelated
transaction advancing `$local.workspace/revision` aborts a staged Project restore.
The adapter now identifies the conflicting collection and ID without exposing
entity contents. Work delete/restore may restart its entire aborted Application
transaction at most twice, exclusively for this workspace-revision conflict.

The originally supplied entity version, actor, workspace and intent remain
unchanged. Every restarted transaction repeats authorization, lifecycle checks,
entity CAS, and atomic business/Activity/Outbox commit. A genuine entity version
conflict propagates; no latest-version substitution or LWW is allowed. Other
errors are not retried. This does not retry network requests or tests.

Real IndexedDB tests cover unrelated writes and same-entity concurrent restoration,
including exact entity versions and Outbox counts (no aborted commands persist).
Browser assertions distinguish local durability from eventual remote replay, while
retaining the requirement that the remote entity is restored before proceeding.

Evidence: real IndexedDB/transaction/Outbox/rebase27/27; Project Undo browser3/3
(desktop-en, desktop-zh, mobile-zh), production build, typecheck and lint passed.
This does not establish full FINAL acceptance.

The same boundary now covers `LocalRuntime.saveLibrary`: real IndexedDB tests
cover unrelated writes, same-Document edits and continuous contention. The original
Document version, empty title and exact Markdown draft remain unchanged. Fresh
same-Document edits still reject with VERSION_CONFLICT; continuous contention
rejects after three total attempts. Aborted drafts produce no Outbox entries.
Lazy body storage is read through `readDocumentBody`, never assumed to be present
in the metadata projection. Together with File read and Project restore tests:
3 files, 8/8 PASS in `.artifacts/codex-document-file-contention-verified.log`.
Browser regression of this addition remains pending.

Session288 extends the same narrow boundary to manual-order moves. A real
two-connection IndexedDB reproduction rejected an unrelated workspace revision
advance while preserving the original order CAS. The existing helper now restarts
only aborted workspace-revision staging. Same-order edits still reject and
continuous contention stops after three total attempts. No aborted order command
is retained in Outbox. Evidence: session288-order-contention-before/after.log.

Reminder saves/completion use this same boundary after a real two-connection
reproduction showed an unrelated workspace revision aborting completion. Tests
preserve exact body/state, original Reminder CAS, same-Reminder rejection and
the three-attempt limit with no aborted Outbox entries. This is transaction
staging recovery, never a network retry or version substitution.

2026-10-20 continuation: the same bounded workspace-revision-only restart is
extended to creating KnowledgeLink references. A two-connection IndexedDB
reproduction shows an unrelated commit aborting a valid link transaction. Each
fresh stage rechecks authorization, both endpoint lifecycles and duplicate edges;
no entity version is substituted. Endpoint deletion and concurrent duplicate
creation still reject, and continuous contention stops after three attempts.
Only the successful stage may persist its link, Activity and Outbox command.
Current regression evidence is recorded in Session287; this is not full acceptance.

2026-10-21 Session292: deterministic two-connection IndexedDB-adapter recurrence
reproduction rejects an unrelated revision advance before saveRecurrence commits.
Extend the existing helper to recurrence.save only: captured definition version,
rule, actor and deletion intent remain fixed; every fresh stage repeats all
checks. Same-definition CAS must reject and continuous revision contention must
stop after three total attempts with zero aborted Outbox commands. Browser trace
is consistent (Pause/Resume HTTP200, no End request), but does not alone prove
the exact local error. Native-browser two-connection verification remains required.

Session292 full-r3 additionally exposes link.delete staging contention. Native
Chromium two-connection IndexedDB BEFORE evidence confirms an unrelated commit
rejects unlink with workspace-revision VERSION_CONFLICT; same-Link writes reject
and continuous contention currently aborts at the first attempt. Extend the same
existing helper to LocalRuntime.unlink only, keeping caller Link version and
actor, graph authorization, soft deletion and atomic Outbox unchanged. The new
regression requires three total attempts under continuous contention and exact
Outbox counts with no aborted unlink persisted. No other write entry is changed.
