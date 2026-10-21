# ADR 0126 — Project Knowledge uses first-class local Files

Status: implemented; targeted verification in progress, 2026-10-19.

The populated UI audit reproduced Project Knowledge uploading a Base64 legacy
ProjectMaterial FILE to an intentionally retired runtime endpoint. New uploads
must use FileService and the durable local BlobStore, then a WORK→FILE REFERENCES
relationship. Existing ProjectMaterial data is preserved, not silently converted
or deleted. Original bytes never enter a command JSON payload.

A File has an independent lifecycle and identity. Upload and association are two
existing Application commands, each with its own atomic entity/Activity/Outbox
transaction. LocalMutationTransaction remains single-command: neither its sealed
write set nor exact File replay validation is broadened. This is intentionally
not an atomic two-entity upload promise.

Validate the live Project before upload; association repeats current authorization
and endpoint existence checks. If the second command fails, propagate a typed
FileProjectLinkError containing the already durable File, preserving the cause.
The UI distinguishes saved File from failed association and offers open/retry
without uploading bytes again. After restart the File remains available in Files;
no relationship is reported as committed unless its transaction succeeded.

Real IndexedDB coverage includes success/reopen/raw-byte equality, failed File
commit leaving no File/link commands, and failed link commit retaining exactly
one File upload command followed by successful relationship-only recovery after
restart. Existing single-command guards, entity CAS and replay contracts remain
unchanged. No schema migration or new server endpoint is required.

Evidence: session285-project-file-recovery.log (5 tests including read contention).
Browser/complete FINAL gates remain pending; this ADR is not release acceptance.
