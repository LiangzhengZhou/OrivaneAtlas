# ADR0095 — Bounded, derived File extraction

2026-10-14. In progress; no Phase15 acceptance claim.

FINAL sections24–25 and Phase15 require text/table/page/sheet/slide extraction without replacing original bytes. Application owns authorization, immutable source hash/version, parser output validation, stale-source rejection and retrieval policy. Parsers are adapters behind a FileParser port; Domain contains only derived records. No parser or AI SDK enters Domain/Application and Rust does not duplicate business rules.

Derived extraction is workspace scoped, tied to original File identity/content hash and parser/index version, and durable locally. It never embeds original bytes, creates a Task or silently rewrites a Document. Parsing runs outside storage transactions; publication rechecks live File identity/version and commits derived records atomically. Existing original File commands and immutable sync receipts remain unchanged.

Budgets apply before allocation and during output: input bytes, archive entry count and expanded bytes, XML depth/nodes, page/sheet/slide count, output characters/chunks and wall time. Reject malformed UTF-8/JSON/XML, archive path traversal, duplicate members, external entities/DOCTYPE, encrypted or macro-bearing Office packages and unsupported executable formats. Never execute macros/scripts, follow external relationships or download fonts/resources. PDF uses maintained PDF.js with evaluation and network disabled. Worker isolation and termination enforce wall time; failures remain diagnosable and preserve original bytes.

Acceptance requires real malformed and boundary fixtures, original-byte hashes unchanged, scoped/stale/deleted source rejection, SQL/PostgreSQL/local persistence and restart parity, UI/runtime wiring, retrieval of relevant chunks only, and measured responsive preview behavior. Foundations alone do not meet this gate.
