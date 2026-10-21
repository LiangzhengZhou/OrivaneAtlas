# ADR 0067 — File binary completion and SQL chunks

Status: implementation in progress; Host File API acceptance pending.

File metadata references completed, verified content-addressed bytes. SQL adapters
must expose the same chunk/resume contract as local storage, without Base64 or a
second File entity. Add descriptor chunk size and completion state using paired,
append-only migrations; legacy descriptors remain incomplete until verified.

Application owns upload bounds, chunk shape and whole-content verification through
a repository port. SQL owns workspace-scoped immutable chunk insertion and durable
completion. Repository handles live inside the existing authenticated request
transaction and reject use after close. No new unauthenticated database entry point.

MIME belongs to each File's metadata. Shared bytes do not copy another File's
permissions or MIME. Failed or incomplete uploads cannot be downloaded as complete
content. Same-hash duplicate chunks are idempotent; mismatched bytes reject. Binary
chunks do not enter Activity, Outbox or JSON responses. File entity changes retain
the existing same-transaction Activity/Outbox/change sequence.

Acceptance requires shared SQLite/PostgreSQL binary contracts, closed-port and
workspace denial, corruption/missing chunk checks, resume/reopen, paired upgrade
and backup tests. Host upload routes, binary sync, parser safety and GC remain
separate dependent work.
