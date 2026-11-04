# Orivane Atlas 3.1.4 — release notes

3.1.4 continues the workspace polish requested after 3.1.3.

## Changes

- Date calendar can be dragged by its header and renders above the task dialog instead of being clipped or displaced.
- Project has a new **Documents** tab beside Overview / Tasks / Knowledge.
  - New documents are created in a project-named knowledge space in the file library.
  - If a space with the project title already exists, it is reused instead of creating a duplicate.
- Overview task titles start at the left edge; long titles show an ellipsis and animate as a marquee on hover.
- Added a **Warm orange** palette option under Appearance.
- Project-material deletion now shows explicit Move to Trash feedback.

## Compatibility

- Web client and SQLite host: schema 48 (no migration).
- Windows NSIS/updater and Android arm64 APK rebuilt from this source.
- Existing data is preserved.

## Known limitations

- Project archive does not yet cascade-archive the auto-created project space/documents; this is the next follow-up.
- The auto-created container is a project-named knowledge space in the file library, not a separate folder entity.
