# ADR0033 — Project workspace

Accepted 2026-09-18. Extends ADR0013/0024/0026 and the architecture's Project views.

A project is a workspace for its Markdown brief, documents and reference material, child projects, tasks and their dependency graph. Task completion is one metric, not the definition of a project. Keep PROJECT identity and its single parent unchanged. Expose explicit child creation and parent navigation. The existing application validates ancestry, workspace isolation and depth.

The first project workspace uses existing outgoing WORK → NOTE/SPACE/DOCUMENT REFERENCES links as explicit reference membership. Materials retain independent identity, revisions, permissions and Markdown. Removing a reference never deletes its target; project archive does not archive referenced material. Hide deleted targets and documents whose space is deleted. These are linked materials, not exclusive project ownership; owned files, project-specific document creation, timeline and activity views remain future work. No schema or API change is required for this projection.

The dependency view includes deduplicated tasks across the project subtree and external endpoints of incident dependencies so outside blockers are visible. Hierarchy is not a task dependency. Graph mutations continue through existing authenticated application contracts, without changing DAG semantics.

Desktop collapse is a persisted local view preference. Mobile navigation has independent disclosure state, explicit accessible controls and labels, and must remain operable when desktop navigation is collapsed. Neither preference is business data.
