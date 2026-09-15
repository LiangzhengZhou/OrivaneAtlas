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

## AI providers

AI providers are optional. Store provider credentials in a protected secret store or environment managed by the operator. Never place them in source code, browser localStorage, ordinary application tables, release assets, or public issue reports.

## Updates

Use published release artifacts only after verifying their source, version, and integrity. Production automatic-update channels require platform-appropriate signing and protected update metadata. The debug Windows and Android packages currently published by this project are for evaluation and are not production-signed releases.

## Troubleshooting

- Run pnpm build before starting the production-shaped host.
- Confirm that ARCLATTICE_DATA is writable and is not inside the Git working tree.
- Check that the configured HTTPS origin exactly matches the client origin.
- Inspect logs without including credentials, tokens, database contents, or provider configuration.

For development and contribution checks, see [DEVELOPMENT.md](DEVELOPMENT.md).
