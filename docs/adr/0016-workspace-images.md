# ADR 0016: Private workspace images and clipboard insertion

Status: accepted, 2026-09-15.

Notes and journals need images without creating a knowledge space. Reuse the authenticated image endpoint and transactional Activity/Outbox storage. An explicit null spaceId means workspace ownership; existing space-owned images still require a live space. This does not make images public or grant other workspaces access.

Append SQLite migration 8, preserving all existing bytes and adding an explicit workspace foreign key. Before upgrade use the migration runner backup; rollback means restoring the independent pre-upgrade snapshot, not opening a v8 database with old code. Verify upgrade and restoration locally before deployment.

Keep PNG/JPEG/WebP, 500,000-byte per-file validation and the existing workspace quota. No external image host, SVG, HTML injection, or remote URL fetching. Assets survive document edits/deletion and count against quota; orphan cleanup and portable image bundles are future work. Markdown exports contain private server references, not embedded files.

Clipboard images and file selection share an upload path. Track the insertion position through subsequent edits, bind it to the originating editor, reject overlapping uploads explicitly, and invalidate pending insertion if the entire document is replaced. Never replace text selected after the upload started. Ordinary text paste is unchanged. Errors retain the draft and invite retry. Both interface languages expose format/size/privacy limits.
