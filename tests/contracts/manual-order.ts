import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import {
  ManualOrderReplayUnitOfWork,
  ManualOrderService,
  type UnitOfWork,
} from "../../packages/application/src/index";
import { work } from "../fixtures";

export function manualOrderContract(
  name: string,
  create: () => Promise<UnitOfWork> | UnitOfWork,
) {
  test(
    name + ": sequence import is atomic, versioned and preserves other members",
    async () => {
      const uow = await create(),
        actor = { workspaceId: "workspace-a", principalId: "human" };
      await uow.run(actor.workspaceId, async (tx) => {
        for (const id of ["a", "b", "c", "d"]) await tx.insert(work(id));
      });
      const orders = new ManualOrderService(
        uow,
        { require: async () => {} },
        { now: () => "2026-10-15T00:00:00Z" },
        { next: randomUUID },
      );
      const scope = { kind: "WORKSPACE_TASKS" } as const;
      const first = await orders.placeSequence(actor, {
        scope,
        version: 0,
        orderedEntityIds: ["d", "b"],
      });
      expect(first.version).toBe(1);
      expect(first.entries.map((entry) => entry.entityId)).toEqual([
        "a",
        "c",
        "d",
        "b",
      ]);
      expect(
        await orders.placeSequence(actor, {
          scope,
          version: 1,
          orderedEntityIds: ["d", "b"],
        }),
      ).toEqual(first);
      await expect(
        orders.placeSequence(actor, {
          scope,
          version: 0,
          orderedEntityIds: ["b", "d"],
        }),
      ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
      await expect(
        orders.placeSequence(actor, {
          scope,
          version: 1,
          orderedEntityIds: ["d", "missing"],
        }),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect(await orders.list(actor)).toEqual([first]);
    },
  );
  test(`${name}: original order replay guards aggregate versions and rolls back undeclared writes`, async () => {
    const uow = await create(),
      actor = { workspaceId: "workspace-a", principalId: "human" };
    await uow.run(actor.workspaceId, async (tx) => {
      await tx.insert(work("a"));
      await tx.insert(work("b"));
    });
    const effect = {
      collection: "manualOrders" as const,
      id: "WORKSPACE_TASKS",
      op: "UPSERT" as const,
      baseVersion: 0,
    };
    const guard = new ManualOrderReplayUnitOfWork(uow, actor.workspaceId, [
      effect,
    ]);
    const service = (unit: UnitOfWork) =>
      new ManualOrderService(
        unit,
        { require: async () => {} },
        { now: () => "2026-10-13T00:00:00Z" },
        { next: randomUUID },
      );
    const input = {
      scope: { kind: "WORKSPACE_TASKS" as const },
      version: 0,
      entityId: "b",
      anchorId: "a",
      placement: "BEFORE" as const,
    };
    const state = await service(guard).move(actor, input);
    expect(state.entries.map((entry) => entry.entityId)).toEqual(["b", "a"]);
    expect(guard.acceptedEffects).toEqual([
      {
        collection: "manualOrders",
        id: "WORKSPACE_TASKS",
        op: "UPSERT",
        version: 1,
        value: state,
      },
    ]);
    await expect(
      service(
        new ManualOrderReplayUnitOfWork(uow, actor.workspaceId, [effect]),
      ).move(actor, { ...input, version: 1 }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(
      new ManualOrderReplayUnitOfWork(uow, actor.workspaceId, [
        { ...effect, baseVersion: 1 },
      ]).run(actor.workspaceId, async (tx) => {
        await tx.saveManualOrder({ ...state, version: 2 }, 1);
        await tx.removeEdge(randomUUID());
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await uow.run(actor.workspaceId, (tx) => tx.manualOrders())).toEqual(
      [state],
    );
  });
  test(`${name}: subtree presentation has its own order while child and root sibling scopes remain independent`, async () => {
    const uow = await create();
    const actor = { workspaceId: "workspace-a", principalId: "human" };
    const orders = new ManualOrderService(
      uow,
      { require: async () => {} },
      { now: () => "2026-10-11T00:00:00Z" },
      { next: randomUUID },
    );
    await uow.run(actor.workspaceId, async (tx) => {
      await tx.insert({ ...work("root"), type: "PROJECT" });
      await tx.insert({ ...work("sibling"), type: "PROJECT" });
      await tx.insert({
        ...work("child"),
        type: "PROJECT",
        parentProjectId: "root",
      });
      await tx.insert({ ...work("direct"), projectIds: ["root"] });
      await tx.insert({ ...work("nested"), projectIds: ["child"] });
    });
    const parent = await orders.move(actor, {
      scope: { kind: "PROJECT_TASKS", projectId: "root" },
      version: 0,
      entityId: "nested",
      anchorId: "direct",
      placement: "BEFORE",
    });
    expect(parent.entries.map((entry) => entry.entityId)).toEqual([
      "nested",
      "direct",
    ]);
    const child = await orders.move(actor, {
      scope: { kind: "PROJECT_TASKS", projectId: "child" },
      version: 0,
      entityId: "nested",
      anchorId: null,
      placement: "AFTER",
    });
    expect(child.entries.map((entry) => entry.entityId)).toEqual(["nested"]);
    await expect(
      orders.move(actor, {
        scope: child.scope,
        version: 1,
        entityId: "direct",
        anchorId: "nested",
        placement: "BEFORE",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const siblings = await orders.move(actor, {
      scope: { kind: "PROJECT_CHILDREN", parentProjectId: null },
      version: 0,
      entityId: "sibling",
      anchorId: "root",
      placement: "BEFORE",
    });
    expect(siblings.entries.map((entry) => entry.entityId)).toEqual([
      "sibling",
      "root",
    ]);
    await expect(
      orders.move(actor, {
        scope: siblings.scope,
        version: 1,
        entityId: "child",
        anchorId: "root",
        placement: "BEFORE",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(
      (await orders.list(actor)).find((state) => state.id === parent.id),
    ).toEqual(parent);
  });
  test(`${name}: manual order isolates multi-project membership and commits durable changes`, async () => {
    const uow = await create();
    const actor = { workspaceId: "workspace-a", principalId: "human" };
    const orders = new ManualOrderService(
      uow,
      { require: async () => {} },
      { now: () => "2026-10-11T00:00:00Z" },
      { next: randomUUID },
    );
    await uow.run(actor.workspaceId, async (tx) => {
      await tx.insert({ ...work("p"), type: "PROJECT" });
      await tx.insert({ ...work("q"), type: "PROJECT" });
      for (const id of ["a", "b", "c"])
        await tx.insert({ ...work(id), projectIds: ["p", "q"] });
      await tx.insert({ ...work("outside"), projectIds: [] });
    });
    const p = { kind: "PROJECT_TASKS", projectId: "p" } as const;
    const q = { kind: "PROJECT_TASKS", projectId: "q" } as const;
    const first = await orders.move(actor, {
      scope: p,
      version: 0,
      entityId: "c",
      anchorId: "b",
      placement: "BEFORE",
    });
    expect(first.entries.map((entry) => entry.entityId)).toEqual([
      "a",
      "c",
      "b",
    ]);
    const second = await orders.move(actor, {
      scope: q,
      version: 0,
      entityId: "a",
      anchorId: null,
      placement: "AFTER",
    });
    expect(second.entries.map((entry) => entry.entityId)).toEqual([
      "b",
      "c",
      "a",
    ]);
    expect(
      (await orders.list(actor)).find((state) => state.id === first.id),
    ).toEqual(first);
    await expect(
      orders.move(actor, {
        scope: p,
        version: 0,
        entityId: "a",
        anchorId: null,
        placement: "AFTER",
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(
      orders.move(actor, {
        scope: p,
        version: 1,
        entityId: "outside",
        anchorId: "a",
        placement: "BEFORE",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const before = await uow.run(actor.workspaceId, (tx) =>
      tx.workspaceChanges(0),
    );
    expect(
      await orders.move(actor, {
        scope: p,
        version: 1,
        entityId: "c",
        anchorId: "b",
        placement: "BEFORE",
      }),
    ).toEqual(first);
    expect(
      await uow.run(actor.workspaceId, (tx) => tx.workspaceChanges(0)),
    ).toEqual(before);
    expect(
      await uow.run(actor.workspaceId, (tx) =>
        tx.workspaceEntity("manualOrders", first.id),
      ),
    ).toEqual(first);
    expect(
      before.changes.filter((change) => change.collection === "manualOrders"),
    ).toHaveLength(2);
    expect(await orders.list({ ...actor, workspaceId: "workspace-b" })).toEqual(
      [],
    );
  });
}
