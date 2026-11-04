# Orivane Atlas 3.1.5 — release notes

3.1.5 fixes the project-documents and palette issues found after 3.1.4.

## Fixes

- Project Documents button renders localized text instead of a raw JavaScript expression.
- Project document rows now have a working three-dot menu with Move to Trash.
- Project documents are grouped as project folders in the file library (project-owned spaces are no longer listed as ordinary knowledge spaces; root-level files no longer leak into the knowledge-space list).
- Added **Orange white** palette: white surfaces with a warm orange accent.
- Palette swatches now use each palette's own colors; the warm-orange card no longer shows a green sample.
- Palette grid adapts to the number of available palettes.

## Compatibility

- Web client and SQLite host: schema 48 (no migration).
- Windows NSIS/updater and Android arm64 APK rebuilt from this source.
- Existing data is preserved.

## Known limitation

- Project archive does not yet cascade-archive the project documents/space; this remains the next follow-up.
