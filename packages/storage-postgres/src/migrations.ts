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
  {
    version: 3,
    name: "instance-settings",
    sql: readFileSync(
      new URL("./migrations/0003-instance-settings.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 4,
    name: "task-activation",
    sql: readFileSync(
      new URL("./migrations/0004-task-activation.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 5,
    name: "task-memberships",
    sql: readFileSync(
      new URL("./migrations/0005-task-memberships.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 6,
    name: "categories",
    sql: readFileSync(
      new URL("./migrations/0006-categories.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 7,
    name: "workflows",
    sql: readFileSync(
      new URL("./migrations/0007-workflows.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 8,
    name: "category-presentation",
    sql: readFileSync(
      new URL("./migrations/0008-category-presentation.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 9,
    name: "calendar-edge-history",
    sql: readFileSync(
      new URL("./migrations/0009-calendar-edge-history.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 10,
    name: "user-navigation",
    sql: readFileSync(
      new URL("./migrations/0010-navigation.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 11,
    name: "project-domain",
    sql: readFileSync(
      new URL("./migrations/0011-project-domain.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 12,
    name: "wiki-links",
    sql: readFileSync(
      new URL("./migrations/0012-wiki-links.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 13,
    name: "project-knowledge-binding",
    sql: readFileSync(
      new URL(
        "./migrations/0013-project-knowledge-binding.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  },
  {
    version: 14,
    name: "wiki-version-validation",
    sql: readFileSync(
      new URL("./migrations/0014-wiki-version-validation.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 15,
    name: "document-metadata",
    sql: readFileSync(
      new URL("./migrations/0015-document-metadata.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 16,
    name: "knowledge-runtime",
    sql: readFileSync(
      new URL("./migrations/0016-knowledge-runtime.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 17,
    name: "agent-session",
    sql: readFileSync(
      new URL("./migrations/0017-agent-session.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 18,
    name: "permanent-purge",
    sql: readFileSync(
      new URL("./migrations/0018-permanent-purge.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 19,
    name: "recurrence-lifecycle",
    sql: readFileSync(
      new URL("./migrations/0019-recurrence-lifecycle.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 20,
    name: "task-recurrence-conversion",
    sql: readFileSync(
      new URL(
        "./migrations/0020-task-recurrence-conversion.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  },
  {
    version: 21,
    name: "recurrence-skipped",
    sql: readFileSync(
      new URL("./migrations/0021-recurrence-skipped.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 22,
    name: "organization",
    sql: readFileSync(
      new URL("./migrations/0022-organization.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 23,
    name: "reminder",
    sql: readFileSync(
      new URL("./migrations/0023-reminder.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 24,
    name: "workspace-changes",
    sql: readFileSync(
      new URL("./migrations/0024-workspace-changes.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 25,
    name: "agent-session-conversations",
    sql: readFileSync(
      new URL(
        "./migrations/0025-agent-session-conversations.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  },
  {
    version: 26,
    name: "agent-session-pages",
    sql: readFileSync(
      new URL("./migrations/0026-agent-session-pages.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 27,
    name: "wiki-index-state",
    sql: readFileSync(
      new URL("./migrations/0027-wiki-index-state.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 28,
    name: "manual-order",
    sql: readFileSync(
      new URL("./migrations/0028-manual-order.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 29,
    name: "library-files",
    sql: readFileSync(
      new URL("./migrations/0029-library-files.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 30,
    name: "file-binary-completion",
    sql: readFileSync(
      new URL("./migrations/0030-file-binary-completion.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 31,
    name: "request-receipts",
    sql: readFileSync(
      new URL("./migrations/0031-request-receipts.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 32,
    name: "connected-runtime",
    sql: readFileSync(
      new URL("./migrations/0032-connected-runtime.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 33,
    name: "file-extraction",
    sql: readFileSync(
      new URL("./migrations/0033-file-extraction.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 34,
    name: "file-extraction-search",
    sql: readFileSync(
      new URL("./migrations/0034-file-extraction-search.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 35,
    name: "owned-workspaces",
    sql: readFileSync(
      new URL("./migrations/0035-owned-workspaces.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 36,
    name: "entity-memos",
    sql: readFileSync(
      new URL("./migrations/0036-entity-memos.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 37,
    name: "credential-grants",
    sql: readFileSync(
      new URL("./migrations/0037-credential-grants.sql", import.meta.url),
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
      "SELECT n.nspname,p.proname,p.prosrc,p.prosecdef,p.pronargs,p.prorettype::regtype::text AS return_type FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'",
    )
  ).rows;
  if (
    schemas.some((row) => !["public", "arclattice"].includes(row.nspname)) ||
    objects.some((row) => row.nspname !== "arclattice") ||
    routines.some(
      (routine) =>
        routine.nspname !== "arclattice" ||
        ![
          "record_workspace_change",
          "mark_wiki_index_dirty",
          "capture_entity_memo_change",
        ].includes(routine.proname) ||
        routine.prosecdef ||
        routine.pronargs !== 0 ||
        routine.return_type !== "trigger" ||
        routine.prosrc !==
          plan
            .find(
              (step) =>
                step.name ===
                (routine.proname === "record_workspace_change"
                  ? "workspace-changes"
                  : routine.proname === "capture_entity_memo_change"
                    ? "entity-memos"
                    : "wiki-index-state"),
            )
            ?.sql.split("AS $$")[1]
            ?.split("$$;")[0],
    )
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
      [
        rows.length >= 11 ? "parent_project_id" : "project_id",
        "start_date",
        "due_date",
      ].some((name) => !columns.some((row) => row.column_name === name))
    )
      throw new PostgresStorageError("SCHEMA_OBJECT_MISSING");
  }
  const knowledgeTables = [
    ...(rows.length >= 36
      ? ["entity_memo", "entity_memo_activity", "entity_memo_outbox"]
      : []),
    ...(rows.length >= 32
      ? ["agent_run", "connected_activity", "connected_outbox"]
      : []),
    ...(rows.length >= 29
      ? [
          "library_file",
          "file_activity",
          "file_outbox",
          "file_blob_descriptor",
          "file_blob_chunk",
        ]
      : []),
    ...(rows.length >= 24 ? ["workspace_sync_state", "workspace_change"] : []),
    ...(rows.length >= 12 ? ["library_entry", "document_wiki_link"] : []),
    ...(rows.length >= 13 ? ["project_knowledge_binding"] : []),
    ...(rows.length >= 15 ? ["document_alias", "document_hierarchy"] : []),
    ...(rows.length >= 16
      ? [
          "library_revision",
          "library_asset",
          "project_material",
          "knowledge_activity",
          "knowledge_outbox",
          "project_material_activity",
          "project_material_outbox",
          "library_asset_upload",
          "library_asset_chunk",
        ]
      : []),
    ...(rows.length >= 17 ? ["agent_session"] : []),
    ...(rows.length >= 18
      ? [
          "knowledge_link",
          "organization",
          "notebook",
          "notebook_revision",
          "notebook_activity",
          "notebook_outbox",
        ]
      : []),
    ...(rows.length >= 22
      ? ["organization_activity", "organization_outbox"]
      : []),
    ...(rows.length >= 23
      ? ["reminder", "reminder_activity", "reminder_outbox"]
      : []),
    ...(rows.length >= 26
      ? ["agent_session_metadata", "agent_session_message"]
      : []),
    ...(rows.length >= 27 ? ["wiki_index_state"] : []),
    ...(rows.length >= 28 ? ["manual_order_scope"] : []),
  ];
  if (rows.length >= 24) {
    if (routines.length !== (rows.length >= 36 ? 3 : rows.length >= 27 ? 2 : 1))
      throw new PostgresStorageError("SCHEMA_OBJECT_MISSING");
    const expected = [
      rows.length >= 29
        ? (plan.find((step) => step.name === "library-files")?.sql ?? "")
        : "",
      plan.find((step) => step.name === "workspace-changes")?.sql ?? "",
      rows.length >= 28
        ? (plan.find((step) => step.name === "manual-order")?.sql ?? "")
        : "",
    ].join("\n");
    const triggers = (
      await client.query(
        "SELECT t.tgname,t.tgenabled,p.proname FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='arclattice' AND NOT t.tgisinternal",
      )
    ).rows;
    if (
      [...expected.matchAll(/CREATE TRIGGER (\w+)/g)].some(
        (match) =>
          !triggers.some(
            (trigger) =>
              trigger.tgname === match[1] &&
              trigger.tgenabled === "O" &&
              trigger.proname === "record_workspace_change",
          ),
      )
    )
      throw new PostgresStorageError("SCHEMA_OBJECT_MISSING");
  }
  if (rows.length >= 27) {
    const triggers = (
      await client.query(
        "SELECT t.tgname,t.tgenabled,p.proname,c.relname FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='arclattice' AND t.tgname IN ('wiki_index_dirty','wiki_alias_dirty') AND NOT t.tgisinternal",
      )
    ).rows;
    if (
      [
        ["wiki_index_dirty", "library_entry"],
        ["wiki_alias_dirty", "document_alias"],
      ].some(
        ([name, table]) =>
          !triggers.some(
            (trigger) =>
              trigger.tgname === name &&
              trigger.relname === table &&
              trigger.tgenabled === "O" &&
              trigger.proname === "mark_wiki_index_dirty",
          ),
      )
    )
      throw new PostgresStorageError("SCHEMA_OBJECT_MISSING");
  }
  if (rows.length >= 36) {
    const trigger = (
      await client.query(
        "SELECT t.tgenabled,p.proname,c.relname FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='arclattice' AND t.tgname='sync_entity_memo' AND NOT t.tgisinternal",
      )
    ).rows;
    if (
      trigger.length !== 1 ||
      trigger[0]?.tgenabled !== "O" ||
      trigger[0]?.proname !== "capture_entity_memo_change" ||
      trigger[0]?.relname !== "entity_memo"
    )
      throw new PostgresStorageError("SCHEMA_OBJECT_MISSING");
  }
  if (
    knowledgeTables.some(
      (name) =>
        !objects.some((row) => row.relname === name && row.relkind === "r"),
    )
  )
    throw new PostgresStorageError("SCHEMA_OBJECT_MISSING");
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
