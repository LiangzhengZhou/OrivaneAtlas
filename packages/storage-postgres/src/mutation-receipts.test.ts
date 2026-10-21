import { randomUUID } from "node:crypto";
import { WorkService } from "@arclattice/application";
import { expect, it } from "vitest";
import {
  mutationReceiptContract,
  type ReceiptRunner,
} from "../../../tests/contracts/mutation-receipts";
import { inspectSchema, migrate, migrations } from "./migrations";
import { postgresHarness } from "./testing";

const h = postgresHarness();
mutationReceiptContract("PostgreSQL", async () => {
  const db = await h.create();
  const run: ReceiptRunner = Object.assign(
    ((actor, receipt, operation) =>
      db.knowledge(actor, (uow) => operation(uow), receipt)) as ReceiptRunner,
    {
      lookup: db.lookupMutationReceipt.bind(db),
      lookupReviewed: db.lookupReviewedMutationReceipt.bind(db),
    },
  );
  return run;
});

it("PostgreSQL mutation receipt survives reconnect and its physical backup preserves result and device", async () => {
  const name = await h.database(),
    db = await h.provision(await h.open(name));
  const actor = { workspaceId: "workspace-a", principalId: "human" };
  const receipt = {
      key: randomUUID(),
      digest: "exact-digest",
      deviceId: randomUUID(),
    },
    id = randomUUID();
  const original = await db.knowledge(
    actor,
    (uow) =>
      new WorkService(
        uow,
        { require: async () => {} },
        { now: () => "2026-10-13T00:00:00Z" },
        { next: randomUUID },
      ).createWithStableId(actor, id, {
        title: "Original",
        descriptionMd: "原文\n第二行",
      }),
    receipt,
  );
  const events = await db.inspectEvents(actor.workspaceId);
  await db.close();
  const reopened = await h.open(name);
  expect(
    await reopened.knowledge(
      actor,
      async () => {
        throw new Error("MUST_NOT_REPEAT");
      },
      receipt,
    ),
  ).toEqual(original);
  expect(await reopened.inspectEvents(actor.workspaceId)).toEqual(events);
  await reopened.close();
  const backup = await h.cluster().snapshot();
  await h.cluster().withRestoredSnapshot(backup, async (copy) => {
    const row = (
      await copy.query(
        name,
        "SELECT result,device_id FROM arclattice.request_receipt WHERE workspace_id=$1 AND principal_id=$2 AND key=$3",
        [actor.workspaceId, actor.principalId, receipt.key],
      )
    ).rows[0];
    expect(JSON.parse(String(row?.result))).toEqual(original);
    expect(row?.device_id).toBe(receipt.deviceId);
    expect(
      (
        await copy.query(
          name,
          "SELECT description_md FROM arclattice.work_item WHERE workspace_id=$1 AND id=$2",
          [actor.workspaceId, id],
        )
      ).rows[0]?.description_md,
    ).toBe("原文\n第二行");
  });
}, 180000);

it("PostgreSQL current receipt upgrade preserves workspace data and restores exact schema30", async () => {
  const name = await h.database();
  await h.client(name, (client) =>
    migrate(client, 2000, undefined, migrations.slice(0, 30)),
  );
  await h.query(
    name,
    "INSERT INTO arclattice.workspace VALUES('workspace-a','原始工作区')",
  );
  const backup = await h.cluster().snapshot();
  let gated = false;
  await h.client(name, (client) =>
    migrate(client, 2000, async () => {
      gated = true;
    }),
  );
  expect(gated).toBe(true);
  expect(await h.client(name, (client) => inspectSchema(client))).toBe(37);
  expect(
    (await h.query(name, "SELECT name FROM arclattice.workspace")).rows[0]
      ?.name,
  ).toBe("原始工作区");
  expect(
    (await h.query(name, "SELECT COUNT(*) n FROM arclattice.request_receipt"))
      .rows[0]?.n,
  ).toBe("0");
  await h.cluster().withRestoredSnapshot(backup, async (copy) => {
    expect(
      (
        await copy.query(
          name,
          "SELECT max(version) v FROM arclattice.schema_migrations",
        )
      ).rows[0]?.v,
    ).toBe(30);
    expect(
      (await copy.query(name, "SELECT name FROM arclattice.workspace")).rows[0]
        ?.name,
    ).toBe("原始工作区");
    expect(
      (
        await copy.query(
          name,
          "SELECT to_regclass('arclattice.request_receipt') receipt",
        )
      ).rows[0]?.receipt,
    ).toBeNull();
  });
}, 180000);
