# Orivane Atlas 3.1.6 — atomic project archive and architecture hardening

3.1.6 makes project archive a single recoverable transaction and completes the
first architecture-hardening pass.

## Highlights

- Project archive is now atomic: project state, owned documents/spaces/files and
  ProjectMaterials are trashed in one workspace transaction with Activity/Outbox.
- Project restore uses a stable archive batch, restores only unchanged members,
  preserves Markdown/file bytes and never overwrites later edits.
- Archiving requires `work:delete`; restore requires `work:update`.
- Generic FolderLink now accepts only NOTE/DOCUMENT/FILE; project/space folder
  relations use their dedicated tables. SQLite 49 / PostgreSQL 44 guards reject
  new generic PROJECT/SPACE links while preserving legacy rows.
- Note folder reads prefer the authoritative `primaryFolderId`; the legacy
  organization folder id remains only a body-unavailable compatibility fallback.
- Project document creation uses the real primary project-space binding instead
  of a title match.
- WorkItem is now an internal discriminated union; project/task/other work
  shapes are checked at compile time while HTTP/storage stay compatible.
- Floating menu/calendar/context surfaces use correct viewport coordinates.

## Compatibility

- SQLite schema 51 / PostgreSQL 46 (additive migrations).
- Existing archive flags are backfilled; old generic FolderLink rows are kept
  readable, not deleted.
- Legacy `/api/organize` project archive keeps its metadata-only behavior for
  old clients; the new UI uses the atomic work command.

## Validation

- `pnpm check`: 1573 tests passed / 1 skipped.
- Full Playwright: 783/783 passed across desktop-en, desktop-zh and mobile-zh.

## Published artifacts

- GitHub Release: https://github.com/LiangzhengZhou/OrivaneAtlas/releases/tag/v3.1.6
- Tag: v3.1.6 (immutable release commit 4cfc6ff)
- Windows: `OrivaneAtlas-3.1.6-windows-x64-setup.exe` SHA256 `f1b97cfe64ed4e7607203863b9f8b286b1a14c8e386b60c22618d9a27c733722`
- Android: `OrivaneAtlas-3.1.6-android-arm64.apk` SHA256 `380c797ff405a43f6311bb93653f3e553661a67eb1d3c8c275b4d4706c118408`; v2/v3 signatures and production certificate verified; versionCode 3001006.
- Update manifests: `latest.json`, `android.json`, `SHA256SUMS.txt`.
- Production: https://123.207.179.150:11220 deployed; SQLite schema 51; public health 200; bundle byte-identical to local release build.
