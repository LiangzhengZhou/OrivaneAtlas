# ADR 0071 — Scoped durable mutation receipts

Status: implementation in progress; sync runtime acceptance pending.

Reuse SQLite's existing request receipt ledger. Add optional device attribution
without invalidating old receipts; introduce the equivalent ledger in PostgreSQL
inside the existing authenticated knowledge transaction. Mutation key, request
digest and optional device must match before replaying an existing result.

Business effects, Activity/change log and the receipt commit in one transaction.
Workspace membership is rechecked before returning a cached result. The same
key in another actor/workspace is independent; the same key with another digest
or device conflicts. Failures cannot leave a success receipt. No in-memory receipt
cache, direct SQL mutation API or client identity authorization is introduced.

Append-only migrations preserve historical schemas and SQLite receipts. Device
attribution is metadata, not a credential. Public sync contract and capability
exposure still need separate authenticated host wiring and OpenAPI validation.
