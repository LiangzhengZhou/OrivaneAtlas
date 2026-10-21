# ADR 0128 — Preserve legacy Project originals while adopting first-class Files

Status: implemented; focused verification in progress, 2026-10-19.

The populated audit found that preserved pre-v3 ProjectMaterial FILE metadata
still rendered, but its retired browser Base64 reader could not retrieve bytes.
New uploads must remain first-class Files. Re-enabling the old upload/runtime
or discarding historical originals is not a valid fix.

An explicit cookie-only legacyProjectMaterial=1 variant of the existing raw File
bytes route reads the original through ProjectService. It checks workspace,
live Project/material, read permission and exact original version inside the
authenticated request boundary. Bearer is denied. Raw bytes use the existing
Windows/Android binary bridge, never JSON/Base64 IPC or model context. The old
stored representation is decoded only inside the Host compatibility boundary.

On first user download, the local runtime verifies the captured source scope,
origin/account/workspace/epoch and local material version, then writes original
bytes to the durable content-addressed BlobStore and creates a first-class File
with the same stable ID. File upload and relationship retain their separate
atomic Application/Outbox commands and existing exact replay contracts. A File ID
collision or source mutation rejects; no overwrite, LWW or version substitution.
Failed association exposes the durable File through the existing recovery UI.

Import never edits or deletes historical material/bytes. Once the corresponding File
is available in Project Knowledge, its old row is hidden to avoid duplicate UI;
subsequent File reads use local bytes, including offline reload. This is a bounded
compatibility import, not a new ProjectMaterial File model or general converter.
No schema migration or production data operation is performed by development.

Real IndexedDB covers new/legacy success, failed File commit, failed relationship
commit and restart recovery (6/6). Focused real Host covers exact raw bytes,
version mismatch, invalid mode, Bearer denial and deleted source rejection.
Three-configuration browser/offline/reload evidence remains pending.

Subsequent verification reproduced an additional pre-existing incompatibility:
strict new Space/Document write validation was also used for pulling historical
FILE metadata, stopping its cursor. A separate bounded read-replica validator now
accepts only the exact legacy metadata shape and original 2MiB/name/MIME limits;
it rejects bytes/Base64, wrong workspace/version, ownership changes and unknown
fields. The new write validator still rejects FILE creation. Existing originals
may be explicitly deleted/restored offline through a narrow lifecycle guard:
only version/updater/time/deletedAt can change, with original CAS, transaction and
receipt checks. Contents, location, ownership and identity cannot change.

Final targeted evidence: 38/38 Application/real-IDB tests; browser6/6 across the
three configurations (new upload and legacy offline delete/restore/reload,
reconnect replay, exact raw bytes/hash, same ID, menu download and File opening).
See session285-legacy-final-browser-results and session285-legacy-final-unit.log.
No original failure evidence removed. Full automated acceptance remains pending.
