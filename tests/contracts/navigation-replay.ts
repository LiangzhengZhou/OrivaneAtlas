import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import {
  NavigationReplayUnitOfWork,
  type UnitOfWork,
  WorkService,
} from "../../packages/application/src/index";
import {
  type ActorContext,
  defaultNavigationPreference,
} from "../../packages/domain/src/index";

export async function navigationReplayScenario(
  run: <T>(
    actor: ActorContext,
    operation: (uow: UnitOfWork) => Promise<T>,
  ) => Promise<T>,
) {
  const actor = { workspaceId: "workspace-a", principalId: "human" };
  const guard = (uow: UnitOfWork, version: number) =>
    new NavigationReplayUnitOfWork(uow, actor.workspaceId, actor.principalId, [
      {
        collection: "navigationPreference",
        id: actor.principalId,
        op: "UPSERT",
        baseVersion: version,
      },
    ]);
  const service = (uow: UnitOfWork) =>
    new WorkService(
      uow,
      { require: async () => {} },
      { now: () => "2026-10-13T00:00:00Z" },
      { next: randomUUID },
    );
  const input = defaultNavigationPreference();
  const created = await run(actor, async (uow) => {
    const guarded = guard(uow, 0),
      value = await service(guarded).setNavigationPreference(actor, input);
    expect(guarded.acceptedEffects).toEqual([
      {
        collection: "navigationPreference",
        id: actor.principalId,
        op: "UPSERT",
        version: 1,
        value,
      },
    ]);
    return value;
  });
  expect(
    await run(actor, (uow) =>
      service(guard(uow, 1)).moveNavigationPreference(actor, {
        version: 1,
        movingId: "focus",
        anchorId: "tasks",
        placement: "BEFORE",
      }),
    ),
  ).toMatchObject({ version: 2 });
  await expect(
    run(actor, (uow) =>
      service(guard(uow, 1)).setNavigationPreference(actor, {
        ...input,
        version: 1,
      }),
    ),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  await expect(
    run(actor, (uow) =>
      guard(uow, 2).run(actor.workspaceId, (tx) =>
        tx.saveNavigationPreference("foreign", { ...created, version: 3 }, 2),
      ),
    ),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  await expect(
    run(actor, (uow) =>
      guard(uow, 2).run(actor.workspaceId, async (tx) => {
        await tx.saveNavigationPreference(
          actor.principalId,
          { ...created, version: 3 },
          2,
        );
        await tx.removeEdge(randomUUID());
      }),
    ),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  expect(
    await run(actor, (uow) =>
      uow.run(actor.workspaceId, (tx) =>
        tx.navigationPreference(actor.principalId),
      ),
    ),
  ).toMatchObject({ version: 2 });
  expect(
    await run(actor, (uow) =>
      uow.run(actor.workspaceId, (tx) => tx.navigationPreference("foreign")),
    ),
  ).toEqual(defaultNavigationPreference());
}
