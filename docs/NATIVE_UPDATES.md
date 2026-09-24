# Native signing and updates

The local native UI checks only the official stable release channel. Business
servers cannot change update origins or provide executable URLs. Web browsers
do not receive native installation permissions. No shell or general filesystem
plugin is enabled.

## Windows

The Tauri updater verifies downloaded NSIS installers against the public key
embedded in the client. The private updater key is release infrastructure, not
source code. Publish the signed installer, its .sig file and latest.json as
assets of the same non-prerelease GitHub release. latest.json uses Tauri's static
manifest format with the windows-x86_64 platform. Never publish metadata before
the referenced assets have been uploaded and verified. Versions must increase.

Updater signatures are NOT Authenticode publisher certificates. Windows may
show an unknown publisher warning until Authenticode signing is configured.
Do not self-sign and claim public trust. SignPath Foundation is a potential
open-source signing provider; acceptance requires their independent review.

## Android direct APK channel

The app downloads android.json from the same stable release. Required fields:
channel (stable), packageId (app.orivane.atlas), abi (arm64-v8a), minSdk,
version, versionCode, url, size, sha256, notes. The APK URL must belong to this
repository's release assets. HTTPS redirect destinations are restricted to
GitHub's asset hosts. The client checks length, SHA-256, package ID, increasing
versionCode and matching signing certificates before opening the system installer.
The installer independently verifies the APK. Unknown-source permission and
installation confirmation remain user-controlled; installation is not silent.

Release builds read ATLAS_ANDROID_KEYSTORE and ATLAS_ANDROID_KEY_PASSWORD from
the private build environment, with alias atlas-release. Never commit the
keystore/password, expose them in process arguments, or regenerate a key for
each release. Keep an independently protected offline backup before relying on
this identity for ongoing distribution.

Version 1.1.0 uses the new Android package ID `app.orivane.atlas`. Older
`dev.arclattice.app` installations require a manual installation and sign-in;
their in-app updater correctly rejects a different package ID. Keep the old app
until server synchronization and any local-draft exports have been verified.
Production-key builds also cannot replace a debug-key build with the same package ID.
Windows installations containing the current updater public key can verify the
new signed installer. Historical pre-rotation 1.0.0 builds need a manual reinstall.
Publish 1.1.0 as a new release without replacing 1.0.0 assets.

### Migrating from the old debug builds

The first production-key APK cannot overwrite the previously distributed
debug-key APK. Before removing the debug app, synchronize every document with
your server, export any unsynchronized local drafts, verify the exports, and
record the server origin. Only then uninstall the debug app and install the
production-key APK. Server data is not removed by uninstalling a client;
unsynchronized local drafts/settings may be removed. Never instruct users to
uninstall before verifying their backup. Later production-key releases use
in-app updates with the same key and package ID.

Old clients without an updater require one manual installation of the first
updater-enabled version. Cancelling a download or system installation must not
remove the installed application. Release metadata/installer integration and
real-device acceptance must be tested before declaring a release validated.

## 0.0.4 validation and known limits

The updater UI passed six desktop/mobile browser tests using a substituted
native bridge. Three Android JVM policy tests and the Windows release-profile
Rust test passed. The actual Windows installer signature was independently
verified, including rejection of modified/truncated installers; the APK passed
Android signature verification. Both artifacts contain the current frontend.
These checks do not replace an installed-app upgrade test: no physical Android
device or Windows installed-version-to-new-version acceptance was performed.
The full repository checks are not green: existing login fixtures and generated
file/format diagnostics remain. Android download progress is indeterminate.

For Windows builds, use the connected config and sign the resulting installer
with the Tauri signer in a private build environment. Alternatively merge
`src-tauri/tauri.windows-release.conf.json` to enable updater artifact creation.
Supply the private key through protected build infrastructure, never source code.
Run `node scripts/verify-updater-signature.mjs <installer.exe>` before publishing
the installer and its adjacent `.sig`. Authenticode, when available, must be
applied BEFORE the final updater signature and SHA-256 are produced.
