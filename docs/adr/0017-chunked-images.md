# ADR 0017: Images without a product file-size cap

Accepted, 2026-09-15. Supersedes ADR 0016's 500,000-byte image limit and workspace image quota.

The image picker and clipboard upload use sequential 256 KiB chunks, with no product whole-file size or aggregate workspace image quota. Disk capacity, database limits, network and browser decoding resources remain finite. Normal JSON request limits remain in place; the legacy single-request upload stays bounded for compatibility. Markdown text limits are unchanged.

Migration 9 adds private upload metadata and chunk tables inside SQLite, so consistent database backups include every committed chunk. Uploads belong to a workspace and principal and require a live parent space when scoped. Each chunk is transactional with Activity/Outbox and request idempotency; only finalization exposes an asset. Validate the image signature in the first chunk. Sequential indices and immutable upload metadata prevent mixed files. Completed uploads cannot be appended. Downloads read bounded chunks with backpressure and repeat authorization.

Incomplete uploads are private and expire after 24 hours of inactivity; cleanup occurs on subsequent chunk writes in that workspace. Completed data is never garbage-collected by this cleanup. Rollback restores the independent pre-v9 backup; do not open v9 using old code. Legacy image bytes and URLs remain unchanged. Offline backups remain supported; the existing bounded browser backup download is not suitable for large databases.
