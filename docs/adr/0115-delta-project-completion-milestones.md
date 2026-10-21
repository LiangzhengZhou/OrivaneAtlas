# ADR 0115: Include milestones in explicit project completion review

Accepted 2026-10-16 for the Pre-Acceptance Delta.

Project completion must require an explicit resolution for unfinished milestones,
as it already does for tasks and descendant projects. Milestones retain their
existing parentProjectId ownership; task membership remains projectIds.

KEEP leaves every child unchanged. CANCEL cancels unfinished milestones; INBOX
detaches their parent; MOVE assigns the reviewed destination project after the
existing destination validation. All writes retain version CAS, Activity and
Outbox in the caller's transaction. Failure rolls back the entire completion.
Completion does not archive or delete a project and completing children does
not automatically complete their parent. No schema or release change.
