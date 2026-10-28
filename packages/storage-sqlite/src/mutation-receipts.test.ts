import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { WorkService } from "@arclattice/application";
import { expect, it } from "vitest";
import {
  mutationReceiptContract,
  type ReceiptRunner,
} from "../../../tests/contracts/mutation-receipts";
import { restoreDatabase } from "./index";
import { inspectSchema, migrate, migrations } from "./migrations";
import { sqliteHarness } from "./testing";

const h = sqliteHarness();
it("SQLite receipt lookup checks transaction-time session authorization before returning cached content", async () => {
  const db = await h.create();
  const actor = { workspaceId: "workspace-a", principalId: "human" };
  const receipt = {
    key: randomUUID(),
    deviceId: randomUUID(),
    digest: "lookup-session",
  };
  await db.request(actor, receipt, async () => ({
    commandId: receipt.key,
    privateContent: "Original",
  }));
  const before = await db.inspectEvents(actor.workspaceId);
  let checked = 0;
  await expect(
    db.lookupMutationReceipt(actor, receipt.key, receipt.deviceId, () => {
      checked++;
      throw new Error("SESSION_REVOKED");
    }),
  ).rejects.toThrow("SESSION_REVOKED");
  expect(checked).toBe(1);
  expect(await db.inspectEvents(actor.workspaceId)).toEqual(before);
  expect(
    await db.lookupMutationReceipt(actor, receipt.key, receipt.deviceId),
  ).toEqual({ commandId: receipt.key, privateContent: "Original" });
});

mutationReceiptContract("SQLite", async () => {
  const db = await h.create();
  const run: ReceiptRunner = Object.assign(
    ((actor, receipt, operation) =>
      db.request(actor, receipt, (uow) => operation(uow))) as ReceiptRunner,
    {
      lookup: db.lookupMutationReceipt.bind(db),
      lookupReviewed: db.lookupReviewedMutationReceipt.bind(db),
    },
  );
  return run;
});

it("SQLite mutation receipt survives connection restart without repeating Application effects", async () => {
  const path = h.file(),
    db = await h.open(path);
  const actor = { workspaceId: "workspace-a", principalId: "human" };
  await db.provisionWorkspace({ id: actor.workspaceId, name: "Original" }, [
    { id: actor.principalId, kind: "USER", displayName: "Human" },
  ]);
  const receipt = {
      key: randomUUID(),
      digest: "exact-digest",
      deviceId: randomUUID(),
    },
    id = randomUUID();
  const original = await db.request(actor, receipt, (uow) =>
    new WorkService(
      uow,
      { require: async () => {} },
      { now: () => "2026-10-13T00:00:00Z" },
      { next: randomUUID },
    ).createWithStableId(actor, id, {
      title: "Original",
      descriptionMd: "原文\n第二行",
    }),
  );
  const events = await db.inspectEvents(actor.workspaceId);
  await db.close();
  const reopened = await h.open(path);
  const repeated = await reopened.request(actor, receipt, async () => {
    throw new Error("MUST_NOT_REPEAT");
  });
  expect(repeated).toEqual(original);
  expect(await reopened.inspectEvents(actor.workspaceId)).toEqual(events);
});

it("SQLite37 preserves old receipt bytes and restores the exact schema36 backup", async () => {
  const path = h.file(),
    raw = new DatabaseSync(path);
  const result = '{"bodyMd":"第一行\\n第二行","id":"original"}';
  let backup = "";
  try {
    await migrate(raw, path, 2000, migrations.slice(0, 36));
    raw.exec(
      "INSERT INTO workspace VALUES('workspace-a','Original'); INSERT INTO principal VALUES('human','USER','Human'); INSERT INTO workspace_principal VALUES('workspace-a','human')",
    );
    raw
      .prepare("INSERT INTO request_receipt VALUES(?,?,?,?,?,?)")
      .run(
        "workspace-a",
        "human",
        "old-key",
        "old-digest",
        result,
        "2026-10-13T00:00:00Z",
      );
    backup = (await migrate(raw, path, 2000)).backupPath!;
    expect(inspectSchema(raw)).toBe(migrations.length);
    expect(
      raw.prepare("SELECT result,device_id FROM request_receipt").get(),
    ).toMatchObject({ result, device_id: null });
  } finally {
    raw.close();
  }
  const target = h.file();
  await restoreDatabase(backup, target);
  const old = new DatabaseSync(target, { readOnly: true });
  try {
    expect(inspectSchema(old, migrations.slice(0, 36))).toBe(36);
    expect(
      old.prepare("SELECT result FROM request_receipt").get()?.result,
    ).toBe(result);
    expect(
      old
        .prepare("PRAGMA table_info(request_receipt)")
        .all()
        .map((column) => column.name),
    ).toEqual([
      "workspace_id",
      "principal_id",
      "key",
      "digest",
      "result",
      "created_at",
    ]);
  } finally {
    old.close();
  }
});
