# ADR0092 — Original linked knowledge commands

2026-10-14. Decision for the next FINAL Phase10/11 command family; basic Link and Note linking/promotion runtime implemented and verified; full FINAL sync/acceptance remains open.

Preserve ConnectedService graph authorization, validated references, duplicate relation policy and soft deletion. Allocate only primary KnowledgeLink identities through a dedicated purpose; AgentRun/audit IDs retain ordinary allocation. Original link creation/deletion capture commits with the existing local entity/Outbox transaction. Stable creation checks graph authorization before UUID validation/private lookup and rejects existing or deleted identity reuse.

Guard declared link effects through the existing ConnectedStore transaction, authenticated actor/workspace and original versions. Reject undeclared link and AgentRun writes. Canonical ACK/pull use the existing replica ports and keep later pending edits. Do not replace formal links with Wiki links or client-generated canonical blobs.

Note→Space linking and Note→Document promotion reuse NoteKnowledgeService source/version/space checks. Promotion preserves original title/body/provenance/AI policy, original Library/Link IDs and optional source soft deletion in one composed transaction. Reuse KnowledgeReplayEffects for body/revision/search/wiki reconciliation and the link guard for relation effects. A partial effect declaration must roll back document, relation, source deletion and receipt together. Do not guess intent from current projections or turn Notes into Tasks.

Validate real SQLite/PostgreSQL stable/deleted identity behavior, complete/partial effects, original Markdown/source policy, uncertain receipt recovery and real Host/IndexedDB offline close/reopen/sync. No historical migration rewrite, server operations or second coordinator.

Source audit correction: PostgreSQL already has knowledge_link and its durable WorkspaceChange trigger, but no ConnectedStore transaction adapter or connected Activity/Outbox/AgentRun tables. Before shared parity tests, add the missing transaction adapter and an append-only PostgreSQL migration for tables already present in SQLite. Keep the existing knowledge_link table/history/trigger; no historical migration edits. Expose the additional adapter as a trailing knowledge() transaction callback argument so existing consumers keep their positions. Restore validation must recognize the new tables by source migration version; verify fresh, upgrade and backup restore. This is a source requirement, not an environment limitation.
