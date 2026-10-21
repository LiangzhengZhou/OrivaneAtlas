# ADR0094 — Original File commands and binary transfer

2026-10-14. Implementation pending; this is not Files acceptance. FINAL Phase
10/11 depends on the existing first-class File and verified chunk storage from
ADR0064/0067. Keep the existing LibraryFile model and original binary identity.

Local upload, rename and soft-delete/restore must capture detached original
Application input in the same metadata transaction as File, Activity and Outbox.
Upload captures the stable File ID, original location/name/MIME/policy, size and
content hash. Original binary bytes remain in content-addressed storage, never
inside the command, receipt, Activity or JSON/Base64 payload. Later rename or
policy/projection changes must not rewrite the earlier upload command.

Authenticated binary transfer has separate bounded begin/chunk/status/complete
operations. The server resolves actor/workspace, checks permissions before
reading private descriptors and rechecks access inside each scoped transaction.
Chunk and whole-content verification, resume, duplicate protection and corruption
handling reuse the existing Application binary ports and SQL adapters. Metadata
publication requires completed verified bytes; absent bytes leave original
metadata intent pending, not acknowledged or guessed. Upload visibility remains
immediate locally and binary sync happens in the background.

File metadata replay preserves original IDs and source versions through ordinary
FileService operations, an explicit narrow effect guard and the same durable
business/receipt transaction. Append-only migrations are necessary only if the
persistence contract changes; existing file descriptor/chunk tables are reused.
Do not create a second attachment entity or revive ProjectMaterial FILE.

Pull and ACK validate scoped canonical File metadata, preserve immutable original
identity and pending local edits. Remote binary is downloaded on demand using
the bound account/workspace and verified before availability. No Library render
may fetch every binary. Deletion remains soft and GC must not delete referenced
or pending original bytes.

Acceptance requires SQL/PostgreSQL parity, original-command capture/restart,
stable-ID collision, auth-first private reads, incomplete/corrupt/resumed chunks,
atomic missing-effect rollback, exact duplicate receipt, lost-response recovery,
remote file rename conflict, real IndexedDB/Host tests and bounded large-file
transfer evidence. Formal external capabilities and API scopes remain a separate
FINAL gate; a private cookie replay path does not authorize external agents.
