# ADR 0023 — Account transition boundary

Accepted 2026-09-17, local implementation.

Expose explicit account logout/switch and current/selected/all session revocation in the account screen. Switching signs out before returning to login; saved accounts are validated, bounded metadata shortcuts, not stored credentials or an assertion of authenticated identity. Reauthentication is required. Native multi-credential secure storage is deferred; retain ADR0019's single secure session.

Reset cached snapshot/cursor, abort requests, and advance an identity generation when leaving or replacing an authenticated context. Queued sync jobs capture their originating generation, rejecting after any account boundary even if they have not started. UI unmount discards in-memory account state only after the existing unsaved-document confirmation. Failed remote logout must not be reported as remote revocation; retain the error and allow retry rather than silently claiming success.

Native exception: ADR0019 clears the secure local credential before logout networking, including offline failure. In that case clear the UI identity too and return to login with an explicit bilingual warning that server revocation is unconfirmed; advise reauthentication and revoking other sessions when online. Browser failures retain the session and allow retry. A successful password change also clears the revoked runtime identity.

Session management uses the Application contract and existing scoped APIs; never display token hashes. Current/all revocation returns to login and clears local runtime state. Saved metadata can be forgotten without deleting server accounts or content. No schema change, multi-account password storage, deployment or publication.
