import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { CategoryService } from "@arclattice/application";
import { expect, test } from "vitest";
import { snapshotToNewFile } from "./database";
import { restoreDatabase } from "./index";
import { inspectSchema, migrate, migrations } from "./migrations";
import { context, sqliteHarness } from "./testing";

const h = sqliteHarness();
test("v14 category migration preserves v13 backup and restores category events and associations", async () => {
  const file = h.file();
  const raw = new DatabaseSync(file);
  let backup = "";
  try {
    await migrate(raw, file, 2000, migrations.slice(0, 13));
    raw.exec(
      "INSERT INTO workspace VALUES ('workspace-a','A'); INSERT INTO principal VALUES ('human','USER','Owner'); INSERT INTO workspace_principal VALUES ('workspace-a','human')",
    );
    backup = (await migrate(raw, file, 2000, migrations.slice(0, 14)))
      .backupPath!;
  } finally {
    raw.close();
  }
  const db = await h.open(file);
  const service = new CategoryService(
    db,
    { require: async () => {} },
    { now: () => new Date().toISOString() },
    { next: randomUUID },
  );
  const category = await service.save(context, {
    version: 0,
    name: "分类",
    deleted: false,
  });
  const snapshot = h.file();
  const reader = new DatabaseSync(file);
  try {
    await snapshotToNewFile(reader, snapshot);
  } finally {
    reader.close();
  }
  for (const [source, version] of [
    [backup, 13],
    [snapshot, migrations.length],
  ] as const) {
    const destination = h.file();
    await restoreDatabase(source, destination);
    const restored = new DatabaseSync(destination);
    try {
      expect(inspectSchema(restored, migrations.slice(0, version))).toBe(
        version,
      );
      expect(
        restored.prepare("PRAGMA integrity_check").get()?.integrity_check,
      ).toBe("ok");
      expect(restored.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      if (version >= 14) {
        expect(
          restored
            .prepare("SELECT name FROM project_category WHERE id=?")
            .get(category.id)?.name,
        ).toBe("分类");
        expect(
          restored.prepare("SELECT * FROM category_activity").all(),
        ).toHaveLength(1);
        expect(
          restored.prepare("SELECT * FROM category_outbox").all(),
        ).toHaveLength(1);
      }
    } finally {
      restored.close();
    }
  }
});
