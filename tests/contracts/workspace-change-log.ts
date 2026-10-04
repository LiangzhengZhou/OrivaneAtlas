import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import {
  type UnitOfWork,
  WorkService,
} from "../../packages/application/src/index";
import type { ActorContext } from "../../packages/domain/src/index";

export async function workspaceChangeScenario(
  run: <T>(
    actor: ActorContext,
    operation: (uow: UnitOfWork) => Promise<T>,
  ) => Promise<T>,
  restart: () => Promise<void>,
) {
  const actor = { workspaceId: "workspace-a", principalId: "human" };
  const work = (uow: UnitOfWork) =>
    new WorkService(
      uow,
      { require: async () => {} },
      { now: () => "2026-10-04T00:00:00Z" },
      { next: randomUUID },
    );
  const page = (after: number, epoch?: string) =>
    run(actor, (uow) =>
      uow.run(actor.workspaceId, (tx) => tx.workspaceChanges(after, epoch)),
    );
  const before = await page(0);
  const project = await run(actor, (uow) =>
    work(uow).create(actor, { title: "Project", type: "PROJECT" }),
  );
  const task = await run(actor, (uow) =>
    work(uow).create(actor, { title: "Task", projectIds: [project.id] }),
  );
  const changes = await page(before.cursor, before.epoch);
  expect(changes.recovery).toBe(false);
  expect(changes.changes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        workspaceId: actor.workspaceId,
        collection: "items",
        entityId: task.id,
        op: "UPSERT",
        version: 1,
      }),
    ]),
  );
  expect(
    await run(actor, (uow) =>
      uow.run(actor.workspaceId, (tx) => tx.workspaceEntity("items", task.id)),
    ),
  ).toMatchObject({
    id: task.id,
    projectIds: [project.id],
    title: "Task",
    version: 1,
  });
  await restart();
  expect(await page(before.cursor, before.epoch)).toEqual(changes);
  expect((await page(changes.cursor, changes.epoch)).changes).toEqual([]);
  expect((await page(changes.cursor + 100000, changes.epoch)).recovery).toBe(
    true,
  );
  expect((await page(changes.cursor, "different-database")).recovery).toBe(
    true,
  );
  const foreign = { ...actor, workspaceId: "workspace-b" };
  expect(
    (
      await run(foreign, (uow) =>
        uow.run(foreign.workspaceId, (tx) => tx.workspaceChanges(0)),
      )
    ).changes,
  ).toEqual([]);
  await expect(
    run(actor, (uow) =>
      uow.run(actor.workspaceId, async (tx) => {
        const entity = await tx.get(task.id);
        await tx.replace({ ...entity, title: "Rollback", version: 2 }, 1);
        throw new Error("ROLLBACK");
      }),
    ),
  ).rejects.toThrow("ROLLBACK");
  expect((await page(changes.cursor, changes.epoch)).changes).toEqual([]);
  const deleted = await run(actor, (uow) =>
    work(uow).setDeleted(actor, task.id, 1, true),
  );
  const soft = await page(changes.cursor, changes.epoch);
  expect(soft.changes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ entityId: task.id, op: "UPSERT", version: 2 }),
    ]),
  );
  expect(
    await run(actor, (uow) =>
      uow.run(actor.workspaceId, (tx) => tx.workspaceEntity("items", task.id)),
    ),
  ).toMatchObject({ deletedAt: deleted.deletedAt });
  await run(actor, (uow) => work(uow).purge(actor, task.id, deleted.version));
  const purged = await page(soft.cursor, soft.epoch);
  expect(purged.changes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ entityId: task.id, op: "DELETE" }),
    ]),
  );
  expect(
    await run(actor, (uow) =>
      uow.run(actor.workspaceId, (tx) => tx.workspaceEntity("items", task.id)),
    ),
  ).toBeNull();
  expect(await page(soft.cursor, soft.epoch)).toEqual(purged);
  for (let index = 0; index < 501; index++) {
    await run(actor, (uow) =>
      work(uow).create(actor, { title: `Paged change ${index}` }),
    );
  }
  const first = await page(purged.cursor, purged.epoch);
  expect(first.recovery).toBe(false);
  expect(first.hasMore).toBe(true);
  expect(first.changes).toHaveLength(500);
  const second = await page(first.cursor, first.epoch);
  expect(second.hasMore).toBe(false);
  expect(second.changes).toHaveLength(1);
  expect(
    new Set([...first.changes, ...second.changes].map((change) => change.seq))
      .size,
  ).toBe(501);
  await restart();
  expect(await page(first.cursor, first.epoch)).toEqual(second);
}
