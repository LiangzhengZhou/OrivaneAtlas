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
    ).toEqual(before);
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
    ).toEqual(expect.arrayContaining(["project_id", "start_date", "due_date"]));
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
