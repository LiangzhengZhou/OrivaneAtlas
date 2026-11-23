# Orivane Atlas identity

The map symbol is maintained in app-icon-master.svg. The editable horizontal lockup is wordmark.svg. The committed Web wordmark is shared by login, startup and the expanded sidebar. The collapsed rail uses the small application icon. See [brand and interaction specifications](../docs/ux-upgrade/BRAND.md).

Run pnpm icons:generate with the installed Playwright Chromium to refresh Windows ICO frames, Web PNGs, Android launchers and the supporting platform resources. application-icon-source.png is a generated 512 px reference. When the lockup changes, regenerate its PNG on a machine with the specified Georgia font using node scripts/make-native-icons.mjs --wordmark, then inspect and update the approved wordmark digest in its tests.

The Android monochrome notification vector lives in src-tauri/icons/android/drawable/atlas_notification.xml. The generator mirrors it into the Gradle project with the adaptive and legacy resources. Run pwsh -File scripts/check-android-icon.ps1 to verify the foreground safe circle and packaged parity. Inspect native launcher, taskbar and notification rendering before release.
