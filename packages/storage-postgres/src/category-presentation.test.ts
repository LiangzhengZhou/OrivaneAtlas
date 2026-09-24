import { randomUUID } from "node:crypto";
import { CategoryService } from "@arclattice/application";
import { expect, test } from "vitest";
import { categoryPort } from "./categories";
import { migrate, migrations } from "./migrations";
import { context, postgresHarness, service } from "./testing";

const harness = postgresHarness();
test("registered PostgreSQL category metadata survives membership-preserving legacy edits", async () => {
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
test("v8 category migration preserves old rows, CAS, isolation and transaction rollback", async () => {
  const name = await harness.database();
  await harness.client(name, (client) =>
    migrate(client, 2000, undefined, migrations.slice(0, 7)),
  );
  await harness.query(
    name,
    "INSERT INTO arclattice.workspace VALUES ('w','Workspace'); INSERT INTO arclattice.principal VALUES ('p','USER','Owner'); INSERT INTO arclattice.workspace_principal VALUES ('w','p'); INSERT INTO arclattice.project_category VALUES ('w','old','Old',1,'p','p','2026','2026',NULL)",
  );
  await harness.client(name, async (client) => {
    await migrate(client, 2000, async () => {});
    const port = categoryPort(client, "w", (operation) => operation());
    const [old] = await port.categories();
    expect(old).toMatchObject({ icon: "", color: "#7863c5", position: 0 });
    if (!old) throw new Error("Missing category");
    const updated = {
      ...old,
      version: 2,
      color: "#123456",
      icon: "📚",
      position: 2,
    };
    await client.query("BEGIN");
    await port.saveCategory(updated, 1);
    await port.appendCategoryChange({
      workspaceId: "w",
      id: "event",
      principalId: "p",
      categoryId: "old",
      version: 2,
      occurredAt: "2026",
    });
    await client.query("COMMIT");
    expect(await port.categories()).toEqual([updated]);
    expect(
      await categoryPort(client, "other", (operation) =>
        operation(),
      ).categories(),
    ).toEqual([]);
    await expect(port.saveCategory(updated, 1)).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
    });
    await client.query("BEGIN");
    await port.saveCategory({ ...updated, version: 3, position: 10 }, 2);
    await client.query("ROLLBACK");
    expect(await port.categories()).toEqual([updated]);
    expect(
      (await client.query("SELECT * FROM arclattice.category_outbox")).rowCount,
    ).toBe(1);
  });
});
