# Storage model

Orivane Atlas uses a server-side storage adapter behind application ports. SQLite is the default self-hosting adapter; PostgreSQL support is optional.

## Principles

- Every business record is scoped to a workspace.
- Mutations identify a principal and use optimistic version checks where appropriate.
- Core records use soft deletion so recovery and audit context are preserved.
- Markdown is stored as original text, including line endings and Unicode content.
- Business changes and Activity/Outbox records are committed in one transaction.
- In-memory events are not a reliable delivery system.

## SQLite lifecycle

The host opens an explicit database path outside the repository, applies append-only migrations, validates the schema, and manages close and backup operations. Application services perform authorization and domain validation; callers do not receive raw SQL or transaction callbacks.

Backups are written to a new path, validated with SQLite integrity and foreign-key checks, and never overwrite an existing file. Restore into a new database path before considering an active-database switch.

SQLite files are not automatically encrypted. Backups may contain private workspace content and must be protected by the operator. Authentication material, provider credentials, and encryption keys stay outside ordinary business tables.

## Validation

~~~powershell
pnpm install --frozen-lockfile
pnpm exec vitest run packages/storage-sqlite
pnpm check
~~~

Tests use isolated temporary directories and must not touch user databases. Schema changes require a migration plus backup and restore validation.
