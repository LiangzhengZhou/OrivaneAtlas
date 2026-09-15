import { spawn } from "node:child_process";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { setTimeout } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { repositoryContract } from "../../../tests/contracts/work-repository";
import { edge, work } from "../../../tests/fixtures";
import { context, principal, service, sqliteHarness } from "./testing";

const harness = sqliteHarness();
repositoryContract("SQLite file", harness.create);

describe("SQLite persistence and transactions", () => {
  it("reopens committed Markdown, graph, soft deletion, attribution and events", async () => {
    const db = await harness.create();
    const app = service(db);
    const a = await app.create(context, {
      title: "中文",
      descriptionMd: "# 原文\r\n\n- [ ] unchecked\n😀 ' \"",
    });
    const b = await app.create(context, { title: "b" });
    await app.addEdge(context, b.id, a.id, "REQUIRES");
    const trash = await app.create(context, { title: "trash" });
    await app.setDeleted(context, trash.id, 1, true);
    const before = await app.snapshot(context, true);
    const events = await db.inspectEvents(context.workspaceId);
    await db.close();
    const reopened = await harness.open(db.filename);
    expect(await service(reopened).snapshot(context, true)).toEqual(before);
    expect(await reopened.inspectEvents(context.workspaceId)).toEqual(events);
    expect(events.activity).toHaveLength(5);
    expect(events.outbox).toHaveLength(5);
    expect(
      (await service(reopened).setDeleted(context, trash.id, 2, false)).version,
    ).toBe(3);
  });

  it("rolls back item, activity and outbox on callback failure, even after reopen", async () => {
    const db = await harness.create();
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
          id: "outbox",
          activityId: "event",
          type: "WORK_CHANGED",
          occurredAt: "now",
        });
        throw new Error("injected failure");
      }),
    ).rejects.toThrow("injected failure");
    await db.close();
    const reopened = await harness.open(db.filename);
    expect(await reopened.run(context.workspaceId, (tx) => tx.list())).toEqual(
      [],
    );
    expect(await reopened.inspectEvents(context.workspaceId)).toEqual({
      activity: [],
      outbox: [],
    });
  });

  it("rolls back the transaction if an outbox foreign key fails", async () => {
    const db = await harness.create();
    await expect(
      db.run(context.workspaceId, async (tx) => {
        await tx.insert(work("a"));
        await tx.appendOutbox({
          workspaceId: context.workspaceId,
          id: "outbox",
          activityId: "missing",
          type: "WORK_CHANGED",
          occurredAt: "now",
        });
      }),
    ).rejects.toThrow("VALIDATION_ERROR");
    expect(await db.run(context.workspaceId, (tx) => tx.list())).toEqual([]);
  });

  it("requires explicit provisioning and rejects nonmember principals", async () => {
    const db = await harness.open();
    await expect(
      db.run(context.workspaceId, (tx) => tx.list()),
    ).rejects.toThrow("NOT_FOUND");
    await db.provisionWorkspace({ id: context.workspaceId, name: "a" }, []);
    await expect(
      db.run(context.workspaceId, (tx) => tx.insert(work("a"))),
    ).rejects.toThrow("FORBIDDEN");
    await db.provisionWorkspace({ id: context.workspaceId, name: "a" }, [
      principal,
    ]);
    await db.run(context.workspaceId, (tx) => tx.insert(work("a")));
    await expect(
      db.run(context.workspaceId, (tx) =>
        tx.insert({ ...work("b"), assigneePrincipalId: "foreign" }),
      ),
    ).rejects.toThrow("FORBIDDEN");
    await expect(
      db.provisionWorkspace({ id: "workspace-new", name: "new" }, [
        { ...principal, kind: "AGENT" },
      ]),
    ).rejects.toThrow("PROVISIONING_CONFLICT");
    await expect(db.run("workspace-new", (tx) => tx.list())).rejects.toThrow(
      "NOT_FOUND",
    );
  });

  it("rejects cross-workspace edges and event references", async () => {
    const db = await harness.create();
    await db.run("workspace-a", (tx) => tx.insert(work("a")));
    await db.run("workspace-b", async (tx) => {
      await tx.insert(work("b", "workspace-b"));
      await tx.appendActivity({
        ...context,
        workspaceId: "workspace-b",
        id: "foreign-event",
        entityId: "b",
        type: "WORK_ITEM_CREATED",
        occurredAt: "now",
      });
    });
    await expect(
      db.run("workspace-a", (tx) => tx.addEdge(edge("a", "b"))),
    ).rejects.toThrow("NOT_FOUND");
    await expect(
      db.run("workspace-a", (tx) =>
        tx.appendActivity({
          ...context,
          workspaceId: "workspace-b",
          id: "e",
          entityId: "a",
          type: "WORK_ITEM_CREATED",
          occurredAt: "now",
        }),
      ),
    ).rejects.toThrow("FORBIDDEN");
    await expect(
      db.run("workspace-a", (tx) =>
        tx.appendOutbox({
          workspaceId: "workspace-a",
          id: "o",
          activityId: "foreign-event",
          type: "WORK_CHANGED",
          occurredAt: "now",
        }),
      ),
    ).rejects.toThrow("VALIDATION_ERROR");
  });

  it("enforces normalized uniqueness and SQL foreign keys below the service", async () => {
    const db = await harness.create();
    await db.run(context.workspaceId, async (tx) => {
      await tx.insert(work("a"));
      await tx.insert(work("b"));
      await tx.addEdge(edge("a", "b"));
    });
    await expect(
      db.run(context.workspaceId, (tx) =>
        tx.addEdge(edge("b", "a", "REQUIRES")),
      ),
    ).rejects.toThrow("DUPLICATE_EDGE");
    const raw = new DatabaseSync(db.filename);
    try {
      expect(() =>
        raw.prepare("UPDATE work_edge SET workspace_id='workspace-b'").run(),
      ).toThrow(/FOREIGN KEY/);
      expect(() => raw.prepare("UPDATE work_item SET version=0").run()).toThrow(
        /CHECK/,
      );
    } finally {
      raw.close();
    }
  });

  it("only one stale writer across independent connections commits events", async () => {
    const first = await harness.create();
    const second = await harness.open(first.filename);
    const item = await service(first).create(context, { title: "original" });
    const results = await Promise.allSettled([
      service(first).update(context, item.id, 1, { title: "one" }),
      service(second).update(context, item.id, 1, { title: "two" }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason.message).toBe(
      "VERSION_CONFLICT",
    );
    expect(
      (await first.inspectEvents(context.workspaceId)).outbox,
    ).toHaveLength(2);
  });

  it("prevents a cycle across two independent SQLite connections", async () => {
    const first = await harness.create();
    const second = await harness.open(first.filename);
    const a = await service(first).create(context, { title: "a" });
    const b = await service(first).create(context, { title: "b" });
    const results = await Promise.allSettled([
      service(first).addEdge(context, a.id, b.id),
      service(second).addEdge(context, b.id, a.id),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason.message).toBe(
      "WORK_GRAPH_CYCLE_DETECTED",
    );
    expect((await service(second).snapshot(context)).edges).toHaveLength(1);
  });

  it("preserves application blocking and deletion policies on SQLite", async () => {
    const db = await harness.create();
    const app = service(db);
    const a = await app.create(context, { title: "a" });
    const b = await app.create(context, { title: "b" });
    const link = await app.addEdge(context, a.id, b.id);
    await expect(
      app.update(context, b.id, 1, { status: "DONE" }),
    ).rejects.toThrow("WORK_ITEM_BLOCKED");
    await expect(app.setDeleted(context, a.id, 1, true)).rejects.toThrow(
      "DEPENDENCY_EXISTS",
    );
    await app.update(context, a.id, 1, { status: "DONE" });
    await app.update(context, b.id, 1, { status: "IN_PROGRESS" });
    await expect(
      app.update(context, a.id, 2, { status: "TODO" }),
    ).rejects.toThrow("DEPENDENCY_EXISTS");
    await app.removeEdge(context, link.id);
    await app.setDeleted(context, a.id, 2, true);
    await expect(
      app.update(context, a.id, 3, { title: "hidden" }),
    ).rejects.toThrow("NOT_FOUND");
  });

  it("times out lock acquisition without running or replaying the callback", async () => {
    const first = await harness.create();
    const second = await harness.open(first.filename, 20);
    const lock = new DatabaseSync(first.filename);
    let calls = 0;
    try {
      lock.exec("BEGIN IMMEDIATE");
      await expect(
        second.run(context.workspaceId, () => {
          calls++;
        }),
      ).rejects.toThrow("STORAGE_BUSY");
      expect(calls).toBe(0);
      lock.exec("ROLLBACK");
      await second.run(context.workspaceId, () => {
        calls++;
      });
      expect(calls).toBe(1);
    } finally {
      lock.close();
    }
  });

  it("waits for another process writer, then sees its committed version", async () => {
    const db = await harness.create();
    await db.run(context.workspaceId, (tx) => tx.insert(work("a")));
    const child = spawn(
      process.execPath,
      [
        "-e",
        [
          "const {DatabaseSync} = require('node:sqlite');",
          "const db = new DatabaseSync(process.argv[1]);",
          "db.exec('BEGIN IMMEDIATE'); process.send('locked');",
          "process.on('message', () => { db.exec(\"UPDATE work_item SET version=2, title='child' WHERE id='a'; COMMIT\"); db.close(); process.disconnect(); });",
        ].join("\n"),
        db.filename,
      ],
      { stdio: ["ignore", "ignore", "pipe", "ipc"], windowsHide: true },
    );
    const exited = once(child, "exit");
    try {
      await once(child, "message");
      const result = db.run(context.workspaceId, async (tx) =>
        tx.replace({ ...(await tx.get("a")), title: "parent", version: 2 }, 1),
      );
      // Attach rejection handling before the child releases the lock.
      const assertion = expect(result).rejects.toThrow("VERSION_CONFLICT");
      await setTimeout(20);
      child.send("commit");
      await assertion;
      expect(
        (await db.run(context.workspaceId, (tx) => tx.get("a"))).title,
      ).toBe("child");
      await exited;
    } finally {
      if (child.exitCode === null) {
        child.kill();
        await exited;
      }
    }
  });

  it("rejects nested operations and drains accepted work before close", async () => {
    const db = await harness.create();
    await expect(
      db.run(context.workspaceId, () =>
        db.run(context.workspaceId, (tx) => tx.list()),
      ),
    ).rejects.toThrow("NESTED_OPERATION");
    const pending = db.run(context.workspaceId, (tx) => tx.insert(work("a")));
    const closed = db.close();
    await expect(
      db.run(context.workspaceId, (tx) => tx.list()),
    ).rejects.toThrow("STORAGE_CLOSED");
    await pending;
    await closed;
    await db.close();
    const reopened = await harness.open(db.filename);
    expect(
      await reopened.run(context.workspaceId, (tx) => tx.list()),
    ).toHaveLength(1);
  });
});
