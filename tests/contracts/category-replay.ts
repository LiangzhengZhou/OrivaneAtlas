import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import {
  CategoryReplayUnitOfWork,
  CategoryService,
  type UnitOfWork,
} from "../../packages/application/src/index";
import type { ActorContext } from "../../packages/domain/src/index";

export async function categoryReplayScenario(
  run: <T>(
    actor: ActorContext,
    operation: (uow: UnitOfWork) => Promise<T>,
  ) => Promise<T>,
) {
  const actor = { workspaceId: "workspace-a", principalId: "human" },
    aId = randomUUID(),
    bId = randomUUID();
  const service = (uow: UnitOfWork) =>
    new CategoryService(
      uow,
      { require: async () => {} },
      { now: () => "2026-10-13T00:00:00Z" },
      { next: randomUUID },
    );
  const effect = (id: string, baseVersion: number) => ({
    collection: "categories" as const,
    id,
    op: "UPSERT" as const,
    baseVersion,
  });
  const a = await run(actor, async (uow) => {
    const guard = new CategoryReplayUnitOfWork(
      uow,
      actor.workspaceId,
      actor.principalId,
      [effect(aId, 0)],
    );
    const value = await service(guard).createWithStableId(actor, aId, {
      version: 0,
      name: "Stable A",
      deleted: false,
    });
    expect(guard.acceptedEffects).toEqual([
      { collection: "categories", id: aId, op: "UPSERT", version: 1, value },
    ]);
    return value;
  });
  expect(a).toMatchObject({
    id: aId,
    createdBy: actor.principalId,
    version: 1,
  });
  await expect(
    run(actor, (uow) =>
      service(uow).createWithStableId(actor, aId, {
        version: 0,
        name: "No overwrite",
        deleted: false,
      }),
    ),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  await run(actor, (uow) =>
    service(uow).createWithStableId(actor, bId, {
      version: 0,
      name: "Stable B",
      deleted: false,
    }),
  );
  const ordered = [
    { id: bId, version: 1 },
    { id: aId, version: 1 },
  ];
  await expect(
    run(actor, (uow) =>
      service(
        new CategoryReplayUnitOfWork(
          uow,
          actor.workspaceId,
          actor.principalId,
          [effect(bId, 1)],
        ),
      ).reorder(actor, ordered),
    ),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  expect(
    (await run(actor, (uow) => service(uow).list(actor))).every(
      (value) => value.version === 1 && value.position === 0,
    ),
  ).toBe(true);
  const changed = await run(actor, async (uow) => {
    const guard = new CategoryReplayUnitOfWork(
      uow,
      actor.workspaceId,
      actor.principalId,
      [effect(bId, 1), effect(aId, 1)],
    );
    const result = await service(guard).reorder(actor, ordered);
    expect(guard.acceptedEffects).toEqual(
      result.map((value) => ({
        collection: "categories",
        id: value.id,
        op: "UPSERT",
        version: 2,
        value,
      })),
    );
    return result;
  });
  expect(
    changed.map((value) => [value.id, value.position, value.version]),
  ).toEqual([
    [bId, 1024, 2],
    [aId, 2048, 2],
  ]);
  await expect(
    run(actor, (uow) =>
      service(
        new CategoryReplayUnitOfWork(
          uow,
          actor.workspaceId,
          actor.principalId,
          [effect(aId, 1)],
        ),
      ).save(actor, { id: aId, version: 1, name: "Stale", deleted: false }),
    ),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  const deleted = await run(actor, (uow) =>
    service(uow).save(actor, {
      id: aId,
      version: 2,
      name: "Stable A",
      deleted: true,
    }),
  );
  expect(deleted.deletedAt).not.toBeNull();
  await expect(
    run(actor, (uow) =>
      service(uow).createWithStableId(actor, aId, {
        version: 0,
        name: "No resurrection",
        deleted: false,
      }),
    ),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
}
