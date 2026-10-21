import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  type MutationReceipt,
  mutationReceiptDigest,
  type UnitOfWork,
  WorkReplayUnitOfWork,
  WorkService,
} from "../../packages/application/src/index";
import type { ActorContext } from "../../packages/domain/src/index";

export interface ReceiptRunner {
  lookupReviewed(
    actor: ActorContext,
    commandId: string,
    proof: string,
  ): Promise<unknown | null>;
  lookup(
    actor: ActorContext,
    commandId: string,
    deviceId: string,
  ): Promise<unknown | null>;
  <T>(
    actor: ActorContext,
    receipt: MutationReceipt | null,
    operation: (uow: UnitOfWork) => Promise<T>,
  ): Promise<T>;
}

export function mutationReceiptContract(
  name: string,
  create: () => Promise<ReceiptRunner>,
) {
  it(`${name} atomically guards reviewed workspace revisions and retains successful retry receipts`, async () => {
    const run = await create();
    const actor = { workspaceId: "workspace-a", principalId: "human" };
    const changes = () =>
      run(actor, null, (uow) =>
        uow.run(actor.workspaceId, (tx) => tx.workspaceChanges(0)),
      );
    const before = await changes();
    const receipt = {
      key: randomUUID(),
      digest: "a".repeat(64),
      workspacePrecondition: { epoch: before.epoch, cursor: before.cursor },
    };
    let executions = 0;
    const operation = async (uow: UnitOfWork) => {
      executions++;
      return new WorkService(
        uow,
        { require: async () => {} },
        { now: () => "2026-10-15T00:00:00Z" },
        { next: () => randomUUID() },
      ).createWithStableId(actor, randomUUID(), { title: "Reviewed import" });
    };
    const accepted = await run(actor, receipt, operation);
    const after = await changes();
    const proof = mutationReceiptDigest(receipt);
    expect(await run.lookupReviewed(actor, receipt.key, proof)).toEqual(
      accepted,
    );
    expect(await run.lookupReviewed(actor, randomUUID(), proof)).toBeNull();
    expect(
      await run.lookupReviewed(
        actor,
        receipt.key,
        JSON.stringify(["b".repeat(64), before.epoch, before.cursor]),
      ),
    ).toBeNull();
    await expect(
      run.lookupReviewed(
        { ...actor, principalId: "unknown" },
        receipt.key,
        proof,
      ),
    ).rejects.toThrow("FORBIDDEN");
    const legacy = { key: randomUUID(), digest: "legacy" };
    await run(actor, legacy, async () => ({
      secret: "Never exposed through review",
    }));
    expect(await run.lookupReviewed(actor, legacy.key, proof)).toBeNull();
    expect(() => run.lookupReviewed(actor, receipt.key, "legacy")).toThrow(
      "VALIDATION_ERROR",
    );
    expect(after.cursor).toBeGreaterThan(before.cursor);
    expect(await run(actor, receipt, operation)).toEqual(accepted);
    expect(executions).toBe(1);
    await expect(
      run(actor, { ...receipt, key: randomUUID() }, operation),
    ).rejects.toThrow("VERSION_CONFLICT");
    await expect(
      run(
        actor,
        {
          ...receipt,
          workspacePrecondition: {
            epoch: after.epoch,
            cursor: after.cursor,
          },
        },
        operation,
      ),
    ).rejects.toThrow("VERSION_CONFLICT");
    await expect(
      run(
        actor,
        {
          ...receipt,
          key: randomUUID(),
          workspacePrecondition: {
            epoch: "obsolete-epoch",
            cursor: after.cursor,
          },
        },
        operation,
      ),
    ).rejects.toThrow("VERSION_CONFLICT");
    expect(await changes()).toEqual(after);
    expect(executions).toBe(1);
  });

  it(`${name} looks up only authenticated device-scoped receipts without business writes`, async () => {
    const run = await create();
    const actor = { workspaceId: "workspace-a", principalId: "human" };
    const receipt = {
      key: randomUUID(),
      digest: "lookup",
      deviceId: randomUUID(),
    };
    const original = { commandId: receipt.key, value: "原文\nunchanged" };
    await run(actor, receipt, async () => original);
    const before = await run(actor, null, (uow) =>
      uow.run(actor.workspaceId, (tx) => tx.workspaceChanges(0)),
    );
    expect(await run.lookup(actor, receipt.key, receipt.deviceId)).toEqual(
      original,
    );
    expect(await run.lookup(actor, receipt.key, randomUUID())).toBeNull();
    expect(await run.lookup(actor, randomUUID(), receipt.deviceId)).toBeNull();
    await expect(
      run.lookup(
        { ...actor, principalId: "unknown" },
        receipt.key,
        receipt.deviceId,
      ),
    ).rejects.toThrow("FORBIDDEN");
    const secretKey = randomUUID();
    await run(actor, { key: secretKey, digest: "secret-once" }, async () => ({
      secret: "test-only",
    }));
    expect(await run.lookup(actor, secretKey, receipt.deviceId)).toBeNull();
    expect(
      await run(actor, null, (uow) =>
        uow.run(actor.workspaceId, (tx) => tx.workspaceChanges(0)),
      ),
    ).toEqual(before);
  });

  it(`${name} retains exact canonical grouped receipts after later remote edits`, async () => {
    const run = await create();
    const actor = { workspaceId: "workspace-a", principalId: "human" };
    const taskId = randomUUID();
    const make = (uow: UnitOfWork) =>
      new WorkService(
        uow,
        { require: async () => {} },
        { now: () => "2026-10-13T00:00:00Z" },
        { next: () => randomUUID() },
      );
    await run(actor, null, (uow) =>
      make(uow).createWithStableId(actor, taskId, { title: "Before" }),
    );
    const receipt = {
      key: randomUUID(),
      digest: "canonical-original",
      deviceId: randomUUID(),
    };
    let executions = 0;
    const operation = async (uow: UnitOfWork) => {
      executions++;
      const guarded = new WorkReplayUnitOfWork(uow, actor.workspaceId, [
        { collection: "items", id: taskId, op: "UPSERT", baseVersion: 1 },
      ]);
      const result = await make(guarded).update(actor, taskId, 1, {
        title: "Accepted",
      });
      return {
        commandId: receipt.key,
        deviceId: receipt.deviceId,
        result,
        effects: guarded.acceptedEffects,
      };
    };
    const accepted = await run(actor, receipt, operation);
    expect(accepted.effects).toEqual([
      expect.objectContaining({
        collection: "items",
        id: taskId,
        version: 2,
        value: expect.objectContaining({
          title: "Accepted",
          createdBy: actor.principalId,
          workspaceId: actor.workspaceId,
        }),
      }),
    ]);
    await run(actor, null, (uow) =>
      make(uow).update(actor, taskId, 2, { title: "New remote value" }),
    );
    const [first, second] = await Promise.all([
      run(actor, receipt, operation),
      run(actor, receipt, operation),
    ]);
    expect(first).toEqual(accepted);
    expect(second).toEqual(accepted);
    expect(executions).toBe(1);
    const snapshot = await run(actor, null, (uow) =>
      make(uow).snapshot(actor, true),
    );
    expect(snapshot.items.find((item) => item.id === taskId)).toMatchObject({
      version: 3,
      title: "New remote value",
    });
    const beforeChanges = await run(actor, null, (uow) =>
      uow.run(actor.workspaceId, (tx) => tx.workspaceChanges(0)),
    );
    await expect(
      run(actor, { ...receipt, key: randomUUID() }, async (uow) =>
        make(
          new WorkReplayUnitOfWork(uow, actor.workspaceId, [
            { collection: "items", id: taskId, op: "UPSERT", baseVersion: 3 },
            {
              collection: "items",
              id: randomUUID(),
              op: "UPSERT",
              baseVersion: 0,
            },
          ]),
        ).update(actor, taskId, 3, { title: "Must roll back" }),
      ),
    ).rejects.toThrow("VERSION_CONFLICT");
    expect(
      await run(actor, null, (uow) => make(uow).snapshot(actor, true)),
    ).toEqual(snapshot);
    expect(
      await run(actor, null, (uow) =>
        uow.run(actor.workspaceId, (tx) => tx.workspaceChanges(0)),
      ),
    ).toEqual(beforeChanges);
  });

  it(`${name} receipts are scoped, atomic, concurrent-idempotent and device-aware`, async () => {
    const run = await create();
    const actor = { workspaceId: "workspace-a", principalId: "human" };
    const receipt = {
      key: randomUUID(),
      digest: "original-digest",
      deviceId: randomUUID(),
    };
    const id = randomUUID();
    let calls = 0;
    const operation = (uow: UnitOfWork) => {
      calls++;
      return new WorkService(
        uow,
        { require: async () => {} },
        { now: () => "2026-10-13T00:00:00Z" },
        { next: randomUUID },
      ).createWithStableId(actor, id, {
        title: "Durable",
        descriptionMd: "原文\n第二行",
      });
    };
    const [first, repeated] = await Promise.all([
      run(actor, receipt, operation),
      run(actor, receipt, operation),
    ]);
    expect(repeated).toEqual(first);
    expect(calls).toBe(1);
    const mutableActor = { ...actor },
      mutableReceipt = { ...receipt, key: randomUUID() };
    const capturedReceipt = { ...mutableReceipt },
      capturedId = randomUUID();
    const captured = await run(mutableActor, mutableReceipt, async (uow) => {
      const saved = await new WorkService(
        uow,
        { require: async () => {} },
        { now: () => "2026-10-13T00:00:00Z" },
        { next: randomUUID },
      ).createWithStableId(mutableActor, capturedId, {
        title: "Captured scope",
      });
      mutableActor.workspaceId = "workspace-b";
      mutableReceipt.key = randomUUID();
      mutableReceipt.deviceId = randomUUID();
      return saved;
    });
    expect(captured.workspaceId).toBe(actor.workspaceId);
    expect(
      await run(actor, capturedReceipt, async () => {
        throw new Error("MUST_NOT_REPEAT");
      }),
    ).toEqual(captured);
    await expect(
      run(actor, { ...receipt, digest: "another-digest" }, operation),
    ).rejects.toThrow("VERSION_CONFLICT");
    await expect(
      run(actor, { ...receipt, deviceId: randomUUID() }, operation),
    ).rejects.toThrow("VERSION_CONFLICT");
    await expect(
      run({ ...actor, principalId: "foreign" }, receipt, operation),
    ).rejects.toThrow("FORBIDDEN");
    expect(calls).toBe(1);
    const rollbackReceipt = { ...receipt, key: randomUUID() };
    const rollbackId = randomUUID();
    const save = (uow: UnitOfWork) =>
      new WorkService(
        uow,
        { require: async () => {} },
        { now: () => "2026-10-13T00:00:00Z" },
        { next: randomUUID },
      ).createWithStableId(actor, rollbackId, { title: "Recovered" });
    await expect(
      run(actor, rollbackReceipt, async (uow) => {
        await save(uow);
        throw new Error("EXPECTED_ABORT");
      }),
    ).rejects.toThrow("EXPECTED_ABORT");
    expect((await run(actor, rollbackReceipt, save)).id).toBe(rollbackId);
    const other = { ...actor, workspaceId: "workspace-b" };
    const otherResult = await run(other, receipt, (uow) =>
      new WorkService(
        uow,
        { require: async () => {} },
        { now: () => "2026-10-13T00:00:00Z" },
        { next: randomUUID },
      ).createWithStableId(other, id, { title: "Other workspace" }),
    );
    expect(otherResult.workspaceId).toBe(other.workspaceId);
    expect(otherResult.title).toBe("Other workspace");
    expect(await run(actor, receipt, operation)).toEqual(first);
    expect(calls).toBe(1);
  });
}
