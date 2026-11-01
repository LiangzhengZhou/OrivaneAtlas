# Orivane Atlas 3.1.0 — release notes (draft)

Orivane Atlas 3.1.0 brings the design-system v1.1 workspace refinements and the remaining 3.1.0 work.

## Highlights

- Note workspace v1.1: breadcrumb, updated/primary-folder metadata, 760px reading column.
- Independent file library and resource detail panel.
- Task grouping by project/priority/status, collapsible groups, named saved views.
- Structured task checklist steps (`- [ ]` Markdown), editable in the task editor.
- Folder/space/project covers: upload, choose from the file library, focus, 16:9 preview, clear on UI file deletion.
- FolderLink outbox/replay with server effect guards.
- Non-empty folder delete now cascades soft-delete and retains notes.

## Compatibility

- Web client + SQLite host migrations 46–48 (PostgreSQL 41–43).
- Windows NSIS/updater and Android arm64 APK built from this source.
- Existing data and permissions are preserved.

## Known limitations

- Structured steps are Markdown-backed rather than a separate TaskStep entity.
- Server-side file deletion outside the web UI does not cascade covers.
- Native physical-device/manual acceptance is separate from automated builds.
