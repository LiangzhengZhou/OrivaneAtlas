# ADR0100 — Host File extraction outside business transactions

2026-10-15. Formal Atlas/File retrieval must use canonical original bytes and derived source-version/hash chunks, never trust text supplied by a client. Add a bounded Node Worker adapter using the same parser package as browser extraction. Application remains the source of parser limits, source guards and derived publication rules; the Worker contains no business mutation or credential access.

Extraction runs outside the SQLite request queue. Authorized scoped reads and final publication each obtain a fresh guarded transaction; original File, Activity, Outbox and receipts are unchanged by derived indexing. The worker has a hard deadline, cancellation and heap bounds. Parser errors are bounded codes without raw paths/content/credentials. The host build packages its worker entry alongside main. Retrieval and model-send validation still require fresh File/parent policy, selected relevant chunks and approved execution; this adapter does not authorize inference.

Acceptance includes actual compiled worker TEXT/PDF/Office malformed/input limits, source cancellation/staleness, ordinary original-byte preservation, host authenticated retrieval and source/policy validation. No server operations or production data involved.
