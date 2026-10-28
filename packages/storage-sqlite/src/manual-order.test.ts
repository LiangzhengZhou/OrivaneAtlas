import { DatabaseSync } from "node:sqlite";
import { type ManualOrderState, manualOrderScopeKey } from "@arclattice/domain";
import { expect, test } from "vitest";
import { manualOrderContract } from "../../../tests/contracts/manual-order";
import { restoreDatabase } from "./index";
import { inspectSchema, migrate, migrations } from "./migrations";
import { context, sqliteHarness } from "./testing";

const h = sqliteHarness();
manualOrderContract("SQLite", () => h.create());
test("missing order change trigger is rejected even with intact migration history", async () => {
  const file = h.file();
  const db = new DatabaseSync(file);
  try {
    await migrate(db, file, 2000);
    db.exec("DROP TRIGGER sync_manual_order_update");
    expect(() => inspectSchema(db)).toThrow("SCHEMA_OBJECT_MISSING");
  } finally {
    db.close();
  }
});
const scope = { kind: "WORKSPACE_TASKS" } as const;
const state: ManualOrderState = {
  id: manualOrderScopeKey(scope),
  workspaceId: context.workspaceId,
  scope,
  version: 1,
  updatedBy: context.principalId,
  updatedAt: "2026-10-11T00:00:00Z",
  entries: [
    {
      workspaceId: context.workspaceId,
      scopeKey: manualOrderScopeKey(scope),
      entityId: "a",
      position: 1024,
      version: 1,
      updatedBy: context.principalId,
      updatedAt: "2026-10-11T00:00:00Z",
    },
  ],
};

test("v2.4 schema upgrades append-only and its pre-upgrade backup restores", async () => {
  const file = h.file();
  const raw = new DatabaseSync(file);
  let backup = "";
  try {
    await migrate(raw, file, 2000, migrations.slice(0, 33));
    raw.exec("INSERT INTO workspace VALUES('workspace-a','A')");
    backup = (await migrate(raw, file, 2000)).backupPath!;
    expect(inspectSchema(raw)).toBe(migrations.length);
    expect(
      raw.prepare("SELECT COUNT(*) n FROM manual_order_scope").get()?.n,
    ).toBe(0);
    expect(raw.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    raw.close();
  }
  const restored = h.file();
  await restoreDatabase(backup, restored);
  const old = new DatabaseSync(restored, { readOnly: true });
  try {
    expect(inspectSchema(old, migrations.slice(0, 33))).toBe(33);
    expect(
      old
        .prepare(
          "SELECT name FROM sqlite_schema WHERE name='manual_order_scope'",
        )
        .all(),
    ).toEqual([]);
    expect(old.prepare("PRAGMA integrity_check").get()?.integrity_check).toBe(
      "ok",
    );
  } finally {
    old.close();
  }
});

test("durable order CAS and change share the business transaction", async () => {
  const db = await h.create();
  await db.run(context.workspaceId, (tx) => tx.saveManualOrder(state, 0));
  expect(await db.run(context.workspaceId, (tx) => tx.manualOrders())).toEqual([
    state,
  ]);
  const changes = await db.run(context.workspaceId, (tx) =>
    tx.workspaceChanges(0),
  );
  expect(
    changes.changes.filter((c) => c.collection === "manualOrders"),
  ).toEqual([
    expect.objectContaining({ entityId: state.id, version: 1, op: "UPSERT" }),
  ]);
  expect(
    await db.run(context.workspaceId, (tx) =>
      tx.workspaceEntity("manualOrders", state.id),
    ),
  ).toEqual(state);
  await expect(
    db.run(context.workspaceId, (tx) => tx.saveManualOrder(state, 0)),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  await expect(
    db.run("workspace-b", (tx) => tx.saveManualOrder(state, 0)),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    db.run(context.workspaceId, async (tx) => {
      await tx.saveManualOrder({ ...state, version: 2 }, 1);
      throw new Error("abort reorder");
    }),
  ).rejects.toThrow("abort reorder");
  expect(await db.run(context.workspaceId, (tx) => tx.manualOrders())).toEqual([
    state,
  ]);
  expect(
    await db.run(context.workspaceId, (tx) => tx.workspaceChanges(0)),
  ).toEqual(changes);
  expect(await db.run("workspace-b", (tx) => tx.manualOrders())).toEqual([]);
});
