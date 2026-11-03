# Orivane Atlas 3.1.2 — release notes

3.1.2 is a small UX hotfix on top of 3.1.1.

## Changes

- Toasts, including the Move to Trash / Undo notification, automatically dismiss after **10 seconds**.
- A thin lifetime bar at the bottom of each toast shrinks over the same 10 seconds.
- Manual dismiss and Undo still work immediately.
- The undo action now uses local card state instead of a shared pending id.

## Compatibility

- Web client and SQLite host: schema 48 (no migration).
- Windows NSIS/updater and Android arm64 APK rebuilt from this source.
- Existing data and permissions are preserved.
