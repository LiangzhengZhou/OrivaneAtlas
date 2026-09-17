import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { snapshotToNewFile } from "./database";
import { restoreDatabase } from "./index";
import { inspectSchema, migrate, migrations } from "./migrations";
import { sqliteHarness } from "./testing";

const h = sqliteHarness();
test("v13 backfills live and deleted tasks without rewriting content; backups restore independently", async () => {
  const file = h.file();
  const raw = new DatabaseSync(file);
  const snapshot = h.file();
  let backup = "";
  let original: unknown;
  try {
    await migrate(raw, file, 2000, migrations.slice(0, 12));
    raw.exec(
      "INSERT INTO workspace VALUES ('w','Workspace'); INSERT INTO principal VALUES ('p','USER','Owner'); INSERT INTO workspace_principal VALUES ('w','p')",
    );
    const insert = raw.prepare(
      "INSERT INTO work_item (workspace_id,id,type,title,description_md,status,priority,execution_mode,version,created_by,updated_by,created_at,updated_at,project_id,deleted_at) VALUES ('w',?,?,?,'原文\r\n# Markdown','TODO','MEDIUM','MANUAL',3,'p','p','2026-09-17','2026-09-17',?,?)",
    );
    insert.run("project", "PROJECT", "Project", null, null);
    insert.run("live", "TASK", "Live", "project", null);
    insert.run("deleted", "TASK", "Deleted", "project", "2026-09-17");
    original = raw.prepare("SELECT * FROM work_item ORDER BY id").all();
    backup = (await migrate(raw, file, 2000, migrations.slice(0, 13)))
      .backupPath!;
    expect(raw.prepare("SELECT * FROM work_item ORDER BY id").all()).toEqual(
      original,
    );
    expect(
      raw
        .prepare(
          "SELECT task_id,project_id,position FROM task_project ORDER BY task_id",
        )
        .all(),
    ).toEqual([
      { task_id: "deleted", project_id: "project", position: 0 },
      { task_id: "live", project_id: "project", position: 0 },
    ]);
    await snapshotToNewFile(raw, snapshot);
  } finally {
    raw.close();
  }
  for (const [source, version] of [
    [backup, 12],
    [snapshot, 13],
  ] as const) {
    const restored = h.file();
    await restoreDatabase(source, restored);
    const db = new DatabaseSync(restored);
    try {
      expect(inspectSchema(db, migrations.slice(0, version))).toBe(version);
      expect(db.prepare("PRAGMA integrity_check").get()?.integrity_check).toBe(
        "ok",
      );
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(db.prepare("SELECT * FROM work_item ORDER BY id").all()).toEqual(
        original,
      );
    } finally {
      db.close();
    }
  }
});
