# Migration from 1.x to Orivane Atlas 2.0

This guide describes the append-only database upgrade, not deployment authorization.
Existing projects, documents, original Markdown, historical revisions and workspace
isolation are preserved. Tests cover fresh databases, upgrades, data preservation,
transaction rollback and backup restoration through actual application adapters.

## Database changes

| Backend | Migration | Purpose |
| --- | --- | --- |
| SQLite | 0021 | Wiki links and unresolved/backlink index |
| SQLite | 0022 | Project knowledge bindings, roles, primary and inheritance |
| SQLite | 0023 | Persistent aliases and document hierarchy |
| SQLite | 0024 | Agent sessions |
| PostgreSQL | 0012 | Wiki links |
| PostgreSQL | 0013 | Project knowledge bindings |
| PostgreSQL | 0014 | Positive Wiki version constraints |
| PostgreSQL | 0015 | Persistent aliases and document hierarchy |
| PostgreSQL | 0016 | Knowledge runtime repositories and valid binding backfill |
| PostgreSQL | 0017 | Agent sessions |

All earlier migrations remain in sequence. Do not edit applied SQL, manually jump
schema versions or copy a SQLite database into PostgreSQL. Parity is behavioral;
cross-backend transfer is not an automatic migration feature.

Project-owned and linked spaces become explicit bindings; inherited spaces are
resolved through project ancestry. Primary applies to an owned space. Spaces stay
top level; document parent references are within the same Space. Renames retain
previous titles as aliases under workspace collision rules. Deleted documents do
not resolve; deleting a parent with live children is rejected.

Wiki links/indexes are derived from documents and can be rebuilt through the
authorized application endpoint. Startup rebuild/re-resolution does not rewrite
document bodies or revisions. AgentRun execution records remain alongside the new
actor-owned conversations; historical runs are not fabricated into past sessions.

## Fresh installation

1. Install dependencies with `pnpm install --frozen-lockfile` and build the source.
2. Configure a new, empty database path outside the checkout using [Self-hosting](SELF_HOSTING.md).
3. Start the Host: SQLite migrations run in order to schema24. PostgreSQL
   application adapters migrate to schema17 when opened through their migration path.
4. Confirm schema validation before accepting traffic. The shipped account/HTTP
   Host uses SQLite; PostgreSQL knowledge adapters are not a separate account server.

## Upgrade an existing database

1. Record the current binary/configuration and schema. Stop writes to this project's
   instance and take a verified backup before applying migrations. Follow local
   operational procedures; do not modify unrelated services.
2. Preserve the provider vault/master key, authentication and signing configuration
   separately. A business-database backup does not contain all of these secrets.
3. Validate restoration into a new database path/data directory. Keep the original
   backup immutable and the old deployment recoverable.
4. Start the 2.0 application against the upgrade target; apply only pending migrations
   in order under the migration lock, using the required verified-backup hook.
5. Confirm schema24 (SQLite) / schema17 (PostgreSQL), data counts, representative
   Markdown and revision readback, space bindings, Wiki links and workspace isolation.
6. Resume this instance only after validation. Do not run old and new writers together.

## Rollback and evidence

There is no supported in-place schema downgrade. Stop the upgraded instance,
restore its pre-upgrade backup into a separate target, verify it, then pair that
target with the matching old application/configuration. Never overwrite the only
copy of user data or open an upgraded schema with an old binary.

Shared SQLite/PostgreSQL application tests cover bindings/scope/retrieval,
aliases, hierarchy, Wiki/backlinks/rebuild, revisions, sessions, round-trip and
workspace isolation. PostgreSQL tests additionally restore actual offline physical
snapshots in independent directories, including schema14 after upgrade to17.
See [Storage](STORAGE.md) and [runtime audit](UNIFIED_UPGRADE.md).
