import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { PoolClient } from "pg";
import {
  begin,
  migrationLock,
  PostgresStorageError,
  translateError,
} from "./database";

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}
export interface UpgradeInfo {
  readonly fromVersion: number;
  readonly toVersion: number;
}
/** Host must create AND verify a real backup; resolving asserts it is ready.
 * Called under exclusive migration lock. Never call the adapter from this hook.
 */
export type BeforeUpgrade = (info: UpgradeInfo) => Promise<void>;
export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: "initial-work",
    sql: readFileSync(
      new URL("./migrations/0001-work.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 2,
    name: "project-calendar",
    sql: readFileSync(
      new URL("./migrations/0002-planning.sql", import.meta.url),
      "utf8",
    ),
  },
];
function checksum(sql: string) {
  return createHash("sha256")
    .update(sql.replaceAll("\r\n", "\n"))
    .digest("hex");
}
export async function inspectSchema(
  client: PoolClient,
  plan = migrations,
): Promise<number> {
  if (!plan.length || plan.some((step, i) => step.version !== i + 1))
    throw new PostgresStorageError("INVALID_MIGRATION_PLAN");
  const schemas = (
    await client.query(
      "SELECT nspname FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'",
    )
  ).rows;
  const objects = (
    await client.query(
      "SELECT n.nspname, c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'",
    )
  ).rows;
  const routines = (
    await client.query(
      "SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' LIMIT 1",
    )
  ).rowCount;
  if (
    schemas.some((row) => !["public", "arclattice"].includes(row.nspname)) ||
    objects.some((row) => row.nspname !== "arclattice") ||
    routines
  )
    throw new PostgresStorageError("UNRECOGNIZED_DATABASE");
  const claimed = schemas.some((row) => row.nspname === "arclattice");
  if (!claimed && objects.length === 0) return 0;
  if (
    !objects.some(
      (row) => row.relname === "schema_migrations" && row.relkind === "r",
    )
  )
    throw new PostgresStorageError("UNRECOGNIZED_DATABASE");
  const rows = (
    await client.query(
      "SELECT version, name, checksum, application FROM arclattice.schema_migrations ORDER BY version",
    )
  ).rows;
  if (rows.some((row) => row.version > plan.length))
    throw new PostgresStorageError("SCHEMA_TOO_NEW");
  if (
    !rows.length ||
    rows.some((row, i) => {
      const step = plan[i];
      return (
        !step ||
        row.version !== step.version ||
        row.name !== step.name ||
        row.checksum !== checksum(step.sql) ||
        row.application !== "arclattice"
      );
    })
  )
    throw new PostgresStorageError("MIGRATION_HISTORY_MISMATCH");
  for (const [kind, names] of [
    [
      "r",
      [
        "workspace",
        "principal",
        "workspace_principal",
        "work_item",
        "work_edge",
        "activity",
        "outbox",
      ],
    ],
    ["i", ["work_item_active", "work_edge_dependency", "work_edge_target"]],
  ] as const) {
    if (
      names.some(
        (name) =>
          !objects.some((row) => row.relname === name && row.relkind === kind),
      )
    )
      throw new PostgresStorageError("SCHEMA_OBJECT_MISSING");
  }
  if (rows.length >= 2 && plan[1]?.name === "project-calendar") {
    const columns = (
      await client.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='arclattice' AND table_name='work_item'",
      )
    ).rows;
    if (
      !objects.some(
        (row) => row.relname === "work_item_project" && row.relkind === "i",
      ) ||
      ["project_id", "start_date", "due_date"].some(
        (name) => !columns.some((row) => row.column_name === name),
      )
    )
      throw new PostgresStorageError("SCHEMA_OBJECT_MISSING");
  }
  return rows.length;
}

/** Internal runner: custom plans are for tests, not the public open API. */
export async function migrate(
  client: PoolClient,
  timeoutMs: number,
  beforeUpgrade?: BeforeUpgrade,
  plan = migrations,
) {
  try {
    await begin(client, timeoutMs);
    await client.query("SELECT pg_advisory_xact_lock($1)", [migrationLock]);
    const version = await inspectSchema(client, plan);
    if (version > 0 && version < plan.length) {
      if (!beforeUpgrade)
        throw new PostgresStorageError("UPGRADE_BACKUP_REQUIRED");
      await beforeUpgrade({ fromVersion: version, toVersion: plan.length });
    }
    if (!version) {
      await client.query(
        "CREATE SCHEMA arclattice; REVOKE ALL ON SCHEMA arclattice FROM PUBLIC",
      );
      await client.query(
        "CREATE TABLE arclattice.schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, application TEXT NOT NULL CHECK(application='arclattice'), applied_at TEXT NOT NULL)",
      );
    }
    await client.query("SET LOCAL search_path = arclattice, pg_catalog");
    for (const step of plan.slice(version)) {
      await client.query(step.sql);
      await client.query(
        "INSERT INTO arclattice.schema_migrations VALUES ($1, $2, $3, 'arclattice', $4)",
        [step.version, step.name, checksum(step.sql), new Date().toISOString()],
      );
    }
    await inspectSchema(client, plan);
    await client.query("COMMIT");
  } catch (error) {
    // The owner of this startup client destroys it after any migration error.
    await client.query("ROLLBACK").catch(() => undefined);
    throw translateError(error);
  }
}
