import type { WorkTransaction } from "@arclattice/application";
import { describe, expect, it } from "vitest";
import { repositoryContract } from "../../../tests/contracts/work-repository";
import { edge, work } from "../../../tests/fixtures";
import { PostgresUnitOfWork } from "./index";
import { context, postgresHarness, principal, service } from "./testing";

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
const h = postgresHarness();
repositoryContract("PostgreSQL", h.create);

describe("real PostgreSQL storage", () => {
  it("persists exact Markdown, edges, trash and atomic events after reconnect and server restart", async () => {
    const name = await h.database();
    const db = await h.provision(await h.open(name));
    const app = service(db);
    const markdown = "# 中文 🚀\r\n\n'quoted' \\ **source**";
    const a = await app.create(context, {
      title: "A",
      descriptionMd: markdown,
    });
    const b = await app.create(context, { title: "B" });
    await app.addEdge(context, a.id, b.id);
    const c = await app.create(context, { title: "Trash" });
    await app.setDeleted(context, c.id, c.version, true);
    const before = await app.snapshot(context, true);
    const events = await db.inspectEvents(context.workspaceId);
    expect(events.activity).toHaveLength(5);
    expect(events.outbox).toHaveLength(5);
    await db.close();
    await h.cluster().stop();
    await h.cluster().boot();
    const reopened = await h.open(name);
    expect(await service(reopened).snapshot(context, true)).toEqual(before);
    expect(await reopened.inspectEvents(context.workspaceId)).toEqual(events);
    expect(
      (await reopened.run(context.workspaceId, (tx) => tx.get(a.id)))
        .descriptionMd,
    ).toBe(markdown);
  }, 30_000);

  it("rolls back business data and events on late foreign-key failure", async () => {
    const db = await h.create();
    await expect(
      db.run(context.workspaceId, async (tx) => {
        await tx.insert(work("a"));
        await tx.appendActivity({
          ...context,
          id: "event",
          entityId: "a",
          type: "WORK_ITEM_CREATED",
          occurredAt: "now",
        });
        await tx.appendOutbox({
          workspaceId: context.workspaceId,
          id: "out",
          activityId: "missing",
          type: "WORK_CHANGED",
          occurredAt: "now",
        });
      }),
    ).rejects.toThrow("VALIDATION_ERROR");
    expect(await db.run(context.workspaceId, (tx) => tx.list())).toEqual([]);
    expect(await db.inspectEvents(context.workspaceId)).toEqual({
      activity: [],
      outbox: [],
    });
  });

  it("requires explicit workspace and member provisioning without overwriting metadata", async () => {
    const db = await h.open(await h.database());
    await expect(
      db.run(context.workspaceId, (tx) => tx.list()),
    ).rejects.toThrow("NOT_FOUND");
    await db.provisionWorkspace({ id: context.workspaceId, name: "A" }, []);
    await expect(
      db.run(context.workspaceId, (tx) => tx.insert(work("a"))),
    ).rejects.toThrow("FORBIDDEN");
    await db.provisionWorkspace({ id: context.workspaceId, name: "A" }, [
      principal,
    ]);
    await db.provisionWorkspace({ id: context.workspaceId, name: "A" }, [
      principal,
    ]);
    await expect(
      db.provisionWorkspace({ id: context.workspaceId, name: "Changed" }, []),
    ).rejects.toThrow("PROVISIONING_CONFLICT");
    await expect(
      db.provisionWorkspace({ id: context.workspaceId, name: "A" }, [
        { ...principal, kind: "AGENT" },
      ]),
    ).rejects.toThrow("PROVISIONING_CONFLICT");
    await expect(
      db.run(context.workspaceId, (tx) =>
        tx.insert({ ...work("a"), assigneePrincipalId: "outsider" }),
      ),
    ).rejects.toThrow("FORBIDDEN");
    await db.run(context.workspaceId, (tx) => tx.insert(work("a")));
  });

  it("rejects cross-workspace endpoints, activities and outbox references", async () => {
    const db = await h.create();
    await db.run("workspace-a", (tx) => tx.insert(work("a")));
    await db.run("workspace-b", (tx) => tx.insert(work("b", "workspace-b")));
    await expect(
      db.run("workspace-a", (tx) => tx.addEdge(edge("a", "b"))),
    ).rejects.toThrow("NOT_FOUND");
    await expect(
      db.run("workspace-a", (tx) =>
        tx.appendActivity({
          workspaceId: "workspace-b",
          principalId: "human",
          id: "e",
          entityId: "b",
          type: "WORK_ITEM_CREATED",
          occurredAt: "now",
        }),
      ),
    ).rejects.toThrow("FORBIDDEN");
    await db.run("workspace-b", (tx) =>
      tx.appendActivity({
        workspaceId: "workspace-b",
        principalId: "human",
        id: "e",
        entityId: "b",
        type: "WORK_ITEM_CREATED",
        occurredAt: "now",
      }),
    );
    await expect(
      db.run("workspace-a", (tx) =>
        tx.appendOutbox({
          workspaceId: "workspace-a",
          id: "o",
          activityId: "e",
          type: "WORK_CHANGED",
          occurredAt: "now",
        }),
      ),
    ).rejects.toThrow("VALIDATION_ERROR");
    expect((await db.inspectEvents("workspace-a")).outbox).toEqual([]);
  });

  it("enforces SQL version, member and normalized dependency constraints", async () => {
    const name = await h.database();
    const db = await h.provision(await h.open(name));
    await db.run("workspace-a", async (tx) => {
      await tx.insert(work("a"));
      await tx.insert(work("b"));
      await tx.addEdge(edge("a", "b"));
    });
    await expect(
      db.run("workspace-a", (tx) => tx.addEdge(edge("b", "a", "REQUIRES"))),
    ).rejects.toThrow("DUPLICATE_EDGE");
    await expect(
      h.query(name, "UPDATE arclattice.work_item SET version=9007199254740992"),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      h.query(name, "UPDATE arclattice.work_item SET created_by='outsider'"),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      h.query(
        name,
        "UPDATE arclattice.work_edge SET workspace_id='workspace-b'",
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await h.query(
      name,
      "UPDATE arclattice.work_item SET version=2147483648 WHERE id='a'",
    );
    expect((await db.run("workspace-a", (tx) => tx.get("a"))).version).toBe(
      2147483648,
    );
  });

  it("serializes independent pools before reads so stale CAS cannot emit events", async () => {
    const name = await h.database();
    const first = await h.provision(await h.open(name));
    const second = await h.open(name);
    const item = await service(first).create(context, { title: "original" });
    const results = await Promise.allSettled(
      [service(first), service(second)].map((app, i) =>
        app.update(context, item.id, 1, { title: "writer " + i }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({
      reason: { code: "VERSION_CONFLICT" },
    });
    expect(
      (await first.inspectEvents(context.workspaceId)).activity,
    ).toHaveLength(2);
  });

  it("prevents a racing dependency cycle across independent pools", async () => {
    const name = await h.database();
    const first = await h.provision(await h.open(name));
    const second = await h.open(name);
    const app = service(first);
    const a = await app.create(context, { title: "a" });
    const b = await app.create(context, { title: "b" });
    const results = await Promise.allSettled([
      app.addEdge(context, a.id, b.id),
      service(second).addEdge(context, b.id, a.id),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await app.snapshot(context)).edges).toHaveLength(1);
    expect(
      (await first.inspectEvents(context.workspaceId)).outbox,
    ).toHaveLength(3);
  });

  it("allows another workspace while one is locked and times out without replaying a callback", async () => {
    const name = await h.database();
    const first = await h.provision(await h.open(name));
    const second = await h.open(name, 100);
    const entered = signal();
    const release = signal();
    const held = first.run("workspace-a", async () => {
      entered.resolve();
      await release.promise;
    });
    let calls = 0;
    try {
      await entered.promise;
      expect(await second.run("workspace-b", (tx) => tx.list())).toEqual([]);
      await expect(
        second.run("workspace-a", () => {
          calls++;
        }),
      ).rejects.toThrow("LOCK_TIMEOUT");
      expect(calls).toBe(0);
    } finally {
      release.resolve();
      await held;
    }
    await second.run("workspace-a", (tx) => tx.insert(work("a")));
  });

  it("keeps application blocked, reopen and delete policies inside the lock", async () => {
    const db = await h.create();
    const app = service(db);
    const a = await app.create(context, { title: "a" });
    const b = await app.create(context, { title: "b" });
    await app.addEdge(context, a.id, b.id);
    await expect(
      app.update(context, b.id, 1, { status: "IN_PROGRESS" }),
    ).rejects.toThrow("WORK_ITEM_BLOCKED");
    await app.update(context, a.id, 1, { status: "DONE" });
    await app.update(context, b.id, 1, { status: "IN_PROGRESS" });
    await expect(
      app.update(context, a.id, 2, { status: "TODO" }),
    ).rejects.toThrow("DEPENDENCY_EXISTS");
    await expect(app.setDeleted(context, a.id, 2, true)).rejects.toThrow(
      "DEPENDENCY_EXISTS",
    );
  });

  it("rejects nested operations and drains accepted work before closing", async () => {
    const db = await h.create();
    const entered = signal();
    const release = signal();
    const held = db.run(context.workspaceId, async (tx) => {
      await expect(
        db.run(context.workspaceId, (tx) => tx.list()),
      ).rejects.toThrow("NESTED_OPERATION");
      await expect(db.close()).rejects.toThrow("NESTED_OPERATION");
      entered.resolve();
      await release.promise;
      await tx.insert(work("a"));
    });
    await entered.promise;
    const closed = db.close();
    await expect(
      db.run(context.workspaceId, (tx) => tx.list()),
    ).rejects.toThrow("STORAGE_CLOSED");
    release.resolve();
    await held;
    await closed;
    await db.close();
  });

  it("drains unawaited port operations, seals escaped handles, and snapshots input", async () => {
    const db = await h.create();
    let escaped: WorkTransaction | undefined;
    await db.run(context.workspaceId, (tx) => {
      escaped = tx;
      const item = { ...work("a") };
      void tx.insert(item);
      item.title = "mutated before await";
    });
    await expect(escaped?.get("a")).rejects.toThrow("TRANSACTION_CLOSED");
    expect((await db.run(context.workspaceId, (tx) => tx.get("a"))).title).toBe(
      "a",
    );
  });

  it("rolls back even when the callback catches a port failure", async () => {
    const db = await h.create();
    await expect(
      db.run(context.workspaceId, async (tx) => {
        await tx.insert(work("a"));
        await tx.get("missing").catch(() => undefined);
      }),
    ).rejects.toThrow("NOT_FOUND");
    expect(await db.run(context.workspaceId, (tx) => tx.list())).toEqual([]);
  });

  it("rejects unsafe option defaults before connecting", async () => {
    await expect(
      PostgresUnitOfWork.open({
        connection: { connectionString: "postgresql://localhost/" },
      }),
    ).rejects.toThrow("EXPLICIT_DATABASE_REQUIRED");
    await expect(PostgresUnitOfWork.open({ connection: {} })).rejects.toThrow(
      "EXPLICIT_DATABASE_REQUIRED",
    );
    await expect(
      PostgresUnitOfWork.open({ connection: {}, lockTimeoutMs: 0 }),
    ).rejects.toThrow("INVALID_LOCK_TIMEOUT");
  });
  it("discards a terminated checked-out connection and rolls back instead of crashing or replaying", async () => {
    const name = await h.database();
    const db = await h.provision(await h.open(name));
    let calls = 0;
    await expect(
      db.run("workspace-a", async (tx) => {
        calls++;
        await tx.insert(work("a"));
        const sessions = (
          await h.query(
            name,
            "SELECT pid FROM pg_stat_activity WHERE datname=$1 AND state='idle in transaction' AND query LIKE 'INSERT INTO arclattice.work_item%'",
            [name],
          )
        ).rows;
        expect(sessions).toHaveLength(1);
        await h.query(name, "SELECT pg_terminate_backend($1, 5000)", [
          sessions[0].pid,
        ]);
        await tx.get("a");
      }),
    ).rejects.toThrow();
    expect(calls).toBe(1);
    expect(await db.run("workspace-a", (tx) => tx.list())).toEqual([]);
    await db.run("workspace-a", (tx) => tx.insert(work("b")));
  });
});
