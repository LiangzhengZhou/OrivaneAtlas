# ADR 0064 — First-class Files and original bytes

Status: implementation in progress; no Files acceptance claim.

FINAL specification sections22–25 and Phase14 require a versioned LibraryFile
independent from ProjectMaterial FILE and Markdown LibraryAsset. The local
Runtime needs this entity before Phase9 can be accepted. Establish its Domain
and persistence foundation now; extraction, binary sync and unified Library UI
remain later dependent work.

Metadata contains stable identity, workspace, display/original name, MIME/size,
SHA256/blob reference, provenance, ContentPolicy, processing status and lifecycle.
Original name and original bytes are immutable; rename changes display name.
Private/local-only/AI-deny is the default inherited policy, not blanket consent.
Domain does not import Blob, IndexedDB, Rust, parser or provider implementations.

Binary storage is separate and content-addressed. Only hash-verified completed
bytes can produce visible File metadata. Local metadata, Activity, durable Outbox
and sequence changes commit atomically; abandoned immutable blobs require GC.
Project/Document relations reference File identity and cannot recreate the old
project-only/base64 entity. Extraction/indexes are derived and never replace bytes.

Schema changes must be append-only for both SQL adapters, with fresh/upgrade,
parity and backup/restore tests before acceptance. Parser and upload budgets,
malformed inputs, workspace authorization and CAS require real tests. No macro
execution or external agent database bypass is authorized.
