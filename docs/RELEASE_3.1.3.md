# Orivane Atlas 3.1.3 — release notes

3.1.3 fixes the task date picker in the task dialog.

## Fixes

- Start date and due date calendars now escape the native task `<dialog>` clipping box and render as a proper floating surface.
- Both date pickers open reliably; the due-date picker no longer appears to do nothing.
- Includes the 10-second toast lifetime bar from 3.1.2.

## Compatibility

- Web client and SQLite host: schema 48 (no migration).
- Windows NSIS/updater and Android arm64 APK rebuilt from this source.
- Existing data is preserved.
