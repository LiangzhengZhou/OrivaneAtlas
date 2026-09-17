# ADR 0019 — Native session retention and Windows tray

Accepted 2026-09-16. Supersedes ADR0018's memory-only native cookie policy.

Persist only the current origin and opaque session cookie, never passwords or
CSRF tokens. Windows uses current-user DPAPI; Android uses a non-exportable
Android Keystore AES-GCM key with ciphertext in noBackupFilesDir. No credential
is exposed to JavaScript, localStorage, a normal database, or device backups.
Startup restores only the matching HTTPS origin, then validates /api/session
with the server before entering the workspace. Network failure does not erase
the retained session. Unauthorized responses, logout, and origin changes erase
it. Corrupt/unavailable secure storage fails closed; there is no plaintext fallback.

Server expiry (originally 8 hours; superseded by ADR0020), restart, password changes and account revocation
still invalidate sessions. This is restart retention, not a refresh-token scheme
or a promise of indefinite login. Longer-lived revocable server sessions require
a separate server change; do not silently extend the existing cookie lifetime.

Windows close hides the main window only if the tray was successfully created.
Tray offers bilingual Open and Exit; left click restores/focuses the window.
Exit terminates the process but is not logout. No autorun registration, Android
foreground service, or background sync guarantee is added. Windows controls
whether the icon is in the overflow panel or the visible notification area.
