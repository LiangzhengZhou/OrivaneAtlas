# ADR 0021 — Configurable session policy

Accepted 2026-09-17 for the local product-improvement branch; not deployed.

The adopted product brief supersedes ADR0020's fixed seven-day policy with ONE_DAY, SEVEN_DAYS, THIRTY_DAYS and PERMANENT. Each login reads the current persisted instance setting after password verification and captures its own deadline. Updates do not extend or shorten existing sessions. HostOptions.sessionLifetimePolicy is only an explicit test/operator override; production without an override uses the persisted setting.

Policy updates require an administrator cookie session, CSRF and an Idempotency-Key. Authorization is rechecked inside the same SQLite transaction as the setting and durable receipt. Replaying an old successful update returns its original result but must not undo a newer setting. Enum validation uses exact values, not prototype membership. No schema change is needed for this corrective slice.

PERMANENT remains PARTIAL: the current process-local session map and annually renewed browser cookie do not survive a Host restart. Completing the product requirement needs durable hashed session credentials, device/all-session revocation and restart/backup tests. This ADR does not certify permanent sessions as complete or authorize deployment. No credentials belong in ordinary localStorage or audit documents.
