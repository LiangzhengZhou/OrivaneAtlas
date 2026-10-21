import { randomUUID } from "node:crypto";
import {
  continueWorkspaceImport,
  createWorkspaceImportFork,
  createWorkspaceImportJournal,
  recoverWorkspaceImportReceipts,
  requireWorkspaceImportFork,
  reviewWorkspaceImportSuffix,
  type WorkspaceImportPorts,
  type WorkspaceMergeBackup,
} from "@arclattice/application";
import { IDBFactory } from "fake-indexeddb";
import { expect, test } from "vitest";
import { IndexedDbWorkspaceImports } from "./workspace-import";

const actor = { workspaceId: "source", principalId: "local-owner" };
const backup: WorkspaceMergeBackup = {
  id: randomUUID(),
  sourceWorkspaceId: actor.workspaceId,
  sourcePrincipalId: actor.principalId,
  sourceRevision: 7,
  targetWorkspaceId: "target",
  targetPrincipalId: "remote-owner",
  targetOrigin: "https://example.test",
  targetEpoch: "epoch",
  targetRevision: 12,
  createdAt: "2026-10-15T00:00:00Z",
  sha256: "a".repeat(64),
  bytes: new Blob(["ORIVANE1 original"]),
};
const plan = () =>
  createWorkspaceImportJournal(actor, backup, randomUUID(), [
    {
      id: randomUUID(),
      path: "/api/work/create",
      payload: {
        title: "Parent",
        stableId: randomUUID(),
        deviceId: randomUUID(),
      },
    },
    {
      id: randomUUID(),
      path: "/api/work/create",
      payload: {
        title: "Child",
        stableId: randomUUID(),
        deviceId: randomUUID(),
      },
    },
  ]);

test("import survives a committed remote step with a lost local checkpoint using the identical receipt and guard", async () => {
  const name = randomUUID(),
    factory = new IDBFactory();
  let store = await IndexedDbWorkspaceImports.open(name, factory);
  const journal = plan();
  await store.create(journal);
  const receipts = new Map<
    string,
    {
      result: { id: string };
      workspaceRevision: { epoch: string; cursor: number };
    }
  >();
  const calls: { id: string; cursor: number }[] = [];
  let failCheckpoint = true,
    executions = 0;
  const ports: WorkspaceImportPorts = {
    store: {
      create: (j) => store.create(j),
      get: (id) => store.get(id),
      close: () => {},
      advance: async (a, b) => {
        if (failCheckpoint) {
          failCheckpoint = false;
          throw new Error("DISK_INTERRUPTED");
        }
        return store.advance(a, b);
      },
    },
    assertScope: async () => {},
    verifyBackup: async () => {},
    apply: async (step, j) => {
      calls.push({ id: step.id, cursor: j.revision.cursor });
      const receipt = receipts.get(step.id);
      if (receipt) return receipt;
      executions++;
      const reply = {
        result: { id: step.id },
        workspaceRevision: { epoch: "epoch", cursor: j.revision.cursor + 1 },
      };
      receipts.set(step.id, reply);
      return reply;
    },
  };
  try {
    await expect(
      continueWorkspaceImport(actor, journal.id, ports),
    ).rejects.toThrow("DISK_INTERRUPTED");
    expect((await store.get(journal.id))!.accepted).toHaveLength(0);
    store.close();
    store = await IndexedDbWorkspaceImports.open(name, factory);
    const completed = await continueWorkspaceImport(actor, journal.id, ports);
    expect(completed.accepted).toHaveLength(2);
    expect(completed.revision).toEqual({ epoch: "epoch", cursor: 14 });
    expect(calls.slice(0, 2)).toEqual([
      { id: journal.steps[0]!.id, cursor: 12 },
      { id: journal.steps[0]!.id, cursor: 12 },
    ]);
    expect(executions).toBe(2);
    expect(await continueWorkspaceImport(actor, journal.id, ports)).toEqual(
      completed,
    );
    expect(calls).toHaveLength(3);
  } finally {
    store.close();
  }
});

test("journal CAS refuses another tab and changing immutable import payloads", async () => {
  const store = await IndexedDbWorkspaceImports.open(
      randomUUID(),
      new IDBFactory(),
    ),
    original = plan();
  try {
    await store.create(original);
    await expect(store.create(original)).rejects.toThrow();
    const next = {
      ...original,
      version: 2,
      revision: { epoch: "epoch", cursor: 13 },
      accepted: [
        {
          stepId: original.steps[0]!.id,
          result: null,
          revision: { epoch: "epoch", cursor: 13 },
        },
      ],
    };
    await store.advance(original, next);
    await expect(store.advance(original, next)).rejects.toThrow(
      "VERSION_CONFLICT",
    );
    await expect(
      store.advance(original, { ...next, targetWorkspaceId: "foreign" }),
    ).rejects.toThrow("VERSION_CONFLICT");
    expect(await store.get(original.id)).toEqual(next);
  } finally {
    store.close();
  }
});

test("scope or backup failures, foreign actors and a changed epoch never advance an import", async () => {
  const store = await IndexedDbWorkspaceImports.open(
      randomUUID(),
      new IDBFactory(),
    ),
    original = plan();
  let requests = 0;
  const ports: WorkspaceImportPorts = {
    store,
    assertScope: async () => {},
    verifyBackup: async () => {},
    apply: async () => {
      requests++;
      return {
        result: null,
        workspaceRevision: { epoch: "replacement", cursor: 13 },
      };
    },
  };
  try {
    await store.create(original);
    await expect(
      continueWorkspaceImport(
        { ...actor, principalId: "foreign" },
        original.id,
        ports,
      ),
    ).rejects.toThrow("FORBIDDEN");
    await expect(
      continueWorkspaceImport(actor, original.id, {
        ...ports,
        verifyBackup: async () => {
          throw new Error("BAD_BACKUP");
        },
      }),
    ).rejects.toThrow("BAD_BACKUP");
    await expect(
      continueWorkspaceImport(actor, original.id, {
        ...ports,
        assertScope: async () => {
          throw new Error("SOURCE_CHANGED");
        },
      }),
    ).rejects.toThrow("SOURCE_CHANGED");
    expect(requests).toBe(0);
    await expect(
      continueWorkspaceImport(actor, original.id, ports),
    ).rejects.toThrow("VALIDATION_ERROR");
    expect((await store.get(original.id))!.accepted).toHaveLength(0);
  } finally {
    store.close();
  }
});

test("recovery catalogue survives reopen, scopes to the original actor and never exposes entity payloads", async () => {
  const factory = new IDBFactory(),
    name = randomUUID();
  let store = await IndexedDbWorkspaceImports.open(name, factory);
  const journal = plan();
  await store.create(journal);
  store.close();
  store = await IndexedDbWorkspaceImports.open(name, factory);
  expect(await store.list({ ...actor, principalId: "other" })).toEqual([]);
  expect(await store.list({ ...actor, workspaceId: "other" })).toEqual([]);
  const rows = await store.list(actor);
  expect(rows).toEqual([
    {
      id: journal.id,
      backupId: backup.id,
      targetWorkspaceId: backup.targetWorkspaceId,
      targetPrincipalId: backup.targetPrincipalId,
      targetOrigin: backup.targetOrigin,
      version: 1,
      completedSteps: 0,
      totalSteps: 2,
      complete: false,
    },
  ]);
  expect(JSON.stringify(rows)).not.toContain("Parent");
  expect(JSON.stringify(rows)).not.toContain("payload");
  const next = {
    ...journal,
    version: 2,
    revision: { ...journal.revision, cursor: 13 },
    accepted: [
      {
        stepId: journal.steps[0]!.id,
        result: { title: "Private result" },
        revision: { ...journal.revision, cursor: 13 },
      },
    ],
  };
  await store.advance(journal, next);
  expect(await store.list(actor)).toEqual([
    expect.objectContaining({
      completedSteps: 1,
      totalSteps: 2,
      version: 2,
      complete: false,
    }),
  ]);
  expect(JSON.stringify(await store.list(actor))).not.toContain(
    "Private result",
  );
  store.close();
});

test("v1 import journals upgrade unchanged and fork one immutable suffix with atomic parent claims", async () => {
  const factory = new IDBFactory(),
    name = randomUUID(),
    original = plan();
  const old = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("imports", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = old.transaction("imports", "readwrite");
    tx.objectStore("imports").add(original);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
  old.close();
  const store = await IndexedDbWorkspaceImports.open(name, factory);
  try {
    expect(await store.get(original.id)).toEqual(original);
    const freshBackup = { ...backup, id: randomUUID(), targetRevision: 14 };
    const child = createWorkspaceImportFork(
      actor,
      original,
      freshBackup,
      randomUUID(),
      { next: randomUUID },
    );
    expect(child.parent).toEqual({
      id: original.id,
      version: 1,
      acceptedSteps: 0,
    });
    expect(child.steps.map((step) => step.payload)).toEqual(
      original.steps.map((step) => step.payload),
    );
    expect(child.steps[0]!.id).not.toBe(original.steps[0]!.id);
    await store.create(child);
    expect(await store.successor(original.id)).toBe(child.id);
    expect(await store.get(original.id)).toEqual(original);
    expect(await store.list(actor)).toContainEqual(
      expect.objectContaining({ id: original.id, supersededBy: child.id }),
    );
    const second = createWorkspaceImportFork(
      actor,
      original,
      { ...freshBackup, id: randomUUID() },
      randomUUID(),
      { next: randomUUID },
    );
    await expect(store.create(second)).rejects.toThrow();
    expect(await store.get(second.id)).toBeNull();
    await expect(
      store.advance(original, {
        ...original,
        version: 2,
        revision: { epoch: "epoch", cursor: 13 },
        accepted: [
          {
            stepId: original.steps[0]!.id,
            result: null,
            revision: { epoch: "epoch", cursor: 13 },
          },
        ],
      }),
    ).rejects.toThrow("VERSION_CONFLICT");
  } finally {
    store.close();
  }
});

test("fork preserves accepted evidence, remapped IDs and binary metadata but renews replay command IDs", async () => {
  const original = plan();
  const acknowledged = {
    ...original,
    version: 2,
    revision: { epoch: "epoch", cursor: 13 },
    accepted: [
      {
        stepId: original.steps[0]!.id,
        result: { id: "accepted" },
        revision: { epoch: "epoch", cursor: 13 },
      },
    ],
  };
  const child = createWorkspaceImportFork(
    actor,
    acknowledged,
    { ...backup, id: randomUUID(), targetRevision: 14 },
    randomUUID(),
    { next: randomUUID },
  );
  expect(child.steps).toHaveLength(1);
  expect(child.steps[0]!.payload).toEqual(original.steps[1]!.payload);
  expect(child.parent).toEqual({
    id: original.id,
    version: 2,
    acceptedSteps: 1,
  });
  expect(acknowledged.accepted[0]!.result).toEqual({ id: "accepted" });
  expect(() =>
    createWorkspaceImportFork(
      actor,
      acknowledged,
      {
        ...backup,
        id: randomUUID(),
        targetEpoch: "changed",
        targetRevision: 14,
      },
      randomUUID(),
      { next: randomUUID },
    ),
  ).toThrow("VERSION_CONFLICT");
  expect(() =>
    createWorkspaceImportFork(
      actor,
      acknowledged,
      { ...backup, id: randomUUID(), targetRevision: 13 },
      randomUUID(),
      { next: randomUUID },
    ),
  ).toThrow("VERSION_CONFLICT");
});

test("receipt recovery advances only already accepted effects and stops at the first missing receipt", async () => {
  const store = await IndexedDbWorkspaceImports.open(
      randomUUID(),
      new IDBFactory(),
    ),
    journal = plan();
  await store.create(journal);
  const lookedUp: string[] = [];
  try {
    const recovered = await recoverWorkspaceImportReceipts(actor, journal.id, {
      store,
      assertScope: async () => {},
      verifyBackup: async () => {},
      lookup: async (step) => {
        lookedUp.push(step.id);
        return step.id === journal.steps[0]!.id
          ? {
              result: { id: "accepted" },
              workspaceRevision: { epoch: "epoch", cursor: 13 },
            }
          : null;
      },
    });
    expect(recovered.accepted).toHaveLength(1);
    expect(recovered.version).toBe(2);
    expect(lookedUp).toEqual(journal.steps.map((step) => step.id));
    expect(await store.get(journal.id)).toEqual(recovered);
  } finally {
    store.close();
  }
});

test("suffix review detects existing create identities and changed entity versions without force overwrites", () => {
  const journal = plan(),
    id = (journal.steps[0]!.payload as { stableId: string }).stableId;
  const row = {
    workspaceId: "target",
    collection: "items",
    id,
    version: 3,
    value: { id, deletedAt: null },
  };
  expect(reviewWorkspaceImportSuffix(journal, [])).toEqual([]);
  expect(reviewWorkspaceImportSuffix(journal, [row])).toContainEqual({
    stepId: journal.steps[0]!.id,
    collection: "items",
    entityId: id,
    expectedVersion: 0,
    actualVersion: 3,
  });
  expect(() =>
    reviewWorkspaceImportSuffix(journal, [{ ...row, workspaceId: "foreign" }]),
  ).toThrow("FORBIDDEN");
  for (const version of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])
    expect(() =>
      reviewWorkspaceImportSuffix(journal, [{ ...row, version }]),
    ).toThrow("VALIDATION_ERROR");
  const withUpdate = {
    ...journal,
    steps: [
      {
        id: randomUUID(),
        path: "/api/work/update",
        payload: { id, version: 1, input: { title: "Local" } },
      },
    ],
  };
  expect(reviewWorkspaceImportSuffix(withUpdate, [row])).toEqual([
    {
      stepId: withUpdate.steps[0]!.id,
      collection: "items",
      entityId: id,
      expectedVersion: 1,
      actualVersion: 3,
    },
  ]);
  expect(
    reviewWorkspaceImportSuffix(withUpdate, [{ ...row, version: 1 }]),
  ).toEqual([]);
});

test("a reviewed resolution is immutable fork evidence and cannot amend unrelated fields", async () => {
  const original = createWorkspaceImportJournal(actor, backup, randomUUID(), [
    {
      id: randomUUID(),
      path: "/api/work/update",
      payload: { id: "task", version: 1, input: { status: "TODO" } },
    },
  ]);
  const remote = {
    workspaceId: "target",
    collection: "items",
    id: "task",
    version: 2,
    value: {
      id: "task",
      version: 2,
      title: "Keep this remote title",
      status: "IN_PROGRESS",
      deletedAt: null,
    },
  };
  const child = createWorkspaceImportFork(
    actor,
    original,
    { ...backup, id: randomUUID(), targetRevision: 14 },
    randomUUID(),
    { next: randomUUID },
    [{ stepId: original.steps[0]!.id, choice: "REMOTE", remote }],
  );
  expect(child.steps[0]!.payload).toEqual({
    id: "task",
    version: 2,
    input: { status: "IN_PROGRESS" },
  });
  const forged = {
    ...child,
    steps: [
      {
        ...child.steps[0]!,
        payload: {
          id: "task",
          version: 2,
          input: { status: "TODO", title: "Overwrite" },
        },
      },
    ],
  };
  expect(() => requireWorkspaceImportFork(original, forged)).toThrow(
    "VERSION_CONFLICT",
  );
  const store = await IndexedDbWorkspaceImports.open(
    randomUUID(),
    new IDBFactory(),
  );
  try {
    await store.create(original);
    await expect(store.create(forged)).rejects.toThrow("VERSION_CONFLICT");
    expect(await store.successor(original.id)).toBeNull();
    await store.create(child);
    expect(await store.get(original.id)).toEqual(original);
    expect(await store.get(child.id)).toEqual(child);
    expect(await store.successor(original.id)).toBe(child.id);
  } finally {
    store.close();
  }
});

test("a binary suffix fork preserves original bytes metadata and renews only replay command identity", () => {
  const commandId = randomUUID();
  const original = createWorkspaceImportJournal(actor, backup, randomUUID(), [
    {
      id: commandId,
      path: "/api/files/register",
      payload: {
        stableId: randomUUID(),
        contentHash: "b".repeat(64),
        size: 600001,
        mime: "application/pdf",
        originalName: "Original.pdf",
        syncCommand: {
          commandId,
          deviceId: randomUUID(),
          effects: [{ entityType: "files", entityId: "file", version: 0 }],
        },
      },
      binary: {
        contentHash: "b".repeat(64),
        size: 600001,
        mime: "application/pdf",
      },
      source: { collection: "files", id: "original-file", version: 3 },
    },
  ]);
  const child = createWorkspaceImportFork(
    actor,
    original,
    { ...backup, id: randomUUID(), targetRevision: 14 },
    randomUUID(),
    { next: randomUUID },
  );
  expect(child.steps[0]!.binary).toEqual(original.steps[0]!.binary);
  expect(child.steps[0]!.source).toEqual(original.steps[0]!.source);
  expect(child.steps[0]!.payload).toEqual({
    ...(original.steps[0]!.payload as object),
    syncCommand: {
      ...(original.steps[0]!.payload as { syncCommand: object }).syncCommand,
      commandId: child.steps[0]!.id,
    },
  });
  expect(child.steps[0]!.id).not.toBe(commandId);
  expect(() =>
    requireWorkspaceImportFork(original, {
      ...child,
      steps: [
        { ...child.steps[0]!, binary: { ...child.steps[0]!.binary!, size: 1 } },
      ],
    }),
  ).toThrow("VALIDATION_ERROR");
});
