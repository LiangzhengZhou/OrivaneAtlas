# PostgreSQL storage adapter

PostgreSQL is an optional storage adapter for deployments that need a server database. It follows the same application and domain boundaries as SQLite and does not create databases, roles, or shared infrastructure automatically.

## Boundaries

- Supply connection configuration only from a trusted host secret store.
- Never commit passwords, certificates, connection strings, or database dumps.
- Use a database dedicated to Orivane Atlas rather than taking over shared tables.
- Keep migrations append-only and validate migration history and checksums.
- Do not expose SQL, pool clients, or identity declarations to UI callers.

## Transactions and backups

Workspace reads and writes are transactionally coordinated. Activity and Outbox records are stored with the business mutation, but reliable delivery workers are outside this adapter.

Before a production schema upgrade, create and verify a real PostgreSQL backup and test restoring it into a new database. A test stub is not a production backup. Restoration and failover procedures remain deployment responsibilities.

## Validation

~~~powershell
pnpm exec vitest run packages/storage-postgres
pnpm check
~~~

Tests must use an isolated temporary PostgreSQL instance and must not connect to a user or production database.
