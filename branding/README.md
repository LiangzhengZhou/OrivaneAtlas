# Application icon

`app-icon-master.svg` is the sole source for the Orivane Atlas compass mark.
The web wordmark remains a separate typographic asset, not an application icon.

Run `pnpm icons:generate` with the repository's installed Playwright Chromium.
The script generates Windows ICO frames (16, 24, 32, 48, 64, 128, 256), PNG,
Store and macOS/iOS resources, Android adaptive foreground, white background,
legacy and round launchers, and a monochrome notification vector. Small Windows
frames have less padding so the compass remains legible. Android uses the existing
13% foreground wrapper to keep the mark within the 66dp safe circle.

Android canonical resources live in `src-tauri/icons/android` and are copied to
the real Gradle application's `res` directory. The notification plugin references
`atlas_notification`; Tauri's bundle configuration references `icons/icon.ico`.
Do not edit generated resources independently. Check safety and packaging parity
with `pwsh -File scripts/check-android-icon.ps1`.

Automated pixel/frame checks and successful builds do not verify Explorer,
taskbar, shortcuts, or a physical Android launcher. Those require device checks.
