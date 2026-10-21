import { expect } from "vitest";
import {
  OrganizationReplayStore,
  type UnitOfWork,
} from "../../packages/application/src/index";
import type { ActorContext } from "../../packages/domain/src/index";

export async function organizationReplayScenario(
  run: <T>(
    actor: ActorContext,
    operation: (uow: UnitOfWork) => Promise<T>,
  ) => Promise<T>,
) {
  const actor = { workspaceId: "workspace-a", principalId: "human" };
  const effect = (id: string, baseVersion: number) => ({
    collection: "organization" as const,
    id: `WORK:${id}`,
    op: "UPSERT" as const,
    baseVersion,
  });
  const value = (id: string, version: number) => ({
    ...actor,
    kind: "WORK" as const,
    id,
    version,
    archived: true,
    folder: "",
    updatedAt: "2026-10-13T00:00:00Z",
    updatedBy: actor.principalId,
  });
  await expect(
    run(actor, (uow) =>
      uow.run(actor.workspaceId, async (tx) => {
        const guard = new OrganizationReplayStore(
          {
            list: () => tx.organizations(),
            save: (entity, expected) => tx.saveOrganization(entity, expected),
          },
          actor.workspaceId,
          actor.principalId,
          [effect("a", 0)],
        );
        await guard.save(value("a", 1), 0);
        await guard.save(value("b", 1), 0);
        await guard.finish();
      }),
    ),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  expect(
    await run(actor, (uow) =>
      uow.run(actor.workspaceId, (tx) => tx.organizations()),
    ),
  ).toEqual([]);
  const accepted = await run(actor, (uow) =>
    uow.run(actor.workspaceId, async (tx) => {
      const guard = new OrganizationReplayStore(
        {
          list: () => tx.organizations(),
          save: (entity, expected) => tx.saveOrganization(entity, expected),
        },
        actor.workspaceId,
        actor.principalId,
        [effect("a", 0), effect("b", 0)],
      );
      await guard.save(value("a", 1), 0);
      await guard.save(value("b", 1), 0);
      await guard.finish();
      return guard.acceptedEffects;
    }),
  );
  expect(accepted).toEqual([
    expect.objectContaining({ id: "WORK:a", version: 1 }),
    expect.objectContaining({ id: "WORK:b", version: 1 }),
  ]);
  await expect(
    run(actor, (uow) =>
      uow.run(actor.workspaceId, async (tx) => {
        const guard = new OrganizationReplayStore(
          {
            list: () => tx.organizations(),
            save: (entity, expected) => tx.saveOrganization(entity, expected),
          },
          actor.workspaceId,
          actor.principalId,
          [effect("a", 0)],
        );
        await guard.save(value("a", 1), 0);
      }),
    ),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  expect(
    (
      await run(actor, (uow) =>
        uow.run(actor.workspaceId, (tx) => tx.organizations()),
      )
    ).map((entry) => entry.version),
  ).toEqual([1, 1]);
}
