# ADR 0040 — Project workspace editing boundaries

Accepted 2026-09-19.

Project settings and task execution controls use separate UI components and payloads.
Project settings write title, parent and planning dates only; omitted legacy task
fields and Markdown remain unchanged. Project brief editing is a separate canvas
operation using the existing Markdown core and optimistic version captured when
editing starts. Remote refresh never rebases an unsaved draft silently.

New BLOCKS/REQUIRES edges require TASK endpoints. This supersedes the arbitrary
work-type execution edges statement in ADR0035-project-editing-and-hierarchical-work-graph.
Legacy edges remain readable and removable; no stored data is rewritten.

Parent selection and application validation include the height of the entire moved
project subtree when enforcing the existing maximum depth. Project references do
not participate in this hierarchy calculation. No schema migration is required.

Project lifecycle and single-owner migration remain separate follow-up decisions.
