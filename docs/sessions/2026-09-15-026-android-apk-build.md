# Android APK build completion

Date: 2026-09-15

- Built a fresh arm64 debug APK after bypassing the stale Cargo proxy and Windows symlink restriction.
- Gradle assembleArm64Debug -x rustBuildArm64Debug completed successfully.
- APK: src-tauri/gen/android/app/build/outputs/apk/arm64/debug/app-arm64-debug.apk
- Size: 134790311 bytes
- SHA256: A96A5A347E62177E4D797695D4111462E2A383BFF4912AC5D5E6E7498CD46C90
- apksigner v2 verification passed.
- No credentials, server addresses, private operations documents, or local toolchains were added to Git.
