import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { restoreDatabase } from "./index";
import { inspectSchema, migrate, migrations } from "./migrations";
import { sqliteHarness } from "./testing";

const h = sqliteHarness();
const folderId = "00000000-0000-4000-8000-000000000001";
const instant = "2026-10-26T00:00:00.000Z";
const payload = (kind: "WORK" | "NOTE" | "FOLDER", id: string) =>
  JSON.stringify({
    kind,
    id,
    workspaceId: "workspace-a",
    version: 1,
    archived: false,
    folder: "",
    updatedAt: instant,
    updatedBy: "human",
  });

test("v42 organization rows survive the FOLDER kind migration and keep change triggers", async () => {
  const path = h.file();
  const raw = new DatabaseSync(path);
  let backup = "";
  try {
    await migrate(raw, path, 2000, migrations.slice(0, 42));
    raw.exec("INSERT INTO workspace VALUES('workspace-a','A')");
    const insert = raw.prepare("INSERT INTO organization VALUES(?,?,?,?,?)");
    insert.run("workspace-a", "WORK", "task", 1, payload("WORK", "task"));
    insert.run("workspace-a", "NOTE", "note", 1, payload("NOTE", "note"));
    const before = raw
      .prepare(
        "SELECT workspace_id,kind,id,version,payload FROM organization ORDER BY kind,id",
      )
      .all();
    backup = (await migrate(raw, path, 2000)).backupPath!;
    expect(backup).not.toBe("");
    expect(inspectSchema(raw)).toBe(migrations.length);
    expect(
      raw
        .prepare(
          "SELECT workspace_id,kind,id,version,payload FROM organization ORDER BY kind,id",
        )
        .all(),
    ).toEqual(before);
    insert.run(
      "workspace-a",
      "FOLDER",
      folderId,
      1,
      payload("FOLDER", folderId),
    );
    expect(
      raw
        .prepare(
          "SELECT collection,entity_id,op,version FROM workspace_change WHERE entity_id=?",
        )
        .get(`FOLDER:${folderId}`),
    ).toMatchObject({
      collection: "organization",
      entity_id: `FOLDER:${folderId}`,
      op: "UPSERT",
      version: 1,
    });
    expect(() =>
      insert.run("workspace-a", "OTHER", "other", 1, payload("NOTE", "other")),
    ).toThrow();
    expect(raw.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    raw.close();
  }
  const restoredFile = h.file();
  await restoreDatabase(backup, restoredFile);
  const restored = new DatabaseSync(restoredFile, { readOnly: true });
  try {
    expect(inspectSchema(restored, migrations.slice(0, 42))).toBe(42);
    expect(
      restored
        .prepare("SELECT kind,id FROM organization ORDER BY kind,id")
        .all(),
    ).toEqual([
      { kind: "NOTE", id: "note" },
      { kind: "WORK", id: "task" },
    ]);
  } finally {
    restored.close();
  }
});
