# ADR0090 — Original Project Knowledge replay

2026-10-14. FINAL Phase10/11 continuation.

Preserve the existing Space/Document ProjectMaterial relationships and Application ownership/primary/privacy rules. Capture original Project commands in the entity/Outbox transaction with both allocated material and target IDs. Primary allocations use purpose-aware ID source; audit/revision IDs remain ordinary zero-argument next(). Stable creation authenticates before UUID or lookup and rejects existing/deleted IDs. No first-class File fallback or new relationship mechanism.

Compose guarded ProjectStore and existing KnowledgeReplayEffects inside the business/receipt transaction. Every actual material/library save must match the complete original declared version set; no undeclared library writes or legacy File/Base64 path. Same shared canonical ACK/pull/recovery/coordinator, strict replica CAS and body/revision/search/wiki projection; later pending conflicts remain. Native explicit v1 aliases and REST schemas. Not automatic workspace binding or conflict last-write-wins.

Validate real SQLite/PostgreSQL stable identities and rollback, Host missing-effect rejection/exact duplicate, real IndexedDB offline creation/restart/sync/deletion preserving Markdown, unit/type/lint/native. Broader FINAL Files/binding/conflict/sync gates remain separate and unfinished.
