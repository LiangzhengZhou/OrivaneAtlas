# ADR 0025: Project archive projection

Date: 2026-09-17. Status: implemented locally. Extends ADR0014/0024.

Project archive uses existing versioned organization metadata, not status or soft deletion. Archive/unarchive now accepts projects; project deletion remains in WorkService with existing child protection. Data, organization activity/outbox and public idempotency receipt remain in the same Host transaction. No schema change.

Effective archive is a read-only workspace-scoped projection: explicit archive on an item or any live project ancestor hides it from normal work views. An explicit false value on a descendant cannot override its archived ancestor. Restore the ancestor (or change the parent) to remove inherited archive; UI explains this rather than offering a no-op restore. Restoring an ancestor preserves independently archived descendants. Knowledge/notes and dependencies are not changed. This is organization/visibility, not authorization or an execution prohibition.

Recursive project summaries count live non-project descendants exactly once, including archived work so archiving does not rewrite historical progress. Project task navigation includes descendants. Broken/deleted/foreign parents stop traversal; cycles terminate defensively.

Current projectId remains a single membership. Many-to-many is not implemented by this ADR; before introducing it, replace inherited task archive with an all-memberships-archived rule (any active membership preserves visibility), retaining explicit item archive precedence. Category and membership schema migrations remain separate work.
