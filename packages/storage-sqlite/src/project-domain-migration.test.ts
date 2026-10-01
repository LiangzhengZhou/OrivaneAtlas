import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { restoreDatabase } from "./index";
import { migrate, migrations } from "./migrations";
import { projectStore } from "./project-materials";
import { sqliteHarness } from "./testing";

const harness = sqliteHarness();
test("v22 maps legacy owned and linked spaces without rewriting materials and retains a restorable backup", async () => {
  const file = harness.file();
  const database = new DatabaseSync(file);
  try {
    await migrate(database, file, 2000, migrations.slice(0, 21));
    database.exec(
      "INSERT INTO workspace VALUES ('w','Workspace'); INSERT INTO principal VALUES ('p','USER','Owner'); INSERT INTO workspace_principal VALUES ('w','p')",
    );
    database.exec(
      "INSERT INTO work_item (workspace_id,id,type,title,description_md,status,priority,execution_mode,version,created_by,updated_by,created_at,updated_at,lifecycle) VALUES ('w','project','PROJECT','Project','# Original','TODO','MEDIUM','MANUAL',1,'p','p','2026','2026','PLANNED')",
    );
    const insert = database.prepare(
      "INSERT INTO project_material VALUES ('w',?,'project',3,?,NULL)",
    );
    for (const ownership of ["OWNED", "LINKED"])
      insert.run(
        ownership,
        JSON.stringify({
          kind: "SPACE",
          targetId: ownership + "-space",
          ownership,
          deletedAt: null,
          updatedBy: "p",
          updatedAt: "2026",
        }),
      );
    const before = database
      .prepare("SELECT * FROM project_material ORDER BY id")
      .all();
    const result = await migrate(database, file, 2000);
    expect(
      database.prepare("SELECT * FROM project_material ORDER BY id").all(),
    ).toEqual(before);
    expect(
      database
        .prepare(
          "SELECT ownership,role,inherit_to_children,version FROM project_knowledge_binding ORDER BY id",
        )
        .all(),
    ).toEqual([
      expect.objectContaining({
        ownership: "LINKED",
        role: "REFERENCE",
        inherit_to_children: 0,
        version: 3,
      }),
      expect.objectContaining({
        ownership: "OWNED",
        role: "PRIMARY",
        inherit_to_children: 0,
        version: 3,
      }),
    ]);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    const store = projectStore(
      database,
      { workspaceId: "w", principalId: "p" },
      () => {},
    );
    expect(await store.get("OWNED")).toMatchObject({
      role: "PRIMARY",
      inheritToChildren: false,
    });
    expect(await store.list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "REFERENCE", ownership: "LINKED" }),
      ]),
    );
    const restoredFile = harness.file();
    await restoreDatabase(result.backupPath!, restoredFile);
    const restored = new DatabaseSync(restoredFile);
    try {
      expect(restored.prepare("PRAGMA user_version").get()?.user_version).toBe(
        21,
      );
      expect(
        restored.prepare("SELECT * FROM project_material ORDER BY id").all(),
      ).toEqual(before);
    } finally {
      restored.close();
    }
  } finally {
    database.close();
  }
});
test("v20 converts structural owners and lifecycle while retaining an independently restorable v19 backup", async () => {
  const file = harness.file();
  const database = new DatabaseSync(file);
  try {
    await migrate(database, file, 2000, migrations.slice(0, 19));
    database.exec(
      "INSERT INTO workspace VALUES ('w','Workspace'); INSERT INTO principal VALUES ('p','USER','Owner'); INSERT INTO workspace_principal VALUES ('w','p')",
    );
    const insert = database.prepare(
      "INSERT INTO work_item (workspace_id,id,type,title,description_md,status,priority,execution_mode,version,created_by,updated_by,created_at,updated_at,project_id) VALUES ('w',?,?,?,'# Original','DONE','MEDIUM','MANUAL',1,'p','p','2026','2026',?)",
    );
    insert.run("first", "PROJECT", "First", null);
    insert.run("second", "PROJECT", "Second", "first");
    insert.run("task", "TASK", "Shared", "first");
    database.exec("INSERT INTO task_project VALUES ('w','task','second',0)");
    const result = await migrate(database, file, 2000, migrations.slice(0, 20));
    expect(result.version).toBe(20);
    expect(
      database
        .prepare(
          "SELECT parent_project_id,lifecycle,description_md FROM work_item WHERE id='second'",
        )
        .get(),
    ).toMatchObject({
      parent_project_id: "first",
      lifecycle: "COMPLETED",
      description_md: "# Original",
    });
    expect(
      database
        .prepare("SELECT parent_project_id FROM work_item WHERE id='task'")
        .get()?.parent_project_id,
    ).toBeNull();
    expect(
      database
        .prepare("SELECT project_id FROM task_project ORDER BY project_id")
        .all()
        .map((row) => row.project_id),
    ).toEqual(["first", "second"]);
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_schema WHERE name='project_category_member'",
        )
        .get(),
    ).toBeUndefined();
    const restoredFile = harness.file();
    await restoreDatabase(result.backupPath!, restoredFile);
    const restored = new DatabaseSync(restoredFile);
    try {
      expect(restored.prepare("PRAGMA user_version").get()?.user_version).toBe(
        19,
      );
      expect(
        restored
          .prepare("SELECT project_id FROM work_item WHERE id='task'")
          .get()?.project_id,
      ).toBe("first");
      expect(
        restored.prepare("PRAGMA integrity_check").get()?.integrity_check,
      ).toBe("ok");
    } finally {
      restored.close();
    }
  } finally {
    database.close();
  }
});
