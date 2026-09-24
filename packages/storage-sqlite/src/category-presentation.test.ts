import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { CategoryService } from "@arclattice/application";
import { expect, test } from "vitest";
import { categoryPort } from "./categories";
import { snapshotToNewFile } from "./database";
import { restoreDatabase } from "./index";
import { migrate, migrations } from "./migrations";
import { context, service, sqliteHarness } from "./testing";

const harness = sqliteHarness();
test("registered SQLite categories retain memberships through edits, reorder and restore", async () => {
  const db = await harness.create();
  const project = await service(db).create(context, {
    title: "Project",
    type: "PROJECT",
  });
  const categories = new CategoryService(
    db,
    { require: async () => {} },
    { now: () => "2026-09-18T00:00:00Z" },
    { next: randomUUID },
  );
  const category = await categories.save(context, {
    name: "Study",
    version: 0,
    deleted: false,
    icon: "📚",
    color: "#aabbcc",
    position: 9,
  });
  const renamed = await categories.save(context, {
    id: category.id,
    name: "Reading",
    version: category.version,
    deleted: false,
  });
  expect(renamed).toMatchObject({
    icon: "📚",
    color: "#aabbcc",
    position: 9,
  });
  const deleted = await categories.save(context, {
    ...renamed,
    deleted: true,
    position: 1,
  });
  const restored = await categories.save(context, {
    ...deleted,
    deleted: false,
  });
  expect(restored).toMatchObject({
    deletedAt: null,
    icon: "📚",
    position: 1,
  });
  await service(db).update(context, project.id, project.version, {
    categoryId: category.id,
  });
  expect(
    (await service(db).snapshot(context)).items.find(
      (item) => item.id === project.id,
    )?.categoryId,
  ).toBe(category.id);
  expect(
    await categories.list({ ...context, workspaceId: "workspace-b" }),
  ).toEqual([]);
});
test("v16 upgrades category defaults, retains legacy rows and restores presentation and outbox", async () => {
  const file = harness.file();
  const db = new DatabaseSync(file);
  const snapshot = harness.file();
  try {
    await migrate(db, file, 2000, migrations.slice(0, 15));
    db.exec(
      "INSERT INTO workspace VALUES ('workspace-a','A'); INSERT INTO principal VALUES ('human','USER','Owner'); INSERT INTO workspace_principal VALUES ('workspace-a','human'); INSERT INTO project_category VALUES ('workspace-a','old','Old',1,'human','human','2026','2026',NULL)",
    );
    const backup = harness.file();
    await snapshotToNewFile(db, backup);
    await migrate(db, file, 2000);
    const port = categoryPort(db, "workspace-a", () => {});
    const [old] = await port.categories();
    expect(old).toMatchObject({
      icon: "",
      color: "#7863c5",
      position: 0,
      name: "Old",
    });
    if (!old) throw new Error("Missing category");
    db.exec("BEGIN");
    await port.saveCategory(
      { ...old, version: 2, icon: "📚", color: "#112233", position: 5 },
      1,
    );
    await port.appendCategoryChange({
      id: randomUUID(),
      workspaceId: "workspace-a",
      principalId: "human",
      categoryId: old.id,
      version: 2,
      occurredAt: "2026",
    });
    db.exec("COMMIT");
    await expect(
      port.saveCategory({ ...old, version: 2 }, 1),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await snapshotToNewFile(db, snapshot);
    for (const [source, upgraded] of [
      [backup, false],
      [snapshot, true],
    ] as const) {
      const restoredFile = harness.file();
      await restoreDatabase(source, restoredFile);
      const restored = new DatabaseSync(restoredFile);
      try {
        expect(
          restored.prepare("PRAGMA integrity_check").get()?.integrity_check,
        ).toBe("ok");
        const row = restored
          .prepare("SELECT * FROM project_category WHERE id='old'")
          .get();
        expect(row?.name).toBe("Old");
        expect(row?.color).toBe(upgraded ? "#112233" : undefined);
        expect(
          restored.prepare("SELECT * FROM category_outbox").all(),
        ).toHaveLength(upgraded ? 1 : 0);
      } finally {
        restored.close();
      }
    }
  } finally {
    db.close();
  }
});
