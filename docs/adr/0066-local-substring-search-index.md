# ADR 0066 — Local indexed substring candidates

Status: implementation in progress; scale/performance acceptance pending.

Local Markdown search must work without Host FTS and cannot load all bodies on
each query. Keep normalized search text derived at content writes. IndexedDB v3
adds a multi-entry index of Unicode 1/2/3-character grams, scoped by workspace
and collection. Query a gram for candidates and verify the full normalized query
against those candidates. Preserve existing substring semantics, including Chinese
and short queries, without changing Markdown or depending on paid providers.

Application defines the pure gram/key function; adapter owns index projection.
Index changes share the entity transaction and do not create a separate business
Outbox. v1/v2 upgrade derives keys from existing search records, not Markdown;
restore recomputes projections rather than trusting imported index keys.
Pending Application writes override persisted candidates in the same request.

Derived index is not the full RetrievalService or extracted File chunk index.
Malformed index, old-schema migration, deletion, scope and large datasets require
tests. Local search integration and measured costs remain required before acceptance.
