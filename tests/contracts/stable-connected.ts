import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import {
  ConnectedService,
  type ConnectedStore,
  LinkedKnowledgeReplayStore,
  type UnitOfWork,
  WorkService,
} from "../../packages/application/src/index";
import type { ActorContext } from "../../packages/domain/src/index";

export async function stableConnectedScenario(
  run: <T>(
    actor: ActorContext,
    operation: (uow: UnitOfWork, connected: ConnectedStore) => Promise<T>,
  ) => Promise<T>,
) {
  const actor = { workspaceId: "workspace-a", principalId: "human" },
    auth = { require: async () => {} },
    clock = { now: () => "2026-10-14T00:00:00Z" },
    ids = { next: randomUUID };
  const tasks = await run(actor, async (uow) => {
    const work = new WorkService(uow, auth, clock, ids);
    return [
      await work.create(actor, { title: "A" }),
      await work.create(actor, { title: "B" }),
    ];
  });
  const from = { kind: "WORK" as const, id: tasks[0]!.id },
    to = { kind: "WORK" as const, id: tasks[1]!.id },
    stableId = randomUUID();
  let escaped: ConnectedStore | undefined;
  const effect = {
    collection: "links" as const,
    id: stableId,
    op: "UPSERT" as const,
    baseVersion: 0,
  };
  await expect(
    run(actor, async (_uow, store) => {
      const guard = new LinkedKnowledgeReplayStore(
        actor.workspaceId,
        actor.principalId,
        [effect, { ...effect, id: randomUUID() }],
      );
      return guard.run(store, (guarded) =>
        new ConnectedService(guarded, auth, clock, ids).linkWithStableId(
          actor,
          stableId,
          from,
          to,
          "REFERENCES",
        ),
      );
    }),
  ).rejects.toThrow("VERSION_CONFLICT");
  await run(actor, async (_uow, store) => {
    escaped = store;
    const service = new ConnectedService(store, auth, clock, ids);
    const guard = new LinkedKnowledgeReplayStore(
      actor.workspaceId,
      actor.principalId,
      [effect],
    );
    const link = await guard.run(store, (guarded) =>
      new ConnectedService(guarded, auth, clock, ids).linkWithStableId(
        actor,
        stableId,
        from,
        to,
        "REFERENCES",
      ),
    );
    expect(guard.acceptedEffects).toEqual([
      {
        collection: "links",
        id: stableId,
        op: "UPSERT",
        version: 1,
        value: link,
      },
    ]);
    expect(link).toMatchObject({ id: stableId, version: 1, from, to });
    await expect(
      service.linkWithStableId(actor, stableId, from, to, "REFERENCES"),
    ).rejects.toThrow("VERSION_CONFLICT");
    await expect(service.unlink(actor, stableId, 0)).rejects.toThrow(
      "VERSION_CONFLICT",
    );
    expect((await store.links())[0]?.deletedAt).toBeNull();
    await service.unlink(actor, stableId, 1);
    await expect(
      service.linkWithStableId(actor, stableId, from, to, "RELATED"),
    ).rejects.toThrow("VERSION_CONFLICT");
  });
  await expect(escaped!.links()).rejects.toThrow("TRANSACTION_CLOSED");
  const rolledBackId = randomUUID();
  await expect(
    run(actor, async (_uow, store) => {
      await new ConnectedService(store, auth, clock, ids).linkWithStableId(
        actor,
        rolledBackId,
        from,
        to,
        "RELATED",
      );
      throw new Error("ROLLBACK_CONNECTED_COMMAND");
    }),
  ).rejects.toThrow("ROLLBACK_CONNECTED_COMMAND");
  const runId = await run(actor, async (_uow, store) => {
    expect((await store.links()).map((link) => link.id)).toEqual([stableId]);
    const proposed = await new ConnectedService(
      store,
      auth,
      clock,
      ids,
    ).propose(actor, "Original private prompt", {
      fingerprint: "fixture",
      provider: "fixture",
      model: "fixture",
      maxInputChars: 100,
      maxOutputTokens: 50,
      timeoutMs: 1000,
      maxRunsPerDay: 5,
    });
    expect(await store.getRun(proposed.id)).toEqual(proposed);
    expect(proposed.status).toBe("WAITING_APPROVAL");
    return proposed.id;
  });
  await run({ ...actor, workspaceId: "workspace-b" }, async (_uow, store) => {
    expect(await store.links()).toEqual([]);
    expect(await store.runs()).toEqual([]);
    expect(await store.exists(from)).toBe(false);
    await expect(store.getRun(runId)).rejects.toThrow("NOT_FOUND");
  });
}
