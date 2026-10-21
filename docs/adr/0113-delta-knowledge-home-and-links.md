# ADR 0113: Distinguish document home from knowledge relationships

Accepted 2026-10-16 for the Pre-Acceptance Delta.

The document action “整理到知识空间” changes its existing spaceId through
LibraryService.moveDocument, preserving ID, Markdown and policy. The distinct
“关联到知识空间” creates a REFERENCES link and changes neither home nor body.
Note promotion remains an explicit independent knowledge-document creation,
with source preservation explained; it is not mislabeled as moving a note.

Move is a durable local library.move command. Its exact single-effect intent is
replayed through the human-only versioned library/move REST endpoint, within
the existing knowledge receipt transaction and cursor/CAS guards. Destination
validation uses metadata rather than requiring the target Space description.
Existing child-document refusal and alias collision rules remain. Ordinary
duplicate titles are allowed, consistent with document identity by ID.

No automatic conflict overwrite or schema migration. Unsupported structural
conflicts remain review barriers. API documentation includes both aliases.
