# Self-hosting Orivane Atlas

Orivane Atlas is a server-backed workspace. The server stores authoritative workspace data; web, Windows, and Android clients connect to that server. Clients may keep local drafts, but this is not a complete offline replica or conflict-free sync engine.

## Requirements

- Node.js 24 or a compatible current LTS release
- pnpm 11
- A writable data directory outside the repository
- HTTPS for any deployment reachable by other devices or users

Keep authentication material, provider credentials, encryption keys, databases, and signing keys outside the repository and outside public logs.

## Local run

~~~powershell
pnpm install --frozen-lockfile
pnpm build
$env:ARCLATTICE_DATA = Join-Path $env:LOCALAPPDATA 'OrivaneAtlas-local'
$env:ARCLATTICE_WEB_ROOT = Join-Path (Get-Location) 'apps/web/dist'
node packages/host/dist/main.js
~~~

The host normally listens on http://127.0.0.1:4317. Set ARCLATTICE_PORT when that port is already in use. The first start creates an access credential in the data directory; protect it and do not print it in logs.

## Network deployment

Put a properly configured HTTPS reverse proxy in front of the host and use an exact public origin. Do not expose the development HTTP listener directly to the Internet. Use a dedicated service account and a private data directory with restrictive permissions. Back up the database and uploaded files according to your own retention policy, and test restoration before relying on the backups.

Native clients should be configured with the server origin. A client connection does not make the server optional: the server remains responsible for authentication, authorization, persistence, and workspace isolation.

## Markdown images

In a note, journal or knowledge document, open **Import, images and revisions** to choose a Markdown file or upload an image. You can also paste one image into the editor with Ctrl/Command+V. Ordinary text paste is unchanged.

Images use your own authenticated server storage; no third-party image host is required. Supported formats are PNG, JPEG and WebP. The updated client uses sequential 256 KiB chunks with no product per-image size limit or workspace image quota. Available disk space, SQLite capacity, network conditions and browser image-decoding resources still apply. Failed uploads leave the text intact; check your session, connection and available storage, then retry. Markdown text import limits are unchanged.

Images are private to their workspace, not public sharing URLs. Markdown exports contain server references, not bundled images. Uploaded assets remain stored after removing their Markdown reference; automated orphan cleanup is not implemented. Consistent database backups include the image bytes.

Unlimited-size image uploads require both the updated web/native client and server, including SQLite migration 9. Older clients still use the bounded legacy upload endpoint. The migration runner takes a pre-upgrade snapshot; keep it and verify restoration to a separate file before deployment. To roll back, restore that pre-upgrade database with matching old code; do not open a v9 database using an older migration plan.

Unfinished uploads are inaccessible and expire after 24 hours without activity; the next successful chunk write in that workspace cleans them up. Completed assets are retained. For large databases, operators must use a consistent server-side SQLite snapshot and transfer it securely: both the existing browser backup download and encrypted HTTP offsite-backup helper are limited to 64 MiB. Do not copy a live database file without its journal as a backup. Provision disk space for the database, journal and backup copies, and monitor free space.

## AI providers

AI providers are optional. Store provider credentials in a protected secret store or environment managed by the operator. Never place them in source code, browser localStorage, ordinary application tables, release assets, or public issue reports.

## Updates

Use published release artifacts only after verifying their source, version, and integrity. From 0.0.4, native clients use the official GitHub update channel: Windows verifies updater signatures and Android verifies the APK's release signing identity before asking the system installer for confirmation. Windows Authenticode publisher trust is not yet configured. Older debug APKs require a backed-up migration to the new release key; see [Native signing and updates](NATIVE_UPDATES.md). Read each release's validation limitations before deployment.

## Troubleshooting

### Durable sessions (0.0.7)

The updated SQLite Host applies migration 12 and stores hashed, revocable login sessions across Host restarts. Policies are one, seven or thirty days, or PERMANENT (new-source default); changes affect new logins only. PERMANENT has no server expiry but browsers receive a renewable one-year cookie. Clearing browser data, losing native secure storage or letting the browser cookie expire still requires login. Old process-local sessions require one new login after upgrade. Existing native cookie storage is compatible; no client rebuild is required for server persistence.

Logout revokes the current session. Password and account status changes revoke account sessions transactionally. Cookie-authenticated `/api/account/sessions` lists only the caller's sessions; `/api/account/sessions/revoke` revokes a selected ID or all sessions, with CSRF and an Idempotency-Key. Revoking the caller's session makes subsequent retries unauthorized. The account UI supports logout, switching by logging in again, and session revocation. Recent-account shortcuts retain metadata only, not passwords; secure storage of multiple accounts' credentials is not implemented. Each account supports 32 active sessions. PostgreSQL Host account/session authentication is not implemented.

Keep the automatic pre-v12 snapshot and independently validate recovery before deployment. Rollback requires the pre-upgrade snapshot and matching older code. A restored v12 snapshot can contain sessions revoked after it was taken: while the application is stopped, invalidate restored sessions with `DELETE FROM login_session;` before serving traffic. This requires everyone to log in again. Run this only against the selected restored database, not an unrelated or live database. Backups remain sensitive and must be protected.

Version 0.0.7 includes SQLite migrations through version 15 (PostgreSQL repository schema 7). Back up the database and separate encrypted provider vault before upgrading. Validate restoration into a new file. Downgrades require matching pre-upgrade data and code; older versions must not open the upgraded database or ignore its AI policies. See [Workflows](WORKFLOWS.md) and [AI permissions and limitations](AI_GATEWAY.md).

Older release behavior below applies to 0.0.5/0.0.6 clients and earlier Hosts. Version 0.0.7 includes the transport, tray and protected-session storage improvements described below, plus the account controls and durable server sessions described above.

- Native client 0.0.5 uses a restricted native HTTPS transport for authentication, private images and backups. The 0.0.4 bundled UI incorrectly used cross-origin browser requests and could fail before checking a password. Update the client; do not disable server origin checks, CSRF protection or TLS verification.
- Enter only the HTTPS origin (scheme, host and optional port), without an application path. The certificate must be valid for that hostname or IP. From 0.0.6, native clients retain the current server session in OS-protected storage (Windows current-user DPAPI; Android Keystore encryption, excluded from backup), never the password. On restart, the server validates it before opening the workspace. Logout, server changes, and unauthorized responses clear it. With the ADR0020 Host update deployed, newly issued sessions expire seven days after login (not extended by activity); older Hosts still use eight hours. Sessions are lost on server restart; this is not indefinite login or a refresh-token system. Native logout/account-switch UI improvements are pending; avoid shared-device use until those controls are available.
- On Windows 0.0.6, closing the window leaves the app in the notification area. Click its icon or choose Open to restore it; choose Exit to terminate it without logging out. Windows controls whether the icon is visible or inside the overflow panel. This does not enable startup with Windows or an Android background service. If tray creation fails, closing the window retains ordinary exit behavior.
- Invalid address syntax is rejected locally. Login waits at most eight seconds for a response (native connection setup has a three-second limit), then allows a manual retry. Incorrect credentials, forbidden access, rate limits, network/TLS failures and invalid server responses have distinct messages. Password attempts are never automatically retried.
- These client fixes do not require a server schema migration or relaxed CORS configuration. The web interface should be opened at the server's own origin.
- Run pnpm build before starting the production-shaped host.
- Confirm that ARCLATTICE_DATA is writable and is not inside the Git working tree.
- Check that the configured HTTPS origin exactly matches the client origin.
- Inspect logs without including credentials, tokens, database contents, or provider configuration.

For development and contribution checks, see [DEVELOPMENT.md](DEVELOPMENT.md).
