# ADR 0022 — Durable revocable login sessions

Accepted 2026-09-17, local implementation only. Supersedes ADR0021's process-local session limitation.

Host authentication uses the existing Application AccountStore port and SQLite transaction boundary. Store only SHA-256 digests of random 256-bit session tokens, account ID/version, issuance time and nullable absolute expiry. Never persist the bearer cookie or password. CSRF is domain-separated SHA-256 of the raw session token, reconstructed only for the authenticated request; it cannot recover the cookie token. PERMANENT is NULL expiry, not an infinite JWT or fabricated distant deadline; browsers receive a renewable one-year cookie. Cookie flags and origin checks remain unchanged.

Resolve account status/version and expiry on every request, and resolve again inside write authorization before receipts. Login rechecks the password-verified account version inside the insert transaction, so concurrent password changes cannot mint a stale session. Logout removes the current session; password/status changes remove account sessions in the same transaction. Account-scoped listing and current/selected/all session revocation use non-secret random session IDs, never token digests. Revocation does not depend on an in-process cache.

Limit active sessions to 32 per account (not 32 for the entire installation). Issuance removes expired/stale sessions before checking this limit and atomically replaces the presented current session. Old process-local sessions cannot be migrated and require one new login. Native storage format is unchanged.

Append SQLite migration v12. PostgreSQL currently has no AccountStore, account schema or Host authentication implementation; do not add a misleading orphan session table and claim parity. PostgreSQL authentication remains explicitly unsupported/deferred until its account adapter exists; business work storage is unaffected. No applied migrations change. Verify v11 upgrade, backup integrity, restoration and restart. Restoring a database snapshot can restore sessions revoked after that snapshot: operator recovery procedure must invalidate all restored login_session rows before serving traffic. Backups are sensitive even though session tokens are hashed.

This does not implement native multi-account selection, per-device labels, refresh-token rotation, MFA, HTTPS changes, deployment or releases.
