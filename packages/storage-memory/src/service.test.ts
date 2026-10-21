import type { Permission } from "@arclattice/application";
import { WorkService } from "@arclattice/application";
import { isReady } from "@arclattice/domain";
import { describe, expect, it } from "vitest";
import { LocalAuthorization, MemoryUnitOfWork } from "./index";

const context = { workspaceId: "workspace-a", principalId: "human" };
function setup(
  permissions: Permission[] = [
    "work:read",
    "work:create",
    "work:update",
    "work:delete",
    "graph:write",
  ],
) {
  let id = 0;
  const uow = new MemoryUnitOfWork();
  const service = new WorkService(
    uow,
    new LocalAuthorization([{ ...context, permissions }]),
    { now: () => "2026-09-13T00:00:00.000Z" },
    { next: () => String(++id) },
  );
  return { uow, service };
}
describe("Work application service", () => {
  it("stable dependency edge entry retains graph permissions and server-owned audit IDs", async () => {
    const { service, uow } = setup();
    const a = await service.create(context, { title: "A" });
    const b = await service.create(context, { title: "B" });
    const stable = "33333333-3333-4333-8333-333333333333";
    const observed: (string | undefined)[] = [];
    let sequence = 0;
    const replay = new WorkService(
      uow,
      new LocalAuthorization([
        { ...context, permissions: ["graph:write", "work:read"] },
      ]),
      { now: () => "2026-09-13T00:00:00.000Z" },
      {
        next: () => `server-${++sequence}`,
        nextFor: (purpose) => {
          observed.push(purpose);
          return `server-${++sequence}`;
        },
      },
    );
    await replay.addEdgeWithStableId(context, stable, a.id, b.id);
    expect(observed).toEqual(["ACTIVITY", "OUTBOX"]);
    const events = await uow.inspectEvents(context.workspaceId);
    expect(events.activity.at(-1)).toMatchObject({
      id: "server-1",
      entityId: stable,
      principalId: context.principalId,
    });
    expect(events.outbox.at(-1)).toMatchObject({ id: "server-2" });
    const denied = new WorkService(
      uow,
      new LocalAuthorization([{ ...context, permissions: ["work:read"] }]),
      { now: () => "2026-09-13T00:00:00.000Z" },
      { next: () => "must-not-allocate" },
    );
    await expect(
      denied.addEdgeWithStableId(
        context,
        "44444444-4444-4444-8444-444444444444",
        b.id,
        a.id,
      ),
    ).rejects.toThrow("FORBIDDEN");
    expect(await uow.inspectEvents(context.workspaceId)).toEqual(events);
  });
  it("preserves offline UUID identity while retaining attribution, rules and duplicate protection", async () => {
    const { service, uow } = setup();
    const id = "11111111-1111-4111-8111-111111111111";
    const task = await service.createWithStableId(context, id, {
      title: "Offline",
      descriptionMd: "原文\n第二行",
    });
    expect(task).toMatchObject({
      id,
      workspaceId: context.workspaceId,
      createdBy: context.principalId,
      version: 1,
      descriptionMd: "原文\n第二行",
    });
    const before = await uow.inspectEvents(context.workspaceId);
    await expect(
      service.createWithStableId(context, id, { title: "Duplicate" }),
    ).rejects.toThrow("VERSION_CONFLICT");
    expect(await uow.inspectEvents(context.workspaceId)).toEqual(before);
    await expect(
      service.createWithStableId(context, "not-a-uuid", { title: "Invalid" }),
    ).rejects.toThrow("VALIDATION_ERROR");
    await expect(
      service.createWithStableId(
        context,
        "22222222-2222-4222-8222-222222222222",
        {
          title: "Invalid parent",
          type: "PROJECT",
          parentProjectId: "missing",
        },
      ),
    ).rejects.toThrow();
    expect(
      (await service.snapshot(context)).items.map((item) => item.id),
    ).toEqual([id]);
  });
  it("stable UUID creation cannot bypass ordinary workspace and graph permissions", async () => {
    const { service } = setup(["work:read"]);
    await expect(
      service.createWithStableId(
        context,
        "11111111-1111-4111-8111-111111111111",
        { title: "Denied" },
      ),
    ).rejects.toThrow("FORBIDDEN");
    const allowed = setup(["work:create", "work:read"]).service;
    await expect(
      allowed.createWithStableId(
        context,
        "11111111-1111-4111-8111-111111111111",
        { title: "Graph denied", prerequisiteIds: ["missing"] },
      ),
    ).rejects.toThrow("FORBIDDEN");
    await expect(
      allowed.createWithStableId(
        { ...context, workspaceId: "foreign" },
        "11111111-1111-4111-8111-111111111111",
        { title: "Foreign" },
      ),
    ).rejects.toThrow("FORBIDDEN");
  });
  it("creates attributed work and atomic distinct activity/outbox records", async () => {
    const { uow, service } = setup();
    const task = await service.create(context, {
      title: "  中文  ",
      descriptionMd: "- [ ] plain checkbox",
    });
    expect(task).toMatchObject({
      title: "中文",
      version: 1,
      createdBy: "human",
      workspaceId: "workspace-a",
      status: "TODO",
    });
    expect((await service.snapshot(context)).items).toHaveLength(1);
    const events = await uow.inspectEvents(context.workspaceId);
    expect(events.activity).toHaveLength(1);
    expect(events.outbox).toHaveLength(1);
    expect(events.outbox[0]?.activityId).toBe(events.activity[0]?.id);
    expect(events.outbox[0]?.id).not.toBe(events.activity[0]?.id);
  });
  it("denies ungranted workspace, principal and mutation permissions", async () => {
    const { service } = setup(["work:read"]);
    await expect(service.create(context, { title: "x" })).rejects.toThrow(
      "FORBIDDEN",
    );
    await expect(
      service.snapshot({ ...context, workspaceId: "workspace-b" }),
    ).rejects.toThrow("FORBIDDEN");
    await expect(
      service.snapshot({ ...context, principalId: "agent" }),
    ).rejects.toThrow("FORBIDDEN");
  });
  it("rejects invalid input without emitting events", async () => {
    const { service, uow } = setup();
    await expect(service.create(context, { title: " " })).rejects.toThrow(
      "VALIDATION_ERROR",
    );
    expect((await uow.inspectEvents(context.workspaceId)).outbox).toEqual([]);
  });
  it("rejects stale writes without duplicate events", async () => {
    const { service, uow } = setup();
    const item = await service.create(context, { title: "x" });
    await service.update(context, item.id, 1, { title: "new" });
    await expect(
      service.update(context, item.id, 1, { title: "old" }),
    ).rejects.toThrow("VERSION_CONFLICT");
    expect(
      (await uow.inspectEvents(context.workspaceId)).activity,
    ).toHaveLength(2);
  });
  it("blocks starting and completing a dependent until its prerequisite is done", async () => {
    const { service } = setup();
    const a = await service.create(context, { title: "a" });
    const b = await service.create(context, { title: "b" });
    await service.addEdge(context, b.id, a.id, "REQUIRES");
    await expect(
      service.update(context, b.id, 1, { status: "IN_PROGRESS" }),
    ).rejects.toThrow("WORK_ITEM_BLOCKED");
    await expect(
      service.update(context, b.id, 1, { status: "DONE" }),
    ).rejects.toThrow("WORK_ITEM_BLOCKED");
    await service.update(context, a.id, 1, { status: "DONE" });
    const snapshot = await service.snapshot(context);
    expect(isReady(b, snapshot.items, snapshot.edges)).toBe(true);
    const completed = await service.update(context, b.id, 1, {
      status: "DONE",
    });
    expect(completed.completedAt).not.toBeNull();
    await expect(
      service.update(context, a.id, 2, { status: "TODO" }),
    ).rejects.toThrow("DEPENDENCY_EXISTS");
  });
  it("updates task prerequisites atomically and protects the read set", async () => {
    const { service } = setup();
    const prerequisite = await service.create(context, { title: "prepare" });
    const task = await service.create(context, { title: "deliver" });
    const updated = await service.update(context, task.id, 1, {
      prerequisiteIds: [prerequisite.id],
      expectedPrerequisiteIds: [],
    });
    expect(updated.version).toBe(2);
    let snapshot = await service.snapshot(context);
    expect(snapshot.edges.map((edge) => [edge.fromId, edge.toId])).toEqual([
      [prerequisite.id, task.id],
    ]);
    await expect(
      service.update(context, task.id, 2, {
        prerequisiteIds: [],
        expectedPrerequisiteIds: [],
      }),
    ).rejects.toThrow("VERSION_CONFLICT");
    await service.update(context, task.id, 2, {
      prerequisiteIds: [],
      expectedPrerequisiteIds: [prerequisite.id],
    });
    snapshot = await service.snapshot(context);
    expect(snapshot.edges).toHaveLength(0);
  });
  it("rejects project prerequisites and cycles through the inline command", async () => {
    const { service } = setup();
    const project = await service.create(context, {
      title: "project",
      type: "PROJECT",
    });
    const a = await service.create(context, { title: "a" });
    const b = await service.create(context, { title: "b" });
    await expect(
      service.update(context, a.id, 1, {
        prerequisiteIds: [project.id],
        expectedPrerequisiteIds: [],
      }),
    ).rejects.toThrow("VALIDATION_ERROR");
    await service.update(context, b.id, 1, {
      prerequisiteIds: [a.id],
      expectedPrerequisiteIds: [],
    });
    await expect(
      service.update(context, a.id, 1, {
        prerequisiteIds: [b.id],
        expectedPrerequisiteIds: [],
      }),
    ).rejects.toThrow("WORK_GRAPH_CYCLE_DETECTED");
  });
  it("rejects new blockers on already-started work", async () => {
    const { service } = setup();
    const a = await service.create(context, { title: "a" });
    const b = await service.create(context, { title: "b" });
    await service.update(context, b.id, 1, { status: "IN_PROGRESS" });
    await expect(service.addEdge(context, a.id, b.id)).rejects.toThrow(
      "WORK_ITEM_BLOCKED",
    );
  });
  it("serializes racing graph changes so a cycle cannot sneak through", async () => {
    const { service } = setup();
    const a = await service.create(context, { title: "a" });
    const b = await service.create(context, { title: "b" });
    const results = await Promise.allSettled([
      service.addEdge(context, a.id, b.id),
      service.addEdge(context, b.id, a.id),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect((await service.snapshot(context)).edges).toHaveLength(1);
  });
  it("requires disconnecting before trash and permits restoration without losing content", async () => {
    const { service } = setup();
    const a = await service.create(context, {
      title: "a",
      descriptionMd: "# original",
    });
    const b = await service.create(context, { title: "b" });
    const edge = await service.addEdge(context, a.id, b.id);
    await expect(service.setDeleted(context, a.id, 1, true)).rejects.toThrow(
      "DEPENDENCY_EXISTS",
    );
    await service.removeEdge(context, edge.id);
    await service.setDeleted(context, a.id, 1, true);
    expect((await service.snapshot(context)).items).toHaveLength(1);
    await expect(
      service.update(context, a.id, 2, { title: "hidden" }),
    ).rejects.toThrow("NOT_FOUND");
    const restored = await service.setDeleted(context, a.id, 2, false);
    expect(restored.descriptionMd).toBe("# original");
    expect(restored.version).toBe(3);
  });
});
