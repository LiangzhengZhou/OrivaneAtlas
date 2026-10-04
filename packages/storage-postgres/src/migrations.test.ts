import { describe, expect, it } from "vitest";
import { work } from "../../../tests/fixtures";
import { migrationLock } from "./database";
import { inspectSchema, migrate, migrations } from "./migrations";
import { postgresHarness } from "./testing";

const h = postgresHarness();
const latest = migrations[migrations.length - 1]!.version;
const v2 = [
  ...migrations,
  {
    version: latest + 1,
    name: "test-only-v2",
    sql: "CREATE TABLE migration_probe (id INTEGER PRIMARY KEY); UPDATE work_item SET title='upgraded';",
  },
];
const broken = [
  ...migrations,
  {
    version: latest + 1,
    name: "test-only-broken",
    sql: "CREATE TABLE migration_probe (id INTEGER PRIMARY KEY); UPDATE work_item SET title='must roll back'; SELECT * FROM deliberately_missing_table;",
  },
];
const run = (name: string, plan = migrations, backup?: () => Promise<void>) =>
  h.client(name, (client) => migrate(client, 2000, backup, plan));

describe("PostgreSQL transactional migrations", () => {
  it("upgrades v14 preserving Wiki content and backfills knowledge bindings into the runtime repository", async () => {
    const name = await h.database();
    await run(name, migrations.slice(0, 14));
    await h.query(
      name,
      "INSERT INTO arclattice.workspace VALUES ('w','W'); INSERT INTO arclattice.principal VALUES ('p','USER','P'); INSERT INTO arclattice.workspace_principal VALUES ('w','p')",
    );
    await h.query(
      name,
      "INSERT INTO arclattice.work_item (workspace_id,id,type,title,description_md,status,priority,execution_mode,version,created_by,updated_by,created_at,updated_at,lifecycle) VALUES ('w','project','PROJECT','Original','# Keep','TODO','MEDIUM','MANUAL',1,'p','p','2026-10-01','2026-10-01','PLANNED')",
    );
    const payload = JSON.stringify({
      id: "s",
      workspaceId: "w",
      kind: "SPACE",
      title: "Legacy wiki",
      spaceId: null,
      bodyMd: "# Original",
      version: 1,
    });
    await h.query(
      name,
      "INSERT INTO arclattice.library_entry VALUES ('w','s',1,$1)",
      [payload],
    );
    await h.query(
      name,
      "INSERT INTO arclattice.project_knowledge_binding VALUES ('w','binding','project','s','OWNED','PRIMARY',true,1,'p','2026-10-01')",
    );
    let gate = false;
    await run(name, migrations, async () => {
      gate = true;
    });
    expect(gate).toBe(true);
    expect(
      (await h.query(name, "SELECT payload FROM arclattice.library_entry"))
        .rows[0]?.payload,
    ).toBe(payload);
    const material = JSON.parse(
      (await h.query(name, "SELECT payload FROM arclattice.project_material"))
        .rows[0]?.payload,
    );
    expect(material).toMatchObject({
      projectId: "project",
      targetId: "s",
      kind: "SPACE",
      ownership: "OWNED",
      role: "PRIMARY",
      inheritToChildren: true,
      title: "Legacy wiki",
    });
    expect(await h.client(name, (client) => inspectSchema(client))).toBe(
      latest,
    );
  });
  it("upgrades v11 with Wiki and knowledge binding tables while preserving existing work", async () => {
    const name = await h.database();
    await run(name, migrations.slice(0, 11));
    await h.query(
      name,
      "INSERT INTO arclattice.workspace VALUES ('w','Workspace'); INSERT INTO arclattice.principal VALUES ('p','USER','Owner'); INSERT INTO arclattice.workspace_principal VALUES ('w','p')",
    );
    await h.query(
      name,
      "INSERT INTO arclattice.work_item (workspace_id,id,type,title,description_md,status,priority,execution_mode,version,created_by,updated_by,created_at,updated_at,lifecycle) VALUES ('w','project','PROJECT','Original project','# Original','TODO','MEDIUM','MANUAL',1,'p','p','2026-10-01','2026-10-01','PLANNED')",
    );
    const before = (await h.query(name, "SELECT * FROM arclattice.work_item"))
      .rows;
    let backedUp = false;
    await run(name, migrations, async () => {
      backedUp = true;
    });
    expect(backedUp).toBe(true);
    expect(
      (await h.query(name, "SELECT * FROM arclattice.work_item")).rows,
    ).toEqual(before);
    await h.query(
      name,
      "INSERT INTO arclattice.library_entry VALUES ('w','source',1,'{}'); INSERT INTO arclattice.document_wiki_link VALUES ('w','link','source',NULL,'Future','Alias',NULL,1,'2026-10-01')",
    );
    for (const [id, ownership, role, inherited] of [
      ["owned", "OWNED", "PRIMARY", true],
      ["linked", "LINKED", "REFERENCE", false],
    ] as const) {
      await h.query(
        name,
        "INSERT INTO arclattice.project_knowledge_binding VALUES ('w',$1,'project',$1,$2,$3,$4,1,'p','2026-10-01')",
        [id, ownership, role, inherited],
      );
    }
    expect(
      (
        await h.query(
          name,
          "SELECT target_document_id,target_text,alias FROM arclattice.document_wiki_link",
        )
      ).rows,
    ).toEqual([
      { target_document_id: null, target_text: "Future", alias: "Alias" },
    ]);
    expect(
      (
        await h.query(
          name,
          "SELECT ownership,role,inherit_to_children FROM arclattice.project_knowledge_binding ORDER BY id",
        )
      ).rows,
    ).toEqual([
      { ownership: "LINKED", role: "REFERENCE", inherit_to_children: false },
      { ownership: "OWNED", role: "PRIMARY", inherit_to_children: true },
    ]);
    await expect(
      h.query(
        name,
        "INSERT INTO arclattice.document_wiki_link VALUES ('w','invalid','source',NULL,'Future',NULL,NULL,0,'2026-10-01')",
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("upgrades v13 Wiki version validation without rewriting existing links", async () => {
    const name = await h.database();
    await run(name, migrations.slice(0, 13));
    await h.query(
      name,
      "INSERT INTO arclattice.library_entry VALUES ('w','source',1,'{}'); INSERT INTO arclattice.document_wiki_link VALUES ('w','link','source',NULL,'Future','Alias',NULL,1,'2026-10-01')",
    );
    const before = (
      await h.query(name, "SELECT * FROM arclattice.document_wiki_link")
    ).rows;
    await run(name, migrations, async () => {});
    expect(
      (await h.query(name, "SELECT * FROM arclattice.document_wiki_link")).rows,
    ).toEqual(before);
  });
  it("rejects missing knowledge tables despite intact migration history", async () => {
    const name = await h.database();
    await run(name);
    await h.query(name, "DROP TABLE arclattice.project_knowledge_binding");
    await expect(h.open(name)).rejects.toThrow("SCHEMA_OBJECT_MISSING");
  });
  it("v5 backfills task memberships without rewriting legacy rows", async () => {
    const name = await h.database();
    await run(name, migrations.slice(0, 4));
    await h.query(
      name,
      "INSERT INTO arclattice.workspace VALUES ('w','Workspace'); INSERT INTO arclattice.principal VALUES ('p','USER','Owner'); INSERT INTO arclattice.workspace_principal VALUES ('w','p')",
    );
    for (const [id, type, project, deleted] of [
      ["project", "PROJECT", null, null],
      ["live", "TASK", "project", null],
      ["deleted", "TASK", "project", "2026-09-17"],
    ]) {
      await h.query(
        name,
        "INSERT INTO arclattice.work_item (workspace_id,id,type,title,description_md,status,priority,execution_mode,version,created_by,updated_by,created_at,updated_at,project_id,deleted_at) VALUES ('w',$1,$2,$1,'原文','TODO','MEDIUM','MANUAL',3,'p','p','2026-09-17','2026-09-17',$3,$4)",
        [id, type, project, deleted],
      );
    }
    const before = (
      await h.query(name, "SELECT * FROM arclattice.work_item ORDER BY id")
    ).rows;
    let backedUp = false;
    await run(name, migrations, async () => {
      backedUp = true;
    });
    expect(backedUp).toBe(true);
    expect(
      (await h.query(name, "SELECT * FROM arclattice.work_item ORDER BY id"))
        .rows,
    ).toEqual(
      before.map(({ project_id: _legacy, ...row }) => ({
        ...row,
        parent_project_id: null,
        lifecycle: row.type === "PROJECT" ? "PLANNED" : null,
        category_id: null,
      })),
    );
    expect(
      (
        await h.query(
          name,
          "SELECT task_id,project_id,position FROM arclattice.task_project ORDER BY task_id",
        )
      ).rows,
    ).toEqual([
      { task_id: "deleted", project_id: "project", position: 0 },
      { task_id: "live", project_id: "project", position: 0 },
    ]);
  });
  it("upgrades genuine v1 to current schema only after the backup hook completes", async () => {
    const name = await h.database();
    await run(name, migrations.slice(0, 1));
    await expect(run(name)).rejects.toThrow("UPGRADE_BACKUP_REQUIRED");
    let gate = false;
    await run(name, migrations, async () => {
      gate = true;
    });
    expect(gate).toBe(true);
    expect(await h.client(name, (client) => inspectSchema(client))).toBe(
      latest,
    );
    expect(
      (
        await h.query(
          name,
          "SELECT column_name FROM information_schema.columns WHERE table_schema='arclattice' AND table_name='work_item'",
        )
      ).rows.map((r) => r.column_name),
    ).toEqual(
      expect.arrayContaining([
        "parent_project_id",
        "start_date",
        "due_date",
        "lifecycle",
        "category_id",
      ]),
    );
  });
  it("applies each current migration once when independent hosts start concurrently", async () => {
    const name = await h.database();
    await Promise.all([h.open(name), h.open(name)]);
    expect(
      (
        await h.query(
          name,
          "SELECT version, application, length(checksum) AS digest FROM arclattice.schema_migrations",
        )
      ).rows,
    ).toEqual(
      migrations.map((migration) => ({
        version: migration.version,
        application: "arclattice",
        digest: 64,
      })),
    );
    expect(await h.client(name, (client) => inspectSchema(client))).toBe(
      latest,
    );
  });
  it("rolls back failed initial schema creation including ownership marker", async () => {
    const name = await h.database();
    const plan = [
      {
        version: 1,
        name: "broken",
        sql: "CREATE TABLE work_item(id TEXT); SELECT * FROM deliberately_missing_table;",
      },
    ];
    await expect(run(name, plan)).rejects.toMatchObject({ code: "42P01" });
    expect(
      (
        await h.query(
          name,
          "SELECT 1 FROM pg_namespace WHERE nspname='arclattice'",
        )
      ).rows,
    ).toEqual([]);
    await h.open(name);
  });
  it("refuses unrelated databases without altering their data", async () => {
    const name = await h.database();
    await h.query(
      name,
      "CREATE TABLE public.existing_service(id INTEGER PRIMARY KEY, content TEXT); INSERT INTO public.existing_service VALUES (1,'keep me')",
    );
    await expect(h.open(name)).rejects.toThrow("UNRECOGNIZED_DATABASE");
    expect(
      (await h.query(name, "SELECT * FROM public.existing_service")).rows,
    ).toEqual([{ id: 1, content: "keep me" }]);
    expect(
      (
        await h.query(
          name,
          "SELECT 1 FROM pg_namespace WHERE nspname='arclattice'",
        )
      ).rows,
    ).toEqual([]);
  });
  it("refuses an unclaimed arclattice schema", async () => {
    const name = await h.database();
    await h.query(name, "CREATE SCHEMA arclattice");
    await expect(h.open(name)).rejects.toThrow("UNRECOGNIZED_DATABASE");
  });
  it("rejects checksum/history tampering and future versions", async () => {
    const name = await h.database();
    await (await h.open(name)).close();
    await h.query(
      name,
      "UPDATE arclattice.schema_migrations SET checksum='modified'",
    );
    await expect(h.open(name)).rejects.toThrow("MIGRATION_HISTORY_MISMATCH");
    await h.query(
      name,
      "UPDATE arclattice.schema_migrations SET version=99 WHERE version=2",
    );
    await expect(h.open(name)).rejects.toThrow("SCHEMA_TOO_NEW");
  });
  it("rejects a missing required index", async () => {
    const name = await h.database();
    await (await h.open(name)).close();
    await h.query(name, "DROP INDEX arclattice.work_edge_dependency");
    await expect(h.open(name)).rejects.toThrow("SCHEMA_OBJECT_MISSING");
  });
  it("blocks upgrades without a host backup hook or when the hook fails", async () => {
    const name = await h.database();
    const db = await h.provision(await h.open(name));
    await db.run("workspace-a", (tx) => tx.insert(work("a")));
    await expect(run(name, v2)).rejects.toThrow("UPGRADE_BACKUP_REQUIRED");
    await expect(
      run(name, v2, async () => {
        throw new Error("backup unavailable");
      }),
    ).rejects.toThrow("backup unavailable");
    expect(await h.client(name, (client) => inspectSchema(client))).toBe(
      latest,
    );
    expect((await db.run("workspace-a", (tx) => tx.get("a"))).title).toBe("a");
    expect(
      (
        await h.query(
          name,
          "SELECT to_regclass('arclattice.migration_probe') AS probe",
        )
      ).rows[0].probe,
    ).toBeNull();
  });
  it("calls the upgrade gate before DDL and commits data/history together (hook contract only)", async () => {
    const name = await h.database();
    const db = await h.provision(await h.open(name));
    await db.run("workspace-a", (tx) => tx.insert(work("a")));
    let called = 0;
    // Test double for backup completion. This is NOT a pg_dump/restore test.
    await h.client(name, (client) =>
      migrate(
        client,
        2000,
        async (info) => {
          called++;
          expect(info).toEqual({ fromVersion: latest, toVersion: latest + 1 });
          expect(
            (await h.query(name, "SELECT title FROM arclattice.work_item"))
              .rows[0].title,
          ).toBe("a");
          expect(
            (
              await h.query(
                name,
                "SELECT count(*)::int AS count FROM arclattice.schema_migrations",
              )
            ).rows[0].count,
          ).toBe(latest);
        },
        v2,
      ),
    );
    expect(called).toBe(1);
    expect(await h.client(name, (client) => inspectSchema(client, v2))).toBe(
      latest + 1,
    );
    expect(
      (await h.query(name, "SELECT title FROM arclattice.work_item")).rows[0]
        .title,
    ).toBe("upgraded");
    await expect(h.open(name)).rejects.toThrow("SCHEMA_TOO_NEW");
    await expect(db.run("workspace-a", (tx) => tx.list())).rejects.toThrow(
      "SCHEMA_CHANGED_REOPEN_REQUIRED",
    );
  });
  it("rolls back DDL/data/history after a failed upgrade (backup gate double)", async () => {
    const name = await h.database();
    const db = await h.provision(await h.open(name));
    await db.run("workspace-a", (tx) => tx.insert(work("a")));
    let ready = false;
    await expect(
      run(name, broken, async () => {
        ready = true;
      }),
    ).rejects.toMatchObject({ code: "42P01" });
    expect(ready).toBe(true);
    expect(await h.client(name, (client) => inspectSchema(client))).toBe(
      latest,
    );
    expect((await db.run("workspace-a", (tx) => tx.get("a"))).title).toBe("a");
    expect(
      (
        await h.query(
          name,
          "SELECT to_regclass('arclattice.migration_probe') AS probe",
        )
      ).rows[0].probe,
    ).toBeNull();
  });
  it("exclusive migration locks block application callbacks and time out competing startups", async () => {
    const name = await h.database();
    const db = await h.provision(await h.open(name, 100));
    let calls = 0;
    await h.client(name, async (client) => {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [migrationLock]);
      try {
        await expect(
          db.run("workspace-a", () => {
            calls++;
          }),
        ).rejects.toThrow("LOCK_TIMEOUT");
        await expect(h.open(name, 100)).rejects.toThrow("LOCK_TIMEOUT");
      } finally {
        await client.query("ROLLBACK");
      }
    });
    expect(calls).toBe(0);
    expect(await db.run("workspace-a", (tx) => tx.list())).toEqual([]);
  });
  it("invalid plans fail without claiming the database", async () => {
    const name = await h.database();
    await expect(run(name, [])).rejects.toThrow("INVALID_MIGRATION_PLAN");
    await expect(
      run(name, [{ version: 2, name: "gap", sql: "SELECT 1" }]),
    ).rejects.toThrow("INVALID_MIGRATION_PLAN");
    expect(
      (
        await h.query(
          name,
          "SELECT 1 FROM pg_namespace WHERE nspname='arclattice'",
        )
      ).rows,
    ).toEqual([]);
  });
});

it("upgrades v2.0.1 recurrence pause and occurrence payloads with explicit defaults", async () => {
  const name = await h.database();
  await run(name, migrations.slice(0, 17));
  await h.query(
    name,
    "INSERT INTO arclattice.workspace VALUES ('w','W'); INSERT INTO arclattice.principal VALUES ('p','USER','P'); INSERT INTO arclattice.workspace_principal VALUES ('w','p')",
  );
  const rule = {
    kind: "RECURRENCE",
    title: "Keep",
    descriptionMd: "# original",
    projectIds: [],
    startDate: "2026-10-01",
    timezone: "America/New_York",
    frequency: "DAILY",
    interval: 1,
  };
  for (const [id, kind, deleted, payload] of [
    ["active", "RECURRENCE", null, rule],
    ["paused", "RECURRENCE", "2026-10-02", rule],
    [
      "occurrence",
      "OCCURRENCE",
      null,
      {
        kind: "OCCURRENCE",
        definitionId: "active",
        day: "2026-10-01",
        status: "CREATED",
        taskId: null,
        recordedAt: "2026-10-01",
      },
    ],
  ])
    await h.query(
      name,
      "INSERT INTO arclattice.workflow_record VALUES ('w',$1,$2,1,'p','p','2026-10-01','2026-10-01',$3,$4)",
      [id, kind, deleted, JSON.stringify(payload)],
    );
  let backedUp = false;
  await run(name, migrations, async () => {
    backedUp = true;
  });
  expect(backedUp).toBe(true);
  const rows = (
    await h.query(
      name,
      "SELECT id,deleted_at,payload FROM arclattice.workflow_record ORDER BY id",
    )
  ).rows;
  expect(JSON.parse(rows[0].payload)).toMatchObject({
    state: "ACTIVE",
    closePolicy: "END_OF_DAY",
    closeIncomplete: true,
    descriptionMd: "# original",
  });
  expect(JSON.parse(rows[1].payload)).toMatchObject({ status: "OPEN" });
  expect(JSON.parse(rows[2].payload)).toMatchObject({
    state: "PAUSED",
    closePolicy: "END_OF_DAY",
    closeIncomplete: true,
  });
  expect(rows[2].deleted_at).toBeNull();
});

it("upgrades 2.0.2 schema19 preserving reason/outbox and adds explicit conversion activity", async () => {
  const name = await h.database();
  await run(name, migrations.slice(0, 19));
  await h.query(
    name,
    "INSERT INTO arclattice.workspace VALUES ('w','W'); INSERT INTO arclattice.principal VALUES ('p','USER','P'); INSERT INTO arclattice.workspace_principal VALUES ('w','p'); INSERT INTO arclattice.activity(workspace_id,id,principal_id,entity_id,type,occurred_at,reason) VALUES ('w','event','p','task','WORK_ITEM_UPDATED','2026-10-04','RECURRENCE_WINDOW_EXPIRED'); INSERT INTO arclattice.outbox VALUES ('w','out','event','WORK_CHANGED','2026-10-04')",
  );
  const before = (await h.query(name, "SELECT * FROM arclattice.activity"))
      .rows,
    outbox = (await h.query(name, "SELECT * FROM arclattice.outbox")).rows;
  let backupGate = false;
  await run(name, migrations, async () => {
    backupGate = true;
  });
  expect(backupGate).toBe(true);
  expect(
    (await h.query(name, "SELECT * FROM arclattice.activity")).rows,
  ).toEqual(before);
  expect((await h.query(name, "SELECT * FROM arclattice.outbox")).rows).toEqual(
    outbox,
  );
  await h.query(
    name,
    "INSERT INTO arclattice.activity(workspace_id,id,principal_id,entity_id,type,occurred_at) VALUES ('w','conversion','p','task','RECURRENCE_TASK_CONVERTED','2026-10-04')",
  );
  expect(await h.client(name, (client) => inspectSchema(client))).toBe(
    migrations.length,
  );
}, 30000);
