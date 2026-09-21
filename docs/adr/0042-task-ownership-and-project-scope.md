# ADR 0042 — Task ownership and project scope

Accepted 2026-09-20. Supersedes multi-membership structural semantics in earlier project projections.

## Compatibility contract
Task.projectId is the single structural owner. The existing ordered projectIds collection remains physically unchanged; entries other than the owner are linked project references. An explicitly null projectId means unowned, even when references exist. Existing rows already store their first membership as projectId; no bulk rewrite or schema migration is needed.

New Application/HTTP task inputs ownerProjectId and linkedProjectIds express this distinction. They cannot be mixed with legacy projectId/projectIds. Owner-only edits retain linked references; reference-only edits retain the owner. The existing legacy input convention (first projectIds entry is owner; projectId-only edits replace memberships) remains supported for old clients and importers. No change to category.projectIds or recurrence rule wire formats. Shared task identity, Markdown and history remain intact.

Hierarchy, archive inheritance, recursive progress and owned-task scope follow only projectId. Linked tasks are shown separately as references, never counted as owned work. Restore never promotes a reference to owner if the original owner is deleted. Deleted project references remain recorded and do not block unrelated task edits or restoration; new links must target live same-workspace projects. Soft deleting a reference-only project does not delete its tasks.

## Read models
DIRECT includes tasks owned by the selected project; SUBTREE includes tasks owned by the project and descendant projects. Project records, material records and work events follow the same selected scope, with subprojects and linked references visibly identified. Project brief and settings always target the selected project. Progress shows completed, canceled and unfinished separately; it does not equate canceled with completed. Task rows and timelines show project paths.

Legacy edge activity has only edge ID, so removed-edge endpoints cannot be reconstructed. This checkpoint must not claim complete historical dependency Activity coverage. New event payload/schema design is separate.

## Boundaries
No schema migration or production rewrite. Existing backup/restore and all storage contracts must pass. Project lifecycle commands remain a follow-up; fixing ownership first prevents references from affecting completion gates.
