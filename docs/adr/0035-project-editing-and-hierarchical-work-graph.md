# ADR0035 — Project editing and hierarchical work graph

Accepted 2026-09-19.

Projects and tasks share the `WorkItem` identity and Markdown field, but their
editing contracts remain distinct. Project editing exposes title, parent,
dates and archive/deletion state; task editing exposes membership, priority,
activation and execution fields. Existing fields remain readable for upgrade
compatibility and Markdown remains the source of truth.

The work graph renders project nodes together with their descendant tasks.
Containment is derived from `projectId` and never creates a dependency edge.
Dependency edges remain directed work edges and may connect any work types;
future collapsed rendering must aggregate boundary edges without changing the
stored endpoints. Shared tasks retain one identity and are deduplicated in
counts.

Successful mutations return to the editor as soon as the mutation commits.
Snapshot refresh is best effort and cannot hold a modal open or replace its
draft. Drafts remain component local and therefore isolated by account and
workspace lifecycle.
