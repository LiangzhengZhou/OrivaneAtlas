# ADR0101 — Versioned canonical File citations for Atlas

2026-10-15. File is a first-class AI context source. Explicit human invocation selects at most three canonical extraction chunks (12,000 text characters), with source hash, extraction index version and locators. Client-supplied File body text is never trusted. Extraction remains derived and can be prepared in a bounded Host Worker outside a business transaction.

Application owns File/parent policy, workspace, live source revision and model scope validation. Content permission is separate from execution approval. Approval, model routing/fallback and every Harness boundary re-read File metadata, parent policy and the exact canonical cited text. Revoked policy, changed version/hash, missing or altered chunks must prevent model transmission. No browser secret storage or direct provider fetch is introduced.

The existing AgentRun JSON context stores an optional File citation identity; previous NOTE/SPACE/DOCUMENT data remains compatible. No historical migration is edited and no new File original version is created by reading/indexing. Existing formal capabilities will be extended through the shared contract, not through unrestricted binary access or an external database bypass. This record does not claim completion of File capability/API/MCP parity, contextual Atlas surfaces or full FINAL acceptance.
