# ADR 0038 — Native multi-server account vault

Accepted 2026-09-18. Supersedes ADR0019's single-credential deletion on server changes.

Native adapters retain up to 20 account credentials inside the existing current-user Windows DPAPI or Android Keystore AES-GCM encrypted envelope. The envelope includes server origin, server-confirmed account identity and a non-secret reference. JavaScript receives only metadata and references; cookies never cross IPC and passwords are never stored. Legacy single-session envelopes are read and promoted after a successful session identity response. No plaintext fallback is permitted.

Switching clears active identity and invalidates in-flight native and Web replies, snapshot cursors, request receipts and CSRF. It preserves the prior encrypted credential. Native selection validates the reference, uses its stored origin, and checks GET /api/session against the stored account ID before accepting the selected identity. Login sends no existing cookie, so signing in a second account does not revoke the previously retained session. Browser shortcuts remain reauthentication shortcuts because browser HttpOnly cookies cannot form a native credential vault.

The login selector and account settings consume bootstrap contracts. App must remount the workspace through its existing logged-out boundary when choosing another account; draft storage must include origin/workspace/principal. Logout removes the selected local credential before requesting remote revocation; network failure is explicitly reported as local-only logout. Forgetting securely deletes the selected credential and clears active identity if selected, without claiming remote revocation. Expiry, revoked sessions and account mismatches require reauthentication, while temporary network errors preserve encrypted entries.

No database migration or server API change is required. Validate Windows encryption, legacy conversion, multi-origin/account isolation, switching and stale-response rejection with native/bridge tests. Android Keystore behavior and installed EXE/APK acceptance require device verification; source implementation and mocked bridge tests do not substitute for it.
