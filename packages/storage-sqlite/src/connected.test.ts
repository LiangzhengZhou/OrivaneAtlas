import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { ConnectedService, type ConnectedStore } from "@arclattice/application";
import { expect, it } from "vitest";
import { context, service, sqliteHarness } from "./testing";

const harness = sqliteHarness();
const auth = { require: async () => {} },
  clock = { now: () => "2026-09-14T00:00:00Z" },
  ids = { next: randomUUID };
it("isolates linked entities by tenant and rejects escaped transaction adapters", async () => {
  const db = await harness.create(),
    a = await service(db).create(context, { title: "A" }),
    b = await service(db).create(context, { title: "B" });
  let leaked: ConnectedStore | undefined;
  const linked = await db.request(
    context,
    null,
    async (_uow, _notes, store) => {
      leaked = store;
      return new ConnectedService(store, auth, clock, ids).link(
        context,
        { kind: "WORK", id: a.id },
        { kind: "WORK", id: b.id },
        "REFERENCES",
      );
    },
  );
  await expect(leaked!.links()).rejects.toThrow("TRANSACTION_CLOSED");
  const other = { ...context, workspaceId: "workspace-b" };
  await db.request(other, null, async (_uow, _notes, store) => {
    expect(await store.links()).toEqual([]);
    expect(await store.exists({ kind: "WORK", id: a.id })).toBe(false);
    await expect(store.saveLink(linked, 0)).rejects.toThrow("FORBIDDEN");
    await expect(
      new ConnectedService(store, auth, clock, ids).link(
        other,
        { kind: "WORK", id: a.id },
        { kind: "WORK", id: b.id },
        "RELATED",
      ),
    ).rejects.toThrow("NOT_FOUND");
  });
});
it("rolls back connected writes, events, outbox and receipt together; independent audit survives", async () => {
  const db = await harness.create(),
    a = await service(db).create(context, { title: "A" }),
    b = await service(db).create(context, { title: "B" });
  await db.audit(context, a.id, "TEST_ATTEMPT");
  await expect(
    db.request(
      context,
      { key: "rollback", digest: "hash" },
      async (_uow, _notes, store) => {
        await new ConnectedService(store, auth, clock, ids).link(
          context,
          { kind: "WORK", id: a.id },
          { kind: "WORK", id: b.id },
          "RELATED",
        );
        throw new Error("rollback");
      },
    ),
  ).rejects.toThrow("rollback");
  const raw = new DatabaseSync(db.filename, { readOnly: true });
  try {
    for (const table of [
      "knowledge_link",
      "connected_activity",
      "connected_outbox",
      "request_receipt",
    ])
      expect(raw.prepare("SELECT COUNT(*) AS n FROM " + table).get()?.n).toBe(
        0,
      );
    expect(raw.prepare("SELECT COUNT(*) AS n FROM audit_record").get()?.n).toBe(
      1,
    );
  } finally {
    raw.close();
  }
});
