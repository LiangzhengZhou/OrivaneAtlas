import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  beginImmediate,
  StorageError,
  snapshotToNewFile,
  validateIntegrity,
} from "./database";

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}
export const applicationId = 0x4152434c;
export const migrations: readonly Migration[] = [
  // Applied migrations are immutable; append only.
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
    name: "private-workbench",
    sql: readFileSync(
      new URL("./migrations/0002-workbench.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 3,
    name: "project-calendar",
    sql: readFileSync(
      new URL("./migrations/0003-planning.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 4,
    name: "connected-workbench",
    sql: readFileSync(
      new URL("./migrations/0004-connected.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 5,
    name: "accounts-library",
    sql: readFileSync(
      new URL("./migrations/0005-accounts-library.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 6,
    name: "orivane-workspace",
    sql: readFileSync(
      new URL("./migrations/0006-orivane.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 7,
    name: "workbench-organization",
    sql: readFileSync(
      new URL("./migrations/0007-organization.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 8,
    name: "workspace-assets",
    sql: readFileSync(
      new URL("./migrations/0008-workspace-assets.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 9,
    name: "image-chunks",
    sql: readFileSync(
      new URL("./migrations/0009-image-chunks.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 10,
    name: "instance-settings",
    sql: readFileSync(
      new URL("./migrations/0010-instance-settings.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 11,
    name: "task-activation",
    sql: readFileSync(
      new URL("./migrations/0011-task-activation.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 12,
    name: "login-sessions",
    sql: readFileSync(
      new URL("./migrations/0012-login-sessions.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 13,
    name: "task-memberships",
    sql: readFileSync(
      new URL("./migrations/0013-task-memberships.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 14,
    name: "categories",
    sql: readFileSync(
      new URL("./migrations/0014-categories.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 15,
    name: "workflows",
    sql: readFileSync(
      new URL("./migrations/0015-workflows.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 16,
    name: "category-presentation",
    sql: readFileSync(
      new URL("./migrations/0016-category-presentation.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 17,
    name: "project-materials",
    sql: readFileSync(
      new URL("./migrations/0017-project-materials.sql", import.meta.url),
      "utf8",
    ),
  },
];
export const currentSchemaVersion = migrations[migrations.length - 1]!.version;
function checksum(sql: string): string {
  return createHash("sha256")
    .update(sql.replaceAll("\r\n", "\n"))
    .digest("hex");
}

/** Check history before modifying even an unrecognized database. */
export function inspectSchema(
  db: DatabaseSync,
  plan: readonly Migration[] = migrations,
): number {
  if (!plan.length || plan.some((step, i) => step.version !== i + 1))
    throw new StorageError("INVALID_MIGRATION_PLAN");
  const version = Number(db.prepare("PRAGMA user_version").get()?.user_version);
  const identity = Number(
    db.prepare("PRAGMA application_id").get()?.application_id,
  );
  const objects = db
    .prepare("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'")
    .all();
  if (identity === 0 && version === 0 && objects.length === 0) return 0;
  if (identity !== applicationId)
    throw new StorageError("UNRECOGNIZED_DATABASE");
  if (version > plan.length) throw new StorageError("SCHEMA_TOO_NEW");
  if (version < 1 || !objects.some((row) => row.name === "schema_migrations"))
    throw new StorageError("MIGRATION_HISTORY_MISMATCH");
  const history = db
    .prepare(
      "SELECT version, name, checksum FROM schema_migrations ORDER BY version",
    )
    .all();
  if (
    history.length !== version ||
    history.some((row, i) => {
      const step = plan[i];
      return (
        !step ||
        row.version !== step.version ||
        row.name !== step.name ||
        row.checksum !== checksum(step.sql)
      );
    })
  )
    throw new StorageError("MIGRATION_HISTORY_MISMATCH");
  const required = [
    "workspace",
    "principal",
    "workspace_principal",
    "work_item",
    "work_edge",
    "activity",
    "outbox",
    "work_item_active",
    "work_edge_dependency",
    "work_edge_target",
  ];
  if (required.some((name) => !objects.some((row) => row.name === name)))
    throw new StorageError("SCHEMA_OBJECT_MISSING");
  if (
    version >= 2 &&
    plan[1]?.name === "private-workbench" &&
    [
      "request_receipt",
      "notebook",
      "notebook_revision",
      "notebook_activity",
      "notebook_outbox",
      "notebook_journal_day",
    ].some((name) => !objects.some((row) => row.name === name))
  )
    throw new StorageError("SCHEMA_OBJECT_MISSING");
  if (version >= 3 && plan[2]?.name === "project-calendar") {
    const columns = db.prepare("PRAGMA table_info(work_item)").all();
    if (
      !objects.some((row) => row.name === "work_item_project") ||
      ["project_id", "start_date", "due_date"].some(
        (name) => !columns.some((row) => row.name === name),
      )
    )
      throw new StorageError("SCHEMA_OBJECT_MISSING");
  }
  if (
    version >= 4 &&
    plan[3]?.name === "connected-workbench" &&
    [
      "knowledge_link",
      "agent_run",
      "connected_activity",
      "connected_outbox",
      "audit_record",
    ].some((name) => !objects.some((row) => row.name === name))
  )
    throw new StorageError("SCHEMA_OBJECT_MISSING");
  if (
    version >= 5 &&
    [
      "account",
      "api_credential",
      "library_entry",
      "library_revision",
      "library_asset",
    ].some((name) => !objects.some((row) => row.name === name))
  )
    throw new StorageError("SCHEMA_OBJECT_MISSING");
  if (
    version >= 9 &&
    ["library_asset_upload", "library_asset_chunk"].some(
      (name) => !objects.some((row) => row.name === name),
    )
  )
    throw new StorageError("SCHEMA_OBJECT_MISSING");
  if (version >= 11) {
    const columns = db.prepare("PRAGMA table_info(work_item)").all();
    if (
      !["activation_state", "activation_policy"].every((name) =>
        columns.some((row) => row.name === name),
      )
    )
      throw new StorageError("SCHEMA_OBJECT_MISSING");
  }
  if (version >= 12 && !objects.some((row) => row.name === "login_session"))
    throw new StorageError("SCHEMA_OBJECT_MISSING");
  if (
    version >= 17 &&
    [
      "project_material",
      "project_material_activity",
      "project_material_outbox",
    ].some((name) => !objects.some((row) => row.name === name))
  )
    throw new StorageError("SCHEMA_OBJECT_MISSING");
  return version;
}

/** Internal migration runner; custom plans are used only by migration tests. */
export async function migrate(
  db: DatabaseSync,
  filename: string,
  timeoutMs: number,
  plan: readonly Migration[] = migrations,
): Promise<{ version: number; backupPath: string | null }> {
  inspectSchema(db, plan);
  await beginImmediate(db, timeoutMs);
  let backupPath: string | null = null;
  try {
    const version = inspectSchema(db, plan);
    validateIntegrity(db);
    if (version > 0 && version < plan.length) {
      const reader = new DatabaseSync(filename, { readOnly: true });
      try {
        backupPath = await snapshotToNewFile(
          reader,
          filename + ".pre-v" + (version + 1) + "-" + randomUUID() + ".sqlite",
        );
      } finally {
        reader.close();
      }
    }
    if (version === 0) {
      db.exec(
        "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT",
      );
      db.exec("PRAGMA application_id = " + applicationId);
    }
    for (const step of plan.slice(version)) {
      db.exec(step.sql);
      db.prepare("INSERT INTO schema_migrations VALUES (?, ?, ?, ?)").run(
        step.version,
        step.name,
        checksum(step.sql),
        new Date().toISOString(),
      );
      db.exec("PRAGMA user_version = " + step.version);
    }
    validateIntegrity(db);
    inspectSchema(db, plan);
    db.exec("COMMIT");
    return { version: plan.length, backupPath };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
