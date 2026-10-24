# ADR 0137 — Keep point reads consistent with a staged collection read

Status: accepted for implementation, 2026-10-24.

A two-connection IndexedDB fixture reproduces a valid plan publication failing
with VALIDATION_ERROR when the preview ACK arrives between workflows.list and
saveWorkflow's point read. The ACK retains entity version 1 but replaces the
provisional creation time with the canonical server time. Comparing the old
collection row with the new point row incorrectly treats this as an immutable
field edit, before the existing workspace revision guard can abort the stage.

Once LocalMutationTransaction has read a collection, subsequent get/getMany for
that collection must use the same captured rows, including absence. Staged
business/internal writes still take priority. Returned values remain detached.
No cache crosses transaction or account/workspace boundaries. Point reads made
before a collection read keep the existing adapter path; this is not a new
database snapshot API.

The existing final workspace revision CAS remains authoritative. A concurrent
ACK aborts the entire stale write stage, then the existing bounded publication
restart repeats authorization and entity CAS using the original command version.
No new retry category, latest-version substitution, LWW or network retry is added.
Unchanged-revision immutable-field edits and genuine entity-version conflicts
continue to reject. No schema or production migration is needed.

Validation requires real two-connection IndexedDB ACK-before/ACK-during cases,
original Markdown and dependency retention, one publication Outbox command,
idempotent repeated publication, and existing bounded contention/security tests.
Browser and performance gates must run again after this implementation.
