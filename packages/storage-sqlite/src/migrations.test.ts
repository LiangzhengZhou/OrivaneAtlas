import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { snapshotToNewFile } from "./database";
import { restoreDatabase, SqliteUnitOfWork } from "./index";
import {
  applicationId,
  inspectSchema,
  migrate,
  migrations,
} from "./migrations";
import { context, service, sqliteHarness } from "./testing";

const harness = sqliteHarness();
describe("SQLite migrations and recovery", () => {
  it("upgrades v7 images without changing bytes and independently restores v7 and v8", async () => {
    const path = harness.file();
    const raw = new DatabaseSync(path);
    const image = "private-image-bytes";
    let backup = "";
    const after = join(dirname(path), "images-v8.sqlite");
    try {
      raw.exec("PRAGMA foreign_keys=ON");
      await migrate(raw, path, 100, migrations.slice(0, 7));
      raw.exec(
        "INSERT INTO workspace VALUES ('w','Owner'); INSERT INTO library_entry VALUES ('w','s',1,'{}')",
      );
      raw
        .prepare(
          "INSERT INTO library_asset VALUES ('w','old','s','image.png','image/png',?)",
        )
        .run(image);
      const before = raw.prepare("SELECT * FROM library_asset").all();
      backup = (await migrate(raw, path, 100, migrations.slice(0, 8)))
        .backupPath!;
      expect(inspectSchema(raw)).toBe(8);
      expect(raw.prepare("SELECT * FROM library_asset").all()).toEqual(before);
      raw
        .prepare(
          "INSERT INTO library_asset VALUES ('w','new',NULL,'image.png','image/png',?)",
        )
        .run(image);
      expect(() =>
        raw.exec(
          "INSERT INTO library_asset VALUES ('other','bad',NULL,'x','image/png','x')",
        ),
      ).toThrow();
      expect(() =>
        raw.exec(
          "INSERT INTO library_asset VALUES ('w','bad','missing','x','image/png','x')",
        ),
      ).toThrow();
      expect(raw.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      await snapshotToNewFile(raw, after);
    } finally {
      raw.close();
    }
    for (const [source, version, count] of [
      [backup, 7, 1],
      [after, 8, 2],
    ] as const) {
      const restoredPath = join(
        dirname(path),
        `images-restored-${version}.sqlite`,
      );
      await restoreDatabase(source, restoredPath);
      const restored = new DatabaseSync(restoredPath, { readOnly: true });
      try {
        expect(inspectSchema(restored, migrations.slice(0, version))).toBe(
          version,
        );
        const rows = restored.prepare("SELECT base64 FROM library_asset").all();
        expect(rows).toHaveLength(count);
        expect(rows.every((row) => row.base64 === image)).toBe(true);
        expect(
          restored.prepare("PRAGMA integrity_check").get()?.integrity_check,
        ).toBe("ok");
        expect(restored.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      } finally {
        restored.close();
      }
    }
  });
  it("upgrades v6 preserving notebook bytes and history and restores v6 independently", async () => {
    const path = harness.file();
    const raw = new DatabaseSync(path);
    let backup = "";
    const payload = JSON.stringify({
      bodyMd: "中文\r\n$E=mc^2$",
      day: "2026-09-14",
    });
    try {
      await migrate(raw, path, 100, migrations.slice(0, 6));
      raw.exec("INSERT INTO workspace VALUES ('w','Original')");
      raw
        .prepare(
          "INSERT INTO notebook VALUES ('w','n',1,'JOURNAL','2026-09-14',NULL,?)",
        )
        .run(payload);
      raw
        .prepare("INSERT INTO notebook_revision VALUES ('w','n',1,?)")
        .run(payload);
      const history = raw.prepare("SELECT * FROM schema_migrations").all();
      const result = await migrate(raw, path, 100);
      backup = result.backupPath!;
      expect(result.version).toBe(9);
      expect(raw.prepare("SELECT payload FROM notebook").get()?.payload).toBe(
        payload,
      );
      expect(
        raw.prepare("SELECT payload FROM notebook_revision").get()?.payload,
      ).toBe(payload);
      expect(
        raw.prepare("SELECT * FROM schema_migrations WHERE version<=6").all(),
      ).toEqual(history);
      for (const table of [
        "organization",
        "organization_activity",
        "organization_outbox",
      ])
        expect(raw.prepare("SELECT count(*) n FROM " + table).get()?.n).toBe(0);
    } finally {
      raw.close();
    }
    const target = join(dirname(path), "restored-v6.sqlite");
    await restoreDatabase(backup, target);
    const restored = new DatabaseSync(target, { readOnly: true });
    try {
      expect(inspectSchema(restored, migrations.slice(0, 6))).toBe(6);
      expect(
        restored.prepare("SELECT payload FROM notebook").get()?.payload,
      ).toBe(payload);
      expect(
        restored.prepare("SELECT payload FROM notebook_revision").get()
          ?.payload,
      ).toBe(payload);
    } finally {
      restored.close();
    }
  });
  it("upgrades v5 preserving token dates and revocations, with an independent v5 restore", async () => {
    const path = harness.file(),
      raw = new DatabaseSync(path);
    let backup = "";
    let before: unknown;
    try {
      await migrate(raw, path, 100, migrations.slice(0, 5));
      raw.exec(
        "INSERT INTO workspace VALUES ('w','Original'); INSERT INTO principal VALUES ('p','USER','Owner'); INSERT INTO workspace_principal VALUES ('w','p'); INSERT INTO account VALUES ('a','owner','verifier','w','p','ADMIN','ACTIVE',1,'2026-09-01'); INSERT INTO api_credential VALUES ('t','a','p','old','read-write','hash','2026-10-01','2026-09-10')",
      );
      before = raw.prepare("SELECT * FROM api_credential").all();
      const history = raw.prepare("SELECT * FROM schema_migrations").all();
      const result = await migrate(raw, path, 100);
      backup = result.backupPath!;
      expect(result.version).toBe(9);
      expect(raw.prepare("SELECT * FROM api_credential").all()).toEqual(before);
      expect(
        raw.prepare("SELECT * FROM schema_migrations WHERE version<=5").all(),
      ).toEqual(history);
      raw.exec(
        "INSERT INTO api_credential VALUES ('forever','a','p','new','write','hash2',NULL,NULL)",
      );
      expect(
        raw
          .prepare("SELECT expires_at FROM api_credential WHERE id='forever'")
          .get()?.expires_at,
      ).toBeNull();
    } finally {
      raw.close();
    }
    const target = join(dirname(path), "restored-v5.sqlite");
    await restoreDatabase(backup, target);
    const restored = new DatabaseSync(target, { readOnly: true });
    try {
      expect(inspectSchema(restored, migrations.slice(0, 5))).toBe(5);
      expect(restored.prepare("SELECT * FROM api_credential").all()).toEqual(
        before,
      );
    } finally {
      restored.close();
    }
  });
  it("upgrades genuine v4 to v5 without changing old content/history and restores v4 independently", async () => {
    const path = harness.file(),
      raw = new DatabaseSync(path);
    let backupPath = "";
    try {
      await migrate(raw, path, 100, migrations.slice(0, 4));
      raw.exec("INSERT INTO workspace VALUES ('v4','Keep v4')");
      const history = raw.prepare("SELECT * FROM schema_migrations").all();
      const result = await migrate(raw, path, 100, migrations.slice(0, 5));
      backupPath = result.backupPath!;
      expect(result.version).toBe(5);
      expect(
        raw.prepare("SELECT * FROM schema_migrations WHERE version<=4").all(),
      ).toEqual(history);
      expect(raw.prepare("SELECT name FROM workspace").get()?.name).toBe(
        "Keep v4",
      );
      expect(raw.prepare("SELECT count(*) n FROM account").get()?.n).toBe(0);
    } finally {
      raw.close();
    }
    const target = join(dirname(path), "v4-restore.sqlite");
    await restoreDatabase(backupPath, target);
    const restored = new DatabaseSync(target, { readOnly: true });
    try {
      expect(inspectSchema(restored, migrations.slice(0, 4))).toBe(4);
    } finally {
      restored.close();
    }
  });
  it("upgrades genuine v3 to v4 with an independently restorable v3 backup", async () => {
    const path = harness.file(),
      raw = new DatabaseSync(path);
    let backupPath = "";
    try {
      await migrate(raw, path, 100, migrations.slice(0, 3));
      raw.exec("INSERT INTO workspace VALUES ('old','Keep v3')");
      const oldHistory = raw.prepare("SELECT * FROM schema_migrations").all();
      const result = await migrate(raw, path, 100, migrations.slice(0, 4));
      backupPath = result.backupPath!;
      expect(result.version).toBe(4);
      expect(
        raw.prepare("SELECT * FROM schema_migrations WHERE version<=3").all(),
      ).toEqual(oldHistory);
      for (const table of [
        "knowledge_link",
        "agent_run",
        "connected_activity",
        "connected_outbox",
        "audit_record",
      ])
        expect(raw.prepare("SELECT COUNT(*) AS n FROM " + table).get()?.n).toBe(
          0,
        );
    } finally {
      raw.close();
    }
    const restored = join(dirname(path), "restored-v3.sqlite");
    await restoreDatabase(backupPath, restored);
    const copy = new DatabaseSync(restored, { readOnly: true });
    try {
      expect(inspectSchema(copy, migrations.slice(0, 3))).toBe(3);
      expect(copy.prepare("SELECT name FROM workspace").get()?.name).toBe(
        "Keep v3",
      );
    } finally {
      copy.close();
    }
  });
  it("upgrades v2 notebook data to v3 planning without changing existing content", async () => {
    const path = harness.file();
    const raw = new DatabaseSync(path);
    try {
      await migrate(raw, path, 100, migrations.slice(0, 2));
      raw.exec("INSERT INTO workspace VALUES ('old','Keep me')");
      const result = await migrate(raw, path, 100, migrations.slice(0, 3));
      expect(result.version).toBe(3);
      expect(result.backupPath).toContain(".pre-v3-");
      expect(raw.prepare("SELECT name FROM workspace").get()?.name).toBe(
        "Keep me",
      );
      expect(
        raw
          .prepare("PRAGMA table_info(work_item)")
          .all()
          .map((r) => r.name),
      ).toEqual(
        expect.arrayContaining(["project_id", "start_date", "due_date"]),
      );
      const before = new DatabaseSync(result.backupPath!, { readOnly: true });
      try {
        expect(inspectSchema(before, migrations.slice(0, 2))).toBe(2);
      } finally {
        before.close();
      }
    } finally {
      raw.close();
    }
  });
  it("upgrades a genuine v1 schema to v2 and preserves its pre-upgrade backup", async () => {
    const path = harness.file();
    const raw = new DatabaseSync(path);
    try {
      await migrate(raw, path, 100, migrations.slice(0, 1));
      raw.exec("INSERT INTO workspace VALUES ('old','Old workspace')");
      const result = await migrate(raw, path, 100, migrations.slice(0, 2));
      expect(result.version).toBe(2);
      expect(result.backupPath).toContain(".pre-v2-");
      expect(raw.prepare("SELECT name FROM workspace").get()?.name).toBe(
        "Old workspace",
      );
      const before = new DatabaseSync(result.backupPath ?? "", {
        readOnly: true,
      });
      try {
        expect(inspectSchema(before, migrations.slice(0, 1))).toBe(1);
        expect(
          before
            .prepare("SELECT name FROM sqlite_schema WHERE name='notebook'")
            .all(),
        ).toHaveLength(0);
      } finally {
        before.close();
      }
    } finally {
      raw.close();
    }
  });
  it("rolls back a failed initial migration to an empty unclaimed database", async () => {
    const path = harness.file();
    const raw = new DatabaseSync(path);
    try {
      await expect(
        migrate(raw, path, 100, [
          {
            version: 1,
            name: "broken-init",
            sql: "CREATE TABLE partial(id TEXT); INSERT INTO missing VALUES(1);",
          },
        ]),
      ).rejects.toThrow();
      expect(raw.prepare("PRAGMA application_id").get()?.application_id).toBe(
        0,
      );
      expect(raw.prepare("PRAGMA user_version").get()?.user_version).toBe(0);
      expect(raw.prepare("SELECT name FROM sqlite_schema").all()).toEqual([]);
      expect(await migrate(raw, path, 100)).toEqual({
        version: migrations.length,
        backupPath: null,
      });
    } finally {
      raw.close();
    }
  });

  it("refuses incomplete schemas even when migration history is unchanged", async () => {
    const db = await harness.create();
    await db.close();
    const raw = new DatabaseSync(db.filename);
    try {
      raw.exec("DROP INDEX work_edge_dependency");
    } finally {
      raw.close();
    }
    await expect(SqliteUnitOfWork.open(db.filename)).rejects.toThrow(
      "SCHEMA_OBJECT_MISSING",
    );
  });
  it("migrates an empty file exactly once and records identity, version and checksum", async () => {
    const db = await harness.create();
    await db.close();
    const raw = new DatabaseSync(db.filename);
    try {
      const history = raw.prepare("SELECT * FROM schema_migrations").all();
      expect(history).toHaveLength(migrations.length);
      expect(history[0]?.checksum).toMatch(/^[a-f0-9]{64}$/);
      expect(raw.prepare("PRAGMA application_id").get()?.application_id).toBe(
        applicationId,
      );
      expect(await migrate(raw, db.filename, 100)).toEqual({
        version: migrations.length,
        backupPath: null,
      });
      expect(raw.prepare("SELECT * FROM schema_migrations").all()).toEqual(
        history,
      );
      expect(raw.prepare("PRAGMA journal_mode").get()?.journal_mode).toBe(
        "wal",
      );
    } finally {
      raw.close();
    }
  });

  it("refuses an unrelated database without changing its schema or bytes", async () => {
    const path = harness.file();
    const raw = new DatabaseSync(path);
    raw.exec(
      "CREATE TABLE unrelated (value TEXT); INSERT INTO unrelated VALUES ('keep me')",
    );
    raw.close();
    const bytes = readFileSync(path);
    await expect(SqliteUnitOfWork.open(path)).rejects.toThrow(
      "UNRECOGNIZED_DATABASE",
    );
    expect(readFileSync(path)).toEqual(bytes);
  });

  it("refuses future versions and changed migration history", async () => {
    const db = await harness.create();
    await db.close();
    const raw = new DatabaseSync(db.filename);
    try {
      raw.exec("PRAGMA user_version=99");
    } finally {
      raw.close();
    }
    await expect(SqliteUnitOfWork.open(db.filename)).rejects.toThrow(
      "SCHEMA_TOO_NEW",
    );
    const repair = new DatabaseSync(db.filename);
    try {
      repair.exec(
        "PRAGMA user_version=4; UPDATE schema_migrations SET checksum='tampered'",
      );
    } finally {
      repair.close();
    }
    await expect(SqliteUnitOfWork.open(db.filename)).rejects.toThrow(
      "MIGRATION_HISTORY_MISMATCH",
    );
  });

  it("backs up before an upgrade and restores the exact pre-upgrade data", async () => {
    const db = await harness.create();
    await service(db).create(context, {
      title: "before migration",
      descriptionMd: "# 永久原文\n- [ ] text",
    });
    const expected = await service(db).snapshot(context);
    await db.close();
    const raw = new DatabaseSync(db.filename);
    const plan = [
      ...migrations,
      {
        version: migrations.length + 1,
        name: "test-only-upgrade",
        sql: "CREATE TABLE upgrade_marker(id TEXT); UPDATE work_item SET title='after migration', version=version+1;",
      },
    ];
    let backupPath: string;
    try {
      const result = await migrate(raw, db.filename, 100, plan);
      expect(result.version).toBe(migrations.length + 1);
      expect(result.backupPath).not.toBeNull();
      backupPath = result.backupPath ?? "";
      expect(inspectSchema(raw, plan)).toBe(migrations.length + 1);
      expect(raw.prepare("SELECT title FROM work_item").get()?.title).toBe(
        "after migration",
      );
    } finally {
      raw.close();
    }
    const restoredPath = join(dirname(db.filename), "restored.sqlite");
    await restoreDatabase(backupPath, restoredPath);
    const restored = await harness.open(restoredPath);
    expect(await service(restored).snapshot(context)).toEqual(expected);
    expect(
      (await restored.inspectEvents(context.workspaceId)).outbox,
    ).toHaveLength(1);
  });

  it("rolls back failed migration DDL, data and history while retaining a valid backup", async () => {
    const db = await harness.create();
    await service(db).create(context, { title: "untouched" });
    await db.close();
    const raw = new DatabaseSync(db.filename);
    try {
      await expect(
        migrate(raw, db.filename, 100, [
          ...migrations,
          {
            version: migrations.length + 1,
            name: "test-only-failure",
            sql: "CREATE TABLE partial(id TEXT); UPDATE work_item SET title='wrong'; INSERT INTO nonexistent VALUES (1);",
          },
        ]),
      ).rejects.toThrow();
      expect(inspectSchema(raw)).toBe(migrations.length);
      expect(raw.prepare("SELECT title FROM work_item").get()?.title).toBe(
        "untouched",
      );
      expect(
        raw
          .prepare("SELECT name FROM sqlite_schema WHERE name='partial'")
          .all(),
      ).toEqual([]);
    } finally {
      raw.close();
    }
    const backups = readdirSync(dirname(db.filename)).filter((file) =>
      file.includes(".pre-v" + (migrations.length + 1) + "-"),
    );
    expect(backups).toHaveLength(1);
    const snapshot = await harness.open(
      join(dirname(db.filename), backups[0] ?? ""),
    );
    expect((await service(snapshot).snapshot(context)).items[0]?.title).toBe(
      "untouched",
    );
  });

  it("does not run a migration when creating the required backup fails", async () => {
    const db = await harness.create();
    await db.close();
    const raw = new DatabaseSync(db.filename);
    try {
      // Source cannot be opened: the migration must stop before executing v2 SQL.
      await expect(
        migrate(
          raw,
          join(dirname(db.filename), "missing", "source.sqlite"),
          100,
          [
            ...migrations,
            {
              version: migrations.length + 1,
              name: "test-only-backup-failure",
              sql: "CREATE TABLE should_not_exist(id TEXT);",
            },
          ],
        ),
      ).rejects.toThrow();
      expect(inspectSchema(raw)).toBe(migrations.length);
      expect(
        raw
          .prepare(
            "SELECT name FROM sqlite_schema WHERE name='should_not_exist'",
          )
          .all(),
      ).toEqual([]);
    } finally {
      raw.close();
    }
  });

  it("backs up live WAL commits, restores to a new file and never overwrites files", async () => {
    const db = await harness.create();
    await service(db).create(context, {
      title: "in WAL",
      descriptionMd: "\r\n中文 ' ? 😀",
    });
    expect(existsSync(db.filename + "-wal")).toBe(true);
    const target = join(dirname(db.filename), "snapshot.sqlite");
    await db.backup(target);
    expect(existsSync(target + "-wal")).toBe(false);
    expect(existsSync(target + "-shm")).toBe(false);
    const snapshotBytes = readFileSync(target);
    await expect(db.backup(target)).rejects.toThrow(/EEXIST/);
    await expect(db.backup(db.filename)).rejects.toThrow(/EEXIST/);
    await expect(restoreDatabase(target, db.filename)).rejects.toThrow(
      /EEXIST/,
    );
    expect(readFileSync(target)).toEqual(snapshotBytes);
    await service(db).create(context, { title: "after snapshot" });
    const restoredPath = join(dirname(db.filename), "restored.sqlite");
    await restoreDatabase(target, restoredPath);
    const restored = await harness.open(restoredPath);
    const snapshot = await service(restored).snapshot(context);
    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.items[0]?.descriptionMd).toBe("\r\n中文 ' ? 😀");
    expect(
      (await restored.inspectEvents(context.workspaceId)).activity,
    ).toHaveLength(1);
  });

  it("refuses restoring backups with foreign key violations before creating a target", async () => {
    const db = await harness.create();
    await service(db).create(context, { title: "a" });
    await db.close();
    const raw = new DatabaseSync(db.filename, {
      enableForeignKeyConstraints: false,
    });
    try {
      raw.exec("DELETE FROM workspace_principal");
    } finally {
      raw.close();
    }
    const target = join(dirname(db.filename), "invalid-restored.sqlite");
    await expect(restoreDatabase(db.filename, target)).rejects.toThrow(
      "FOREIGN_KEY_CHECK_FAILED",
    );
    expect(existsSync(target)).toBe(false);
  });
});
