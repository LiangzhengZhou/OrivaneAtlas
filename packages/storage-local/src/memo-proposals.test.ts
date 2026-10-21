import { createHash } from "node:crypto";
import {
  LocalRuntime,
  LocalWorkspace,
  localObject,
  MemoProposalService,
  planLocalCommands,
} from "@arclattice/application";
import { IDBFactory } from "fake-indexeddb";
import { expect, test } from "vitest";
import { deriveEntityMemoId } from "./entity-memo-identity";
import { IndexedDbLocalStore } from "./indexed-db";

test("Memo formalization is locally durable, stale-safe and uses ordinary supported Outbox commands", async () => {
  const factory = new IDBFactory();
  const owner = {
    schemaVersion: 1 as const,
    workspaceId: crypto.randomUUID(),
    principalId: crypto.randomUUID(),
    deviceId: crypto.randomUUID(),
  };
  let store = await IndexedDbLocalStore.open("memo-formalization", factory);
  const runtime = () =>
    new LocalRuntime(
      new LocalWorkspace(
        store.metadata,
        {
          get: async () => null,
          put: async () => {
            throw new Error("UNEXPECTED_BLOB");
          },
        },
        owner,
        { extract: () => [], resolve: (links) => [...links] },
        { now: () => new Date().toISOString() },
        { next: () => crypto.randomUUID() },
      ),
      {
        forTarget: deriveEntityMemoId,
        nextChangeId: () => crypto.randomUUID(),
      },
    );
  const proposals = new MemoProposalService(
    async (text) => createHash("sha256").update(text).digest("hex"),
    () => crypto.randomUUID(),
  );
  try {
    await store.identity.ensure(owner);
    const local = runtime();
    const task = await local.service.create(local.context, {
      title: "Source task",
    });
    const target = { targetKind: "TASK" as const, targetId: task.id };
    const memo = await local.saveEntityMemo(
      { ...target, bodyMd: "Private source unchanged\n" },
      0,
    );
    const proposal = await local.prepareMemoProposal(proposals, target, {
      kind: "CREATE_TASK",
      title: "Reviewed action",
      bodyMd: "Explicit action",
      projectId: null,
    });
    const before = await store.outbox.list(owner.workspaceId);
    expect((await local.service.snapshot(local.context)).items).toHaveLength(1);
    const applied = await local.applyMemoProposal(proposals, proposal);
    expect(
      (await local.service.snapshot(local.context)).items.find(
        (row) => row.id === applied.resultId,
      ),
    ).toMatchObject({
      title: "Reviewed action",
      descriptionMd: "Explicit action",
    });
    expect(await local.getEntityMemo(target)).toEqual(memo);
    const afterTask = await store.metadata.exportWorkspace!(owner.workspaceId);
    await expect(
      local.applyMemoProposal(proposals, proposal),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect(await store.metadata.exportWorkspace!(owner.workspaceId)).toEqual(
      afterTask,
    );
    expect(await store.outbox.list(owner.workspaceId)).toHaveLength(
      before.length + 1,
    );
    const plans = await planLocalCommands(
      local.context,
      store.metadata,
      await store.outbox.list(owner.workspaceId),
    );
    expect(
      plans.find(
        (plan) =>
          localObject(plan.command?.input ?? {}).id === applied.resultId,
      )?.command?.name,
    ).toBe("work.create");
    const space = await local.saveLibrary(null, 0, {
      kind: "SPACE",
      spaceId: null,
      title: "Destination",
      bodyMd: "",
    });
    const invalidDestination = await local.prepareMemoProposal(
      proposals,
      target,
      {
        kind: "CREATE_DOCUMENT",
        title: "Must not be created",
        spaceId: crypto.randomUUID(),
        bodyMd: "Preserve source on failure",
      },
    );
    const beforeFailure = await store.metadata.exportWorkspace!(
      owner.workspaceId,
    );
    await expect(
      local.applyMemoProposal(proposals, invalidDestination),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await store.metadata.exportWorkspace!(owner.workspaceId)).toEqual(
      beforeFailure,
    );
    expect(await local.getEntityMemo(target)).toEqual(memo);
    const docProposal = await local.prepareMemoProposal(proposals, target, {
      kind: "CREATE_DOCUMENT",
      title: "",
      spaceId: space.id,
      bodyMd: "Organized content",
    });
    const doc = await local.applyMemoProposal(proposals, docProposal);
    const afterDocument = await store.metadata.exportWorkspace!(
      owner.workspaceId,
    );
    await expect(
      local.applyMemoProposal(proposals, docProposal),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect(await store.metadata.exportWorkspace!(owner.workspaceId)).toEqual(
      afterDocument,
    );
    const append = await local.prepareMemoProposal(proposals, target, {
      kind: "APPEND_DOCUMENT",
      documentId: doc.resultId,
      version: 1,
      bodyMd: "Append excerpt",
    });
    await local.applyMemoProposal(proposals, append);
    const unchanged = await store.metadata.exportWorkspace!(owner.workspaceId);
    await expect(
      local.applyMemoProposal(proposals, append),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect(await store.metadata.exportWorkspace!(owner.workspaceId)).toEqual(
      unchanged,
    );
    await local.saveEntityMemo(
      { ...target, bodyMd: "New source invalidates old proposal" },
      1,
    );
    const afterSourceChange = await store.metadata.exportWorkspace!(
      owner.workspaceId,
    );
    await expect(
      local.applyMemoProposal(proposals, proposal),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect(await store.metadata.exportWorkspace!(owner.workspaceId)).toEqual(
      afterSourceChange,
    );
    const beforeDeletion = await local.prepareMemoProposal(proposals, target, {
      kind: "CREATE_TASK",
      title: "Do not apply after source target deletion",
      bodyMd: "Reviewed while target existed",
      projectId: null,
    });
    await local.service.setDeleted(local.context, task.id, 1, true);
    const deletedSource = await store.metadata.exportWorkspace!(
      owner.workspaceId,
    );
    await expect(
      local.applyMemoProposal(proposals, beforeDeletion),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await store.metadata.exportWorkspace!(owner.workspaceId)).toEqual(
      deletedSource,
    );
    expect(await local.getEntityMemo(target)).toBeNull();
    store.close();
    store = await IndexedDbLocalStore.open("memo-formalization", factory);
    const restored = await runtime().loadWorkspace();
    expect(restored.items.some((item) => item.id === applied.resultId)).toBe(
      true,
    );
    expect(
      restored.library.find((item) => item.id === doc.resultId),
    ).toMatchObject({ version: 2 });
    const manifest = restored.library.find((item) => item.id === doc.resultId);
    expect(manifest).toBeDefined();
    const body = await runtime().readDocumentBody(manifest!);
    expect(body.bodyMd).toBe("Organized content\n\nAppend excerpt");
  } finally {
    store.close();
  }
});
