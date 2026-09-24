# Orivane Atlas application identity

The next build uses `app.orivane.atlas` in Tauri, Android namespace/applicationId,
Kotlin sources and native plugin registration. Internal Cargo and npm package
names are unchanged.

Android treats this as a separate application. Install the new package, connect
to the same server and sign in again. Server records are not copied or deleted.
Device credentials belonging to the old package are not imported. Keep the old
installation until the new one has been verified. Android update metadata for
the new channel must specify `app.orivane.atlas`; old package metadata is rejected
by the existing package and signing-certificate checks.

The embedded Windows updater public key is unchanged. Validate an installer and
its detached signature with `node scripts/verify-updater-signature.mjs PATH`.
The installed 1.0.0 population may include builds predating the historical key
rotation: those installations need a manual reinstall. Verification against the
current public key does not prove that every historically distributed binary
contains that key. Never replace already published release assets.

CI builds unsigned validation installers and debug APKs separately from release
publication, and verifies the published 1.0.0 detached signature. Validation
artifacts are not production signed releases. Real-device acceptance and the
next version's signed installer remain release gates.

Session 075 verified the installed local 1.0.0 executable embeds the current
public key (key ID `add50d83696f686a`), matching main and the signing public file.
The existing private key signed the newly built local validation NSIS artifact;
independent verification accepted it and rejected tampered/truncated copies.
Both native binaries embed the final Web entry asset fingerprints. This proves
the local installed-key/signing-key chain, not a network update or compatibility
for every historical 1.0.0 build. Unqualified automatic upgrades for pre-rotation
installations remain a release blocker requiring an explicit migration channel.
