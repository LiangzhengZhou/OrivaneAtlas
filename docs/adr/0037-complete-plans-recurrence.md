# ADR0037 — Complete reviewed plans and recurrence defaults

Accepted 2026-09-18. A manifest is an additive proposal, never an instruction to
execute an agent or convert Markdown into tasks. Version 1 remains readable and
can contain projects, categories, tasks, recurrences, knowledge spaces and
documents. All temporary identifiers share one namespace and explicit references
must resolve to the correct entity kind. Projects are sorted by actual ancestry;
cached depths retain their numeric values and include an existing parent depth.

Preview persists the normalized proposal and an optimistic snapshot of the work
graph, categories and document extension revision. Publication is explicit,
creator-bound, version-checked and idempotent. Every created entity has confirmed
field provenance. Publication and its events use one workspace transaction;
document integration must use that same transaction and fail closed if absent.
The extension must never open an independent committing transaction.

Recurrence defaults include endDate (inclusive), multiple projects, assignee,
priority and activation. Generated and explicitly backfilled tasks use the
immutable occurrence rule snapshot. An end date before the start is rejected.
No JSON payload DDL migration is required; backups preserve these fields.

Integration contract will be recorded in docs/agent/workflow-integration.md.
