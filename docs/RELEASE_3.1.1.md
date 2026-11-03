# Orivane Atlas 3.1.1 — release notes

3.1.1 is a UI/correctness hotfix on top of 3.1.0.

## Fixes

- Project cover controls no longer overlap the breadcrumb/title. The cover area now sits below the project header; when no cover is set only the compact actions are shown.
- File library detail panel now offers **Move to Trash** for DOCUMENT and FILE resources, with confirmation and undo toast.
- Production DeepSeek configuration: the invalid primary model id `Deepseek` was replaced with the valid `deepseek-flash`.

## Compatibility

- Web client and SQLite host: schema 48 (no migration in this patch).
- Windows NSIS/updater and Android arm64 APK rebuilt from this source.
- Existing data and permissions are preserved.

## Known limitations

- Structured task steps are Markdown-backed rather than a separate TaskStep entity.
- Server-side file deletion outside the web UI does not cascade covers.
- Native physical-device/manual acceptance remains separate from automated builds.
