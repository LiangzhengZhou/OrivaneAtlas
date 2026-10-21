import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import {
  EntityMemoService,
  type EntityMemoTransaction,
} from "../../packages/application/src/entity-memos";
import {
  type UnitOfWork,
  WorkService,
} from "../../packages/application/src/index";
import type { ActorContext } from "../../packages/domain/src/index";

/** Exercise actual database integer storage beyond PostgreSQL's int32 range. */
export async function entityMemoLargeVersionScenario(
  run: <T>(
    actor: ActorContext,
    operation: (memos: EntityMemoTransaction, work: UnitOfWork) => Promise<T>,
  ) => Promise<T>,
  seedVersion: (id: string, version: number) => Promise<void>,
) {
  const actor = { workspaceId: "workspace-a", principalId: "human" };
  const auth = { require: async () => {} };
  const clock = { now: () => "2026-10-16T00:00:00.000Z" };
  const target = await run(actor, (_memos, work) =>
    new WorkService(work, auth, clock, { next: randomUUID }).create(actor, {
      type: "TASK",
      title: "High-version memo target",
    }),
  );
  const service = new EntityMemoService(
    { run: (context, operation) => run(context, (memos) => operation(memos)) },
    auth,
    clock,
    { forTarget: async () => randomUUID(), nextChangeId: randomUUID },
  );
  const input = {
    targetKind: "TASK" as const,
    targetId: target.id,
    bodyMd: "Original\n",
    aiPolicy: {
      classification: "PRIVATE",
      processingBoundary: "ANY",
      aiAccess: "ASK",
    } as const,
  };
  const first = await service.save(actor, input, 0);
  for (const version of [2 ** 31, Number.MAX_SAFE_INTEGER - 1]) {
    await seedVersion(first!.id, version);
    expect(await service.get(actor, input)).toMatchObject({ version });
    const next = await service.save(
      actor,
      { ...input, bodyMd: "Exact high-version draft\n" },
      version,
    );
    expect(next).toMatchObject({
      id: first!.id,
      version: version + 1,
      aiPolicy: input.aiPolicy,
    });
    await expect(service.save(actor, input, version)).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
    });
    expect(await service.get(actor, input)).toEqual(next);
  }
  await expect(
    service.save(actor, input, Number.MAX_SAFE_INTEGER),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  expect(await service.get(actor, input)).toMatchObject({
    version: Number.MAX_SAFE_INTEGER,
  });
  return { actor, input, memo: await service.get(actor, input) };
}

export async function entityMemoScenario(
  run: <T>(
    actor: ActorContext,
    operation: (memos: EntityMemoTransaction, work: UnitOfWork) => Promise<T>,
  ) => Promise<T>,
  inspect: () => Promise<{
    rows: number;
    activities: string[];
    outbox: number;
  }>,
) {
  const actor = { workspaceId: "workspace-a", principalId: "human" };
  const other = { ...actor, principalId: "other" };
  const auth = { require: async () => {} };
  const clock = { now: () => "2026-10-16T00:00:00.000Z" };
  const work = <T>(operation: (service: WorkService) => Promise<T>) =>
    run(actor, (_memo, uow) =>
      operation(new WorkService(uow, auth, clock, { next: randomUUID })),
    );
  const service = (fail = false) =>
    new EntityMemoService(
      {
        run: (context, operation) =>
          run(context, async (tx) =>
            operation(
              fail
                ? {
                    ...tx,
                    appendChange: async (event) => {
                      await tx.appendChange(event);
                      throw new Error("AFTER_MEMO_OUTBOX");
                    },
                  }
                : tx,
            ),
          ),
      },
      auth,
      clock,
      { forTarget: async () => randomUUID(), nextChangeId: randomUUID },
    );
  const target = await work((s) =>
    s.create(actor, { type: "TASK", title: "Memo target" }),
  );
  const input = {
    targetKind: "TASK" as const,
    targetId: target.id,
    bodyMd: "Private\noriginal\n",
  };
  const first = await service().save(actor, input, 0);
  expect(await service().get(actor, input)).toEqual(first);
  await service().save(actor, { ...input, bodyMd: "Exact revision\n" }, 1);
  await expect(service().save(actor, input, 1)).rejects.toMatchObject({
    code: "VERSION_CONFLICT",
  });
  await service().save(actor, input, 2, true);
  expect(await service().get(actor, input)).toBeNull();
  const restored = await service().save(actor, input, 3);
  expect(restored).toMatchObject({
    id: first!.id,
    version: 4,
    bodyMd: input.bodyMd,
  });
  expect(await service().get(other, input)).toBeNull();
  expect(
    await service().get({ ...actor, workspaceId: "workspace-b" }, input),
  ).toBeNull();
  const otherMemo = await service().save(
    other,
    { ...input, bodyMd: "Other private memo" },
    0,
  );
  expect(otherMemo!.id).not.toBe(first!.id);
  expect(await service().get(actor, input)).toEqual(restored);
  const before = await inspect();
  expect(before).toMatchObject({ rows: 2, outbox: 5 });
  expect(before.activities).toHaveLength(5);
  expect(before.activities.join(" ")).not.toContain("bodyMd");
  await expect(
    service(true).save(actor, { ...input, bodyMd: "Aborted private draft" }, 4),
  ).rejects.toThrow("AFTER_MEMO_OUTBOX");
  expect(await inspect()).toEqual(before);
  expect(await service().get(actor, input)).toEqual(restored);
  const deleted = await work((s) =>
    s.setDeleted(actor, target.id, target.version, true),
  );
  expect(await service().get(actor, input)).toBeNull();
  const reopened = await work((s) =>
    s.setDeleted(actor, target.id, deleted.version, false),
  );
  expect(await service().get(actor, input)).toEqual(restored);
  await run(actor, async (_memos, uow) => {
    const page = await uow.run(actor.workspaceId, (tx) =>
      tx.workspaceChanges(0),
    );
    expect(
      page.changes.some((change) => change.collection === "entityMemos"),
    ).toBe(false);
    await uow.run(actor.workspaceId, async (tx) => {
      expect(await tx.workspaceEntity("entityMemos", first!.id)).toBeNull();
      expect(
        await tx.workspaceEntity("entityMemos", first!.id, other.principalId),
      ).toBeNull();
      expect(
        await tx.workspaceEntity("entityMemos", first!.id, actor.principalId),
      ).toEqual(restored);
      const privatePage = await tx.workspaceChanges(
        0,
        undefined,
        actor.principalId,
      );
      const privateChanges = privatePage.changes.filter(
        (change) => change.collection === "entityMemos",
      );
      expect(privateChanges).toHaveLength(4);
      expect(
        privateChanges.every((change) => change.entityId === first!.id),
      ).toBe(true);
      expect(privatePage.cursor).toBeGreaterThanOrEqual(page.cursor);
    });
  });
  const deletedAgain = await work((s) =>
    s.setDeleted(actor, target.id, reopened.version, true),
  );
  await work((s) => s.purge(actor, target.id, deletedAgain.version));
  expect(await service().get(actor, input)).toBeNull();
  expect(await inspect()).toMatchObject({ rows: 0, outbox: 5 });
}
