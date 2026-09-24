import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { WorkflowService } from "@arclattice/application";
import { expect, test } from "vitest";
import { snapshotToNewFile } from "./database";
import { restoreDatabase } from "./index";
import { inspectSchema, migrate, migrations } from "./migrations";
import { context, sqliteHarness } from "./testing";

const h = sqliteHarness();
test("v15 workflow upgrade and snapshots restore records and transactional events", async () => {
  const file = h.file();
  const raw = new DatabaseSync(file);
  let backup = "";
  try {
    await migrate(raw, file, 2000, migrations.slice(0, 14));
    raw.exec(
      "INSERT INTO workspace VALUES ('workspace-a','A'); INSERT INTO principal VALUES ('human','USER','Owner'); INSERT INTO workspace_principal VALUES ('workspace-a','human')",
    );
    backup = (await migrate(raw, file, 2000)).backupPath!;
  } finally {
    raw.close();
  }
  const db = await h.open(file);
  const service = new WorkflowService(
    db,
    { require: async () => {} },
    { now: () => "2026-09-17T12:00:00.000Z" },
    { next: randomUUID },
  );
  const definition = await service.saveRecurrence(context, {
    version: 0,
    deleted: false,
    rule: {
      title: "Daily",
      descriptionMd: "Preserve **Markdown**",
      projectIds: [],
      startDate: "2026-09-16",
      timezone: "UTC",
      frequency: "DAILY",
      interval: 1,
    },
  });
  await service.generate(
    context,
    definition.id,
    definition.version,
    "2026-09-16",
    "2026-09-17",
  );
  const records = await service.list(context);
  const snapshot = h.file();
  const reader = new DatabaseSync(file);
  try {
    await snapshotToNewFile(reader, snapshot);
  } finally {
    reader.close();
  }
  for (const [source, version] of [
    [backup, 14],
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
      if (version >= 15) {
        expect(
          restored.prepare("SELECT * FROM workflow_record").all(),
        ).toHaveLength(3);
        expect(
          restored.prepare("SELECT * FROM workflow_activity").all(),
        ).toHaveLength(3);
        expect(
          restored.prepare("SELECT * FROM workflow_outbox").all(),
        ).toHaveLength(3);
        expect(restored.prepare("SELECT * FROM work_item").all()).toHaveLength(
          1,
        );
      }
    } finally {
      restored.close();
    }
    if (version >= 15) {
      const opened = await h.open(destination);
      expect(
        await opened.run(context.workspaceId, (tx) => tx.workflows()),
      ).toEqual(records);
    }
  }
});
