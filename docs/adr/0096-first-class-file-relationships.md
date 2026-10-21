# ADR0096 — First-class File relationships reuse the formal Link service

2026-10-14. In progress.

FINAL Files require File↔Project↔Document relationships without reviving ProjectMaterial FILE or embedding binaries in LibraryAsset. Extend the existing EntityRef with FILE and keep KnowledgeLink as the single relation entity. A Project is a WORK reference; Documents retain DOCUMENT. Existing Application authorization, complete original-command replay, CAS, Activity/Outbox and durable receipts remain the mutation boundary.

All local/SQLite/PostgreSQL endpoint adapters must validate a live workspace-owned File and its optional Space/parent Document before exposing or linking it. Hidden or deleted parents hide File relations; file deletion and incremental changes must invalidate related Link visibility. Link payload storage already accepts versioned JSON; no historical migration changes or second relationship table are needed. No File AI disclosure is granted by linking. The model context gateway must continue rejecting unsupported File context until a separately validated relevant-chunk contract is wired.

Tests must cover scoped live File endpoints, deleted/hidden parents, original local replay, duplicate/rollback and SQL/PostgreSQL parity, plus actual Library File↔Project UI. Foundations alone are not acceptance.
