# ADR0093 — Original plan preview and publication replay

2026-10-14. Next FINAL Phase10/11 family; implementation not yet wired. This
decision preserves existing WorkflowService manifest parsing, base revision,
document revision, ownership, human review and all publication rules.

Capture detached original preview manifest/project context and the original
preview revisions together with its stable Workflow ID. The server executes the
ordinary preview and must compare resulting base/document revisions to the
original preview. Recomputing a new preview baseline and silently treating it as
the old user-reviewed preview is forbidden. Same source version checks apply to
any revision or publication command. Local pending/foreign edits are not erased.

Canonical PLAN records must validate manifest-v1 shape using the existing parser,
identity/workspace/audit/version and preview/publication metadata. Map only the
explicitly bound remote owner to the installation owner in the local projection;
retain original remote audit facts in remoteBase. Do not reject an entire sync
page merely because supported PLAN records appear once their contract is wired.
Until then, retain existing fail-closed behavior before cursor advancement.

Publication may write Work/edges, Category, Recurrence, Library and project
materials in one transaction. Preserve original primary IDs by purpose; revision
and audit IDs stay ordinary. Compose complete effect guards around existing
Application ports and require all declared effects to be consumed, including
multi-version writes to an entity. Do not implement a second planner or move
Domain rules into Rust. Missing/extra/stale effects roll back business changes,
Activity/Outbox, WorkspaceChange and durable receipt together.

Source audit found plans/preview uses raw url.pathname after normalized route
dispatch. Add a public v1 regression and use normalized path; preserve preview vs
publish permissions and review requirements. Native transport must explicitly
allow the intended v1 methods, without broadening arbitrary routes.

Verify real SQLite/PostgreSQL stable/duplicate/stale preview and publication,
partial-effect rollback, exact canonical receipts, original Markdown/provenance,
actual Host+IndexedDB offline/restart/recovery and the existing DeepSeek external
harness. No paid provider is required for CI. No automatic first binding, merge,
last-write-wins, external approval bypass, release or server operations.

Guard composition audit: existing Work/Recurrence/Category replay guards intentionally reject each other’s mutation methods. Do not weaken those guards globally to make PLAN publish pass. Add an explicitly scoped PLAN publication WorkTransaction guard for its allowed collections and compose the existing knowledge/project store guards around the same caller-owned transaction. Reuse canonical validators and ordinary WorkflowService rules; this is a separate complete effect boundary, not another business model. Preview/revision must still compare original base/document revisions and publication must retain the ordinary human review gate.
