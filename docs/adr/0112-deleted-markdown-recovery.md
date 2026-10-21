# ADR0112 — Explicit recovery of remotely deleted Markdown

2026-10-15. FINAL Phase12 requires remote-delete/local-edit choices without silently losing the local original. Implementation in progress; this ADR does not claim the full conflict UI/disposition is complete.

Restore-and-keep is an explicit human command. It composes ordinary Notebook/Library restore and save inside the existing caller-owned business transaction, preserving hierarchy, Markdown validation, policy, Activity, Outbox and revision rules. Failure of save must roll back restoration. Library recovery initially targets Documents, not an implicit resurrection of a Space tree. External-AI provenance and bearer API credentials cannot invoke this path.

The existing formal save route gains optional restoreDeleted:true for this command; it requires an existing id/current version and excludes stable create identity. Two sequential checked UPSERT effects are receipted together with one canonical final entity and one stable request key. Local note.restore/library.restore commands retain both mutation revisions under one command, and the existing KnowledgeReplayEffects/ACK mechanism remains authoritative. OpenAPI documents both aliases. No schema migration or direct database restoration endpoint is introduced.

Accept-remote-delete and save-as-new must use an atomic local conflict disposition preserving original command/body evidence and validating fresh binding/base/workspace state. Restore must replace the conflict and queue its complete formal command atomically. Those local disposition and UI paths are still required work and are not implied by the formal restore primitive alone.
