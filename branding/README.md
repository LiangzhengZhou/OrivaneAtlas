# Application icon

`application-icon-source.png` is the canonical application icon source imported for v2.3.
It is RGBA PNG1320×1191, SHA256
`CB8711F35456A3DED810C8658FE303AAFB95DF35978B88F81046BE8DF33412DC`.
The web wordmark remains a separate typographic asset, not an application icon.

Run `pnpm icons:generate` with the repository's installed Playwright Chromium.
The script generates Windows ICO frames (16, 24, 32, 48, 64, 128, 256), PNG,
Store and macOS/iOS resources, Android adaptive foreground, dark background,
legacy and round launchers, and Web favicon/192px/512px resources. Windows
16/24/32px frames use the entire source image without extra padding. A shared
`#172033` backplate provides contrast for the pale source at small sizes; the
artwork is not tinted, cropped or redrawn. Contain scaling preserves the source's
non-square aspect ratio. Android
uses source-image padding and the existing 13% foreground wrapper to keep the
complete source within the 66dp safe circle. The OS monochrome notification glyph
is a separate system resource and is not a launcher icon.

`apps/web/public/orivane-atlas.png` is the protected Sidebar/Home brand logo.
Its bytes and Sidebar URL remain unchanged; it is independent from application icons.

Android canonical resources live in `src-tauri/icons/android` and are copied to
the real Gradle application's `res` directory. The notification plugin references
`atlas_notification`; Tauri's bundle configuration references `icons/icon.ico`.
Do not edit generated resources independently. Check safety and packaging parity
with `pwsh -File scripts/check-android-icon.ps1`.

Automated pixel/frame checks and successful builds do not verify Explorer,
taskbar, shortcuts, or a physical Android launcher. Those require device checks.
