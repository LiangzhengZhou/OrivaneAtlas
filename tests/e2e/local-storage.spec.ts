import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { chromium, expect, test } from "@playwright/test";
import type {
  buildLocalKnowledgeReplayRequest,
  buildLocalWorkReplayRequest,
  LibraryService,
  LocalMutationTransaction,
  LocalOutboxTransition,
  LocalReplicaCommit,
  LocalRuntime,
  LocalWorkspace,
  LocalWorkUnitOfWork,
  NotebookService,
  planLocalCommands,
  ReminderService,
  WorkService,
} from "../../packages/application/src/index";
import type { restoreLocalWorkspace } from "../../packages/application/src/local-backup";
import type { LocalImageAssets } from "../../packages/application/src/local-image-assets";
import type { IndexedDbLocalBlobStore } from "../../packages/storage-local/src/blob-store";
import type { LocalWrite } from "../../packages/storage-local/src/contracts";
import type { IndexedDbLocalStore } from "../../packages/storage-local/src/indexed-db";
import type {
  buildAliasIndex,
  indexDocument,
  normalizeWikiTitle,
} from "../../packages/wiki-core/src/index";

type LocalWorkFixture = {
  buildLocalKnowledgeReplayRequest: typeof buildLocalKnowledgeReplayRequest;
  buildLocalWorkReplayRequest: typeof buildLocalWorkReplayRequest;
  planLocalCommands: typeof planLocalCommands;
  LocalMutationTransaction: typeof LocalMutationTransaction;
  restoreLocalWorkspace: typeof restoreLocalWorkspace;
  IndexedDbLocalStore: typeof IndexedDbLocalStore;
  LocalWorkUnitOfWork: typeof LocalWorkUnitOfWork;
  LocalWorkspace: typeof LocalWorkspace;
  LocalRuntime: typeof LocalRuntime;
  WorkService: typeof WorkService;
  ReminderService: typeof ReminderService;
  NotebookService: typeof NotebookService;
  LibraryService: typeof LibraryService;
  LocalImageAssets: typeof LocalImageAssets;
  IndexedDbLocalBlobStore: typeof IndexedDbLocalBlobStore;
  indexDocument: typeof indexDocument;
  buildAliasIndex: typeof buildAliasIndex;
  normalizeWikiTitle: typeof normalizeWikiTitle;
};

test("local Work commands retain project completion intent and grouped effects across restart", async ({
  page,
}, info) => {
  const bundle = await readFile(
    `.artifacts/local-storage-fixture-${info.workerIndex}/storage.js`,
    "utf8",
  );
  await page.route("http://127.0.0.1:19420/commands", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Work commands</title>",
    }),
  );
  await page.goto("http://127.0.0.1:19420/commands");
  await page.addScriptTag({ content: bundle });
  const evidence = await page.evaluate(async () => {
    const api = (
      window as unknown as { OrivaneLocalStorageFixture: LocalWorkFixture }
    ).OrivaneLocalStorageFixture;
    let db = await api.IndexedDbLocalStore.open("commands");
    const blobs = await api.IndexedDbLocalBlobStore.open("command-blobs");
    const own = await db.identity.ensure({
      schemaVersion: 1,
      workspaceId: crypto.randomUUID(),
      principalId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
    });
    const runtime = new api.LocalRuntime(
      new api.LocalWorkspace(
        db.metadata,
        blobs,
        own,
        {
          extract: (id, markdown) => api.indexDocument(id, markdown, []),
          resolve: (links, entries) => {
            const aliases = api.buildAliasIndex(entries);
            return links.map((link) => ({
              ...link,
              targetDocumentId:
                aliases.get(api.normalizeWikiTitle(link.targetText)) ?? null,
            }));
          },
        },
        { now: () => "2026-10-13T00:00:00Z" },
        { next: () => crypto.randomUUID() },
      ),
    );
    const actor = {
      workspaceId: own.workspaceId,
      principalId: own.principalId,
    };
    const create = {
      type: "PROJECT" as const,
      lifecycle: "ACTIVE" as const,
      title: "Original project",
    };
    const promise = runtime.service.create(actor, create);
    create.title = "Caller changed";
    actor.principalId = "foreign";
    const project = await promise;
    const task = await runtime.service.create(runtime.context, {
      title: "Open task",
      projectIds: [project.id],
    });
    const update = {
      projectLifecycle: "COMPLETED" as const,
      completionResolution: { action: "INBOX" as const },
    };
    await runtime.service.update(
      runtime.context,
      project.id,
      project.version,
      update,
    );
    const commands = await db.metadata.list(own.workspaceId, "$local.command");
    const completed = commands.find(
      (record) =>
        record.value &&
        typeof record.value === "object" &&
        "name" in record.value &&
        record.value.name === "work.update",
    );
    if (!completed) throw new Error("MISSING_COMMAND");
    const commandJson = JSON.stringify(completed.value);
    const group = (await db.outbox.list(own.workspaceId)).filter(
      (mutation) => mutation.commandId === completed.id,
    );
    const groupedIds = group.map((mutation) => mutation.id);
    const groupedEntities = group.map((mutation) => mutation.entityId).sort();
    const readyPlan = (
      await api.planLocalCommands(
        runtime.context,
        db.metadata,
        await db.outbox.list(own.workspaceId),
      )
    ).find((plan) => plan.id === completed.id);
    if (!readyPlan) throw new Error("MISSING_PLAN");
    const ready = readyPlan.state;
    const originalRequest = api.buildLocalWorkReplayRequest(readyPlan);
    if (!originalRequest) throw new Error("MISSING_WORK_REPLAY_REQUEST");
    const requestBytes = JSON.stringify(originalRequest);
    const binding = {
      workspaceId: own.workspaceId,
      remoteWorkspaceId: "remote",
      serverOrigin: "https://example.test",
      epoch: "epoch",
      cursor: 0,
      version: 1,
    };
    await db.syncState.save(binding, null);
    const claims = group.map(
      (entry): LocalOutboxTransition => ({
        workspaceId: own.workspaceId,
        mutationId: entry.id,
        binding,
        expectedState: "PENDING",
        expectedAttemptCount: 0,
        expectedLastAttemptAt: null,
        nextState: "SENDING",
        at: "2026-10-13T00:01:00Z",
      }),
    );
    const beforeClaim = JSON.stringify(
      await db.metadata.exportWorkspace!(own.workspaceId),
    );
    let partialClaimRejected = false;
    try {
      await db.outbox.transition(claims[0]!);
    } catch (error) {
      partialClaimRejected =
        error instanceof Error && error.message === "VERSION_CONFLICT";
    }
    const partialClaimAtomic =
      beforeClaim ===
      JSON.stringify(await db.metadata.exportWorkspace!(own.workspaceId));
    const competing = (
      await Promise.allSettled([
        db.outbox.transitionMany(claims),
        db.outbox.transitionMany(claims),
      ])
    )
      .map((result) => result.status)
      .sort();
    const sent = (await db.outbox.list(own.workspaceId)).filter(
      (entry) => entry.commandId === completed.id,
    );
    const sentAttempts = sent.map((entry) => ({
      state: entry.state,
      count: entry.attemptCount,
      at: entry.lastAttemptAt,
    }));
    const receiptRequired = (
      await api.planLocalCommands(
        runtime.context,
        db.metadata,
        await db.outbox.list(own.workspaceId),
      )
    ).find((plan) => plan.id === completed.id)?.state;
    const snapshot = await runtime.loadWorkspace();
    const membership = snapshot.items.find(
      (item) => item.id === task.id,
    )?.projectIds;
    db.close();
    db = await api.IndexedDbLocalStore.open("commands");
    const resumed =
      JSON.stringify(
        (await db.metadata.get(own.workspaceId, "$local.command", completed.id))
          ?.value,
      ) === commandJson;
    const resumedIds = (await db.outbox.list(own.workspaceId))
      .filter((mutation) => mutation.commandId === completed.id)
      .map((mutation) => mutation.id);
    const archive = await db.metadata.exportWorkspace!(own.workspaceId);
    const restored = await api.IndexedDbLocalStore.open("restored-commands");
    const newDeviceId = crypto.randomUUID();
    await restored.metadata.restoreEmptyWorkspace!(archive, newDeviceId);
    const restoredCommand =
      JSON.stringify(
        (
          await restored.metadata.get(
            own.workspaceId,
            "$local.command",
            completed.id,
          )
        )?.value,
      ) === commandJson;
    const restoredIds = (await restored.outbox.list(own.workspaceId))
      .filter((mutation) => mutation.commandId === completed.id)
      .map((mutation) => mutation.id);
    const restoredDevices = (await restored.outbox.list(own.workspaceId)).every(
      (mutation) => mutation.deviceId === own.deviceId,
    );
    const resumedPlan = (
      await api.planLocalCommands(
        runtime.context,
        db.metadata,
        await db.outbox.list(own.workspaceId),
      )
    ).find((plan) => plan.id === completed.id);
    const restoredPlan = (
      await api.planLocalCommands(
        runtime.context,
        restored.metadata,
        await restored.outbox.list(own.workspaceId),
      )
    ).find((plan) => plan.id === completed.id);
    if (!resumedPlan || !restoredPlan) throw new Error("MISSING_RECOVERY_PLAN");
    const resumedRequest =
      JSON.stringify(api.buildLocalWorkReplayRequest(resumedPlan)) ===
      requestBytes;
    const restoredRequest =
      JSON.stringify(api.buildLocalWorkReplayRequest(restoredPlan)) ===
      requestBytes;
    const newDevice = (await restored.identity.get())?.deviceId === newDeviceId;
    restored.close();
    db.close();
    blobs.close();
    return {
      projectId: project.id,
      taskId: task.id,
      title: project.title,
      author: project.createdBy === own.principalId,
      commandJson,
      commandCount: commands.length,
      groupedIds,
      groupedEntities,
      ready,
      partialClaimRejected,
      partialClaimAtomic,
      competing,
      sentAttempts,
      receiptRequired,
      membership,
      resumed,
      resumedIds,
      restoredCommand,
      restoredIds,
      restoredDevices,
      newDevice,
      originalRequest,
      resumedRequest,
      restoredRequest,
    };
  });
  expect(evidence.title).toBe("Original project");
  expect(evidence.author).toBe(true);
  expect(evidence.commandCount).toBe(3);
  expect(evidence.ready).toBe("READY");
  expect(evidence.partialClaimRejected).toBe(true);
  expect(evidence.partialClaimAtomic).toBe(true);
  expect(evidence.competing).toEqual(["fulfilled", "rejected"]);
  expect(evidence.sentAttempts).toEqual([
    { state: "SENDING", count: 1, at: "2026-10-13T00:01:00Z" },
    { state: "SENDING", count: 1, at: "2026-10-13T00:01:00Z" },
  ]);
  expect(evidence.receiptRequired).toBe("RECEIPT_REQUIRED");
  expect(evidence.groupedEntities).toEqual(
    [evidence.projectId, evidence.taskId].sort(),
  );
  expect(evidence.membership).toEqual([]);
  expect(evidence.resumed).toBe(true);
  expect(evidence.resumedIds).toEqual(evidence.groupedIds);
  expect(evidence.restoredCommand).toBe(true);
  expect(evidence.restoredIds).toEqual(evidence.groupedIds);
  expect(evidence.restoredDevices).toBe(true);
  expect(evidence.newDevice).toBe(true);
  expect(evidence.resumedRequest).toBe(true);
  expect(evidence.restoredRequest).toBe(true);
  expect(evidence.originalRequest).toMatchObject({
    path: "/api/v1/work/update",
    body: {
      id: evidence.projectId,
      version: 1,
      input: { completionResolution: { action: "INBOX" } },
      syncCommand: {
        effects: expect.arrayContaining([
          {
            collection: "items",
            id: evidence.projectId,
            op: "UPSERT",
            baseVersion: 1,
          },
          {
            collection: "items",
            id: evidence.taskId,
            op: "UPSERT",
            baseVersion: 1,
          },
        ]),
      },
    },
  });
  expect(JSON.parse(evidence.commandJson)).toMatchObject({
    name: "work.update",
    mutationIds: evidence.groupedIds,
    input: {
      id: evidence.projectId,
      version: 1,
      input: {
        projectLifecycle: "COMPLETED",
        completionResolution: { action: "INBOX" },
      },
    },
  });
});

test("replica acknowledgement persists atomically and protects subsequent offline edits", async ({
  page,
}, info) => {
  const bundle = await readFile(
    `.artifacts/local-storage-fixture-${info.workerIndex}/storage.js`,
    "utf8",
  );
  await page.route("http://127.0.0.1:19420/replica", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Replica</title>",
    }),
  );
  await page.goto("http://127.0.0.1:19420/replica");
  await page.addScriptTag({ content: bundle });
  const evidence = await page.evaluate(async () => {
    const api = (
      window as unknown as { OrivaneLocalStorageFixture: LocalWorkFixture }
    ).OrivaneLocalStorageFixture;
    let store = await api.IndexedDbLocalStore.open("replica");
    const own = {
      schemaVersion: 1 as const,
      workspaceId: "11111111-1111-4111-8111-111111111111",
      principalId: "22222222-2222-4222-8222-222222222222",
      deviceId: "33333333-3333-4333-8333-333333333333",
    };
    const restoredDevice = "44444444-4444-4444-8444-444444444444";
    const binding = {
      workspaceId: own.workspaceId,
      remoteWorkspaceId: "remote",
      serverOrigin: "https://example.test",
      epoch: "epoch",
      cursor: 10,
      version: 1,
    };
    const mutation = {
      id: "accepted",
      deviceId: own.deviceId,
      workspaceId: own.workspaceId,
      principalId: own.principalId,
      operation: "CREATE" as const,
      entityType: "items",
      entityId: "task",
      baseVersion: null,
      payload: { title: "Offline" },
      createdAt: "2026-10-13T00:00:00Z",
      attemptCount: 1,
      lastAttemptAt: "2026-10-13T00:01:00Z",
      state: "SENDING" as const,
    };
    await store.metadata.restoreEmptyWorkspace!(
      {
        schemaVersion: 2,
        identity: own,
        syncState: binding,
        entities: [
          {
            workspaceId: own.workspaceId,
            collection: "$local.workspace",
            id: "revision",
            version: 1,
            value: { revision: 1 },
          },
          {
            workspaceId: own.workspaceId,
            collection: "items",
            id: "task",
            version: 1,
            value: { title: "Offline" },
          },
        ],
        mutations: [
          mutation,
          {
            ...mutation,
            id: "later",
            state: "PENDING",
            attemptCount: 0,
            lastAttemptAt: null,
          },
        ],
      },
      restoredDevice,
    );
    const commit: LocalReplicaCommit = {
      workspaceId: own.workspaceId,
      principalId: own.principalId,
      expectedWorkspaceVersion: 1,
      binding,
      nextCursor: 11,
      acknowledgement: {
        mutationId: mutation.id,
        deviceId: own.deviceId,
        attemptCount: 1,
        lastAttemptAt: mutation.lastAttemptAt,
      },
      records: [
        {
          expectedVersion: null,
          entity: {
            workspaceId: own.workspaceId,
            collection: "$local.remoteBase",
            id: JSON.stringify(["items", "task"]),
            version: 1,
            value: {
              remoteWorkspaceId: "remote",
              collection: "items",
              id: "task",
              version: 1,
              mutationId: mutation.id,
              value: { title: "Canonical" },
            },
          },
        },
      ],
    };
    const before = await store.metadata.exportWorkspace!(own.workspaceId);
    let overwriteRejected = false;
    try {
      await store.replica.commit({
        ...commit,
        records: [
          ...commit.records,
          {
            expectedVersion: 1,
            entity: {
              workspaceId: own.workspaceId,
              collection: "items",
              id: "task",
              version: 2,
              value: { title: "Canonical" },
            },
          },
        ],
      });
    } catch (error) {
      overwriteRejected =
        error instanceof Error && error.message === "VERSION_CONFLICT";
    }
    const atomicReject =
      JSON.stringify(before) ===
      JSON.stringify(await store.metadata.exportWorkspace!(own.workspaceId));
    let wrongDeviceRejected = false;
    try {
      await store.replica.commit({
        ...commit,
        acknowledgement: {
          ...commit.acknowledgement!,
          deviceId: restoredDevice,
        },
      });
    } catch (error) {
      wrongDeviceRejected =
        error instanceof Error && error.message === "VERSION_CONFLICT";
    }
    const wrongDeviceAtomic =
      JSON.stringify(before) ===
      JSON.stringify(await store.metadata.exportWorkspace!(own.workspaceId));
    await store.replica.commit(commit);
    const saved = await store.metadata.exportWorkspace!(own.workspaceId);
    let duplicateRejected = false;
    try {
      await store.replica.commit({
        ...commit,
        binding: { ...binding, cursor: 11, version: 2 },
        expectedWorkspaceVersion: 2,
        records: [],
      });
    } catch (error) {
      duplicateRejected =
        error instanceof Error && error.message === "VERSION_CONFLICT";
    }
    const duplicateAtomic =
      JSON.stringify(saved) ===
      JSON.stringify(await store.metadata.exportWorkspace!(own.workspaceId));
    store.close();
    store = await api.IndexedDbLocalStore.open("replica");
    const reopened =
      JSON.stringify(saved) ===
      JSON.stringify(await store.metadata.exportWorkspace!(own.workspaceId));
    const ids = (await store.outbox.list(own.workspaceId)).map(
      (entry) => entry.id,
    );
    const cursor = (await store.syncState.get(own.workspaceId))?.cursor;
    const restoredIdentity =
      (await store.identity.get())?.deviceId === restoredDevice;
    const originalDevice = (await store.outbox.list(own.workspaceId)).every(
      (entry) => entry.deviceId === own.deviceId,
    );
    const value = (await store.metadata.get(own.workspaceId, "items", "task"))
      ?.value;
    const bulk = await api.IndexedDbLocalStore.open("bulk-replica");
    await bulk.metadata.restoreEmptyWorkspace!(before, crypto.randomUUID());
    await bulk.outbox.transition({
      workspaceId: own.workspaceId,
      mutationId: "later",
      binding,
      expectedState: "PENDING",
      expectedAttemptCount: 0,
      expectedLastAttemptAt: null,
      nextState: "SENDING",
      at: mutation.lastAttemptAt,
    });
    const { acknowledgement: first, ...original } = commit;
    const batch: LocalReplicaCommit = {
      ...original,
      acknowledgements: [first!, { ...first!, mutationId: "later" }],
      records: [
        {
          expectedVersion: null,
          entity: {
            workspaceId: own.workspaceId,
            collection: "$local.remoteBase",
            id: JSON.stringify(["items", "task"]),
            version: 1,
            value: {
              remoteWorkspaceId: "remote",
              collection: "items",
              id: "task",
              version: 2,
              mutationIds: ["accepted", "later"],
              value: { title: "Canonical batch" },
            },
          },
        },
        {
          expectedVersion: 1,
          entity: {
            workspaceId: own.workspaceId,
            collection: "items",
            id: "task",
            version: 2,
            value: { title: "Canonical batch" },
          },
        },
      ],
    };
    const beforeBulk = JSON.stringify(
      await bulk.metadata.exportWorkspace!(own.workspaceId),
    );
    let bulkRejected = false;
    try {
      await bulk.replica.commit({
        ...batch,
        acknowledgements: [
          first!,
          { ...first!, mutationId: "later", attemptCount: 2 },
        ],
      });
    } catch (error) {
      bulkRejected =
        error instanceof Error && error.message === "VERSION_CONFLICT";
    }
    const bulkAtomic =
      beforeBulk ===
      JSON.stringify(await bulk.metadata.exportWorkspace!(own.workspaceId));
    await bulk.replica.commit(batch);
    const bulkCompleted =
      (await bulk.outbox.list(own.workspaceId)).length === 0 &&
      (await bulk.syncState.get(own.workspaceId))?.cursor === 11 &&
      JSON.stringify(
        (await bulk.metadata.get(own.workspaceId, "items", "task"))?.value,
      ) === JSON.stringify({ title: "Canonical batch" });
    bulk.close();
    store.close();
    return {
      overwriteRejected,
      wrongDeviceRejected,
      wrongDeviceAtomic,
      restoredIdentity,
      originalDevice,
      bulkRejected,
      bulkAtomic,
      bulkCompleted,
      atomicReject,
      duplicateRejected,
      duplicateAtomic,
      reopened,
      ids,
      cursor,
      value,
    };
  });
  expect(evidence).toEqual({
    overwriteRejected: true,
    wrongDeviceRejected: true,
    wrongDeviceAtomic: true,
    restoredIdentity: true,
    originalDevice: true,
    bulkRejected: true,
    bulkAtomic: true,
    bulkCompleted: true,
    atomicReject: true,
    duplicateRejected: true,
    duplicateAtomic: true,
    reopened: true,
    ids: ["later"],
    cursor: 11,
    value: { title: "Offline" },
  });
});

test("causal Outbox order survives reopen and malformed stamps cannot partially commit", async ({
  page,
}, info) => {
  const bundle = await readFile(
    `.artifacts/local-storage-fixture-${info.workerIndex}/storage.js`,
    "utf8",
  );
  await page.route("http://127.0.0.1:19420/causal-order", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Causal order</title>",
    }),
  );
  await page.goto("http://127.0.0.1:19420/causal-order");
  await page.addScriptTag({ content: bundle });
  const evidence = await page.evaluate(async () => {
    const api = (
      window as unknown as { OrivaneLocalStorageFixture: LocalWorkFixture }
    ).OrivaneLocalStorageFixture;
    let db = await api.IndexedDbLocalStore.open("causal-order");
    const actor = { workspaceId: "local-order", principalId: "owner" };
    const ids = ["z", "y", "a"];
    let next = 0;
    const begin = () =>
      api.LocalMutationTransaction.begin(
        db.metadata,
        actor,
        "device",
        { now: () => "2026-10-13T00:00:00Z" },
        { next: () => ids[next++]! },
      );
    const first = await begin();
    for (const [id, parentId] of [
      ["project", null],
      ["child", "project"],
    ] as const) {
      first.stage(
        {
          workspaceId: actor.workspaceId,
          collection: "projects",
          id,
          version: 1,
          value: { parentId },
        },
        null,
        "CREATE",
        { parentId },
      );
    }
    await first.commit();
    const second = await begin();
    second.stage(
      {
        workspaceId: actor.workspaceId,
        collection: "tasks",
        id: "task",
        version: 1,
        value: { projectIds: ["child"] },
      },
      null,
      "CREATE",
      { projectIds: ["child"] },
    );
    await second.commit();
    const before = await db.outbox.list(actor.workspaceId);
    db.close();
    db = await api.IndexedDbLocalStore.open("causal-order");
    const after = await db.outbox.list(actor.workspaceId);
    const invalid: LocalWrite = {
      entity: {
        workspaceId: actor.workspaceId,
        collection: "tasks",
        id: "invalid",
        version: 1,
        value: {},
      },
      expectedVersion: null,
      mutation: {
        ...after[0]!,
        id: "invalid-mutation",
        entityType: "tasks",
        entityId: "invalid",
        payload: {},
        order: { transactionVersion: 0, operationIndex: 0 },
      },
    };
    let rejection = "";
    try {
      await db.metadata.commit(actor.workspaceId, actor.principalId, [invalid]);
    } catch (error) {
      rejection = error instanceof Error ? error.message : String(error);
    }
    const untouched =
      (await db.metadata.get(actor.workspaceId, "tasks", "invalid")) === null;
    const pending = await db.outbox.list(actor.workspaceId);
    db.close();
    return { before, after, rejection, untouched, pending };
  });
  expect(evidence.before.map((value) => value.id)).toEqual(["z", "y", "a"]);
  expect(evidence.before.map((value) => value.order)).toEqual([
    { transactionVersion: 1, operationIndex: 0 },
    { transactionVersion: 1, operationIndex: 1 },
    { transactionVersion: 2, operationIndex: 0 },
  ]);
  expect(evidence.after).toEqual(evidence.before);
  expect(evidence.rejection).toBe("INVALID_WRITE");
  expect(evidence.untouched).toBe(true);
  expect(evidence.pending).toEqual(evidence.before);
});

test.beforeAll(async ({}, info) => {
  await promisify(execFile)(
    process.execPath,
    ["scripts/build-local-storage-fixture.mjs", String(info.workerIndex)],
    { timeout: 30000 },
  );
});

test("Outbox attempt CAS rejects duplicate senders and responses from an obsolete binding", async ({
  page,
}, info) => {
  const bundle = await readFile(
    `.artifacts/local-storage-fixture-${info.workerIndex}/storage.js`,
    "utf8",
  );
  await page.route("http://127.0.0.1:19420/outbox-attempt", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Outbox attempts</title>",
    }),
  );
  await page.goto("http://127.0.0.1:19420/outbox-attempt");
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async () => {
    const api = (
      window as unknown as { OrivaneLocalStorageFixture: LocalWorkFixture }
    ).OrivaneLocalStorageFixture;
    const db = await api.IndexedDbLocalStore.open("outbox-attempt");
    const actor = { workspaceId: "local-attempt", principalId: "owner" };
    const stage = await api.LocalMutationTransaction.begin(
      db.metadata,
      actor,
      "original-device",
      { now: () => "2026-10-13T00:00:00Z" },
      { next: () => "mutation" },
    );
    stage.stage(
      {
        workspaceId: actor.workspaceId,
        collection: "tasks",
        id: "task",
        version: 1,
        value: { title: "Original" },
      },
      null,
      "CREATE",
      { title: "Original" },
    );
    await stage.commit();
    const sync = {
      workspaceId: actor.workspaceId,
      remoteWorkspaceId: "remote",
      serverOrigin: "https://example.test",
      epoch: "epoch",
      cursor: 0,
      version: 1,
    };
    await db.syncState.save(sync, null);
    const input: LocalOutboxTransition = {
      workspaceId: actor.workspaceId,
      mutationId: "mutation",
      binding: {
        version: 1,
        remoteWorkspaceId: "remote",
        serverOrigin: "https://example.test",
      },
      expectedState: "PENDING",
      expectedAttemptCount: 0,
      expectedLastAttemptAt: null,
      nextState: "SENDING",
      at: "2026-10-13T00:01:00Z",
    };
    const claims = await Promise.allSettled([
      db.outbox.transition(input),
      db.outbox.transition(input),
    ]);
    const finish: LocalOutboxTransition = {
      ...input,
      expectedState: "SENDING",
      expectedAttemptCount: 1,
      expectedLastAttemptAt: input.at,
      nextState: "PENDING",
    };
    await db.outbox.transition(finish);
    const second = await db.outbox.transition({
      ...input,
      expectedAttemptCount: 1,
      expectedLastAttemptAt: input.at,
      at: "2026-10-13T00:02:00Z",
    });
    const rejected = async (candidate: LocalOutboxTransition) => {
      try {
        await db.outbox.transition(candidate);
        return "unexpected-success";
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    };
    const oldAttempt = await rejected(finish);
    await db.syncState.save(
      { ...sync, version: 2, remoteWorkspaceId: "another-remote" },
      1,
    );
    const oldBinding = await rejected({
      ...finish,
      expectedAttemptCount: 2,
      expectedLastAttemptAt: second.lastAttemptAt,
    });
    const beforeRecovery = await db.outbox.list(actor.workspaceId);
    const recovered = await db.outbox.recoverSending(actor.workspaceId);
    const afterRecovery = await db.outbox.list(actor.workspaceId);
    db.close();
    const reopened = await api.IndexedDbLocalStore.open("outbox-attempt");
    const persisted = await reopened.outbox.list(actor.workspaceId);
    reopened.close();
    return {
      claims: claims.map((item) => item.status),
      oldAttempt,
      oldBinding,
      beforeRecovery,
      recovered,
      afterRecovery,
      persisted,
    };
  });
  expect(result.claims.sort()).toEqual(["fulfilled", "rejected"]);
  expect(result.oldAttempt).toBe("VERSION_CONFLICT");
  expect(result.oldBinding).toBe("VERSION_CONFLICT");
  expect(result.beforeRecovery[0]).toMatchObject({
    id: "mutation",
    deviceId: "original-device",
    state: "SENDING",
    attemptCount: 2,
    payload: { title: "Original" },
  });
  expect(result.recovered).toBe(1);
  expect(result.afterRecovery[0]).toEqual({
    ...result.beforeRecovery[0],
    state: "PENDING",
  });
  expect(result.persisted).toEqual(result.afterRecovery);
});

test("same original bytes share one verified Blob across File MIME declarations and survive reopen", async ({
  page,
}, info) => {
  const bundle = await readFile(
    `.artifacts/local-storage-fixture-${info.workerIndex}/storage.js`,
    "utf8",
  );
  await page.route("http://127.0.0.1:19420/file-deduplication", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>File deduplication</title>",
    }),
  );
  await page.goto("http://127.0.0.1:19420/file-deduplication");
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async () => {
    const api = (
      window as unknown as { OrivaneLocalStorageFixture: LocalWorkFixture }
    ).OrivaneLocalStorageFixture;
    const db = await api.IndexedDbLocalStore.open("file-dedupe"),
      blobs = await api.IndexedDbLocalBlobStore.open("file-dedupe");
    const identity = await db.identity.ensure({
      schemaVersion: 1,
      workspaceId: crypto.randomUUID(),
      principalId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
    });
    const workspace = new api.LocalWorkspace(
      db.metadata,
      blobs,
      identity,
      {
        extract: (id, markdown) => api.indexDocument(id, markdown, []),
        resolve: (links, entries) => {
          const aliases = api.buildAliasIndex(entries);
          return links.map((link) => ({
            ...link,
            targetDocumentId:
              aliases.get(api.normalizeWikiTitle(link.targetText)) ?? null,
          }));
        },
      },
      { now: () => "2026-10-13T00:00:00Z", calendarTimezone: "Asia/Shanghai" },
      { next: () => crypto.randomUUID() },
    );
    const runtime = new api.LocalRuntime(workspace);
    let beginCount = 0;
    const begin = blobs.begin.bind(blobs);
    blobs.begin = async (upload) => {
      beginCount++;
      await begin(upload);
    };
    const bytes = new Blob([new Uint8Array([0, 1, 127, 128, 255])]);
    const first = await runtime.uploadFile(
      { name: "Original.txt", mime: "text/plain", spaceId: null },
      bytes,
    );
    const second = await runtime.uploadFile(
      { name: "Original.bin", mime: "application/octet-stream", spaceId: null },
      bytes,
    );
    const hashes = await blobs.listHashes(identity.workspaceId),
      pending = await db.outbox.list(identity.workspaceId);
    const foreign = await blobs.get(crypto.randomUUID(), first.contentHash);
    db.close();
    blobs.close();
    const reopened = await api.IndexedDbLocalStore.open("file-dedupe"),
      reopenedBlobs = await api.IndexedDbLocalBlobStore.open("file-dedupe");
    const saved = await reopened.metadata.list(identity.workspaceId, "files"),
      original = await reopenedBlobs.get(
        identity.workspaceId,
        second.contentHash,
      );
    const originalBytes = original
      ? [...new Uint8Array(await original.arrayBuffer())]
      : null;
    reopened.close();
    reopenedBlobs.close();
    return {
      distinctIds: first.id !== second.id,
      sameHash: first.contentHash === second.contentHash,
      mime: [first.mime, second.mime],
      beginCount,
      hashes,
      hash: first.contentHash,
      pendingCount: pending.length,
      foreign,
      savedCount: saved.length,
      originalBytes,
    };
  });
  expect(result).toEqual({
    distinctIds: true,
    sameHash: true,
    mime: ["text/plain", "application/octet-stream"],
    beginCount: 1,
    hashes: [result.hash],
    hash: result.hash,
    pendingCount: 2,
    foreign: null,
    savedCount: 2,
    originalBytes: [0, 1, 127, 128, 255],
  });
});

test("local indexed search narrows 2000 documents without listing body or search collections", async ({
  page,
}, info) => {
  const bundle = await readFile(
    `.artifacts/local-storage-fixture-${info.workerIndex}/storage.js`,
    "utf8",
  );
  await page.route("http://127.0.0.1:19420/search-index", (route) =>
    route.fulfill({ contentType: "text/html", body: "<html></html>" }),
  );
  await page.goto("http://127.0.0.1:19420/search-index");
  await page.addScriptTag({ content: bundle });
  const evidence = await page.evaluate(async () => {
    const api = (
      window as unknown as { OrivaneLocalStorageFixture: LocalWorkFixture }
    ).OrivaneLocalStorageFixture;
    const db = await api.IndexedDbLocalStore.open("search-scale");
    const writes: LocalWrite[] = [],
      records: { entity: LocalWrite["entity"]; expectedVersion: null }[] = [];
    const body = "正文 ordinary text ".repeat(80);
    for (let index = 0; index < 2000; index++) {
      const id = `document-${index}`;
      writes.push({
        entity: {
          workspaceId: "w",
          collection: "library",
          id,
          version: 1,
          value: { id, title: id },
        },
        expectedVersion: null,
        mutation: {
          id,
          deviceId: "device",
          workspaceId: "w",
          principalId: "owner",
          operation: "CREATE",
          entityType: "library",
          entityId: id,
          baseVersion: null,
          payload: { id },
          createdAt: "2026-10-13T00:00:00Z",
          attemptCount: 0,
          lastAttemptAt: null,
          state: "PENDING",
        },
      });
      records.push({
        entity: {
          workspaceId: "w",
          collection: "$local.librarySearch",
          id,
          version: 1,
          value: {
            text: body + (index === 1777 ? "唯一needle" : id),
            deletedAt: null,
          },
        },
        expectedVersion: null,
      });
    }
    const writeStart = performance.now();
    await db.metadata.commit("w", "owner", writes, records);
    const writeMs = performance.now() - writeStart;
    const originalList = db.metadata.list;
    db.metadata.list = async (workspaceId, collection) => {
      if (collection.includes("Search") || collection.includes("Body"))
        throw new Error("FULL_TEXT_SCAN_FORBIDDEN");
      return originalList(workspaceId, collection);
    };
    const uow = new api.LocalWorkUnitOfWork(
      db.metadata,
      { workspaceId: "w", principalId: "owner" },
      "device",
      { now: () => "2026-10-13T00:00:00Z" },
      { next: () => crypto.randomUUID() },
    );
    const queryStart = performance.now();
    const blobs = await api.IndexedDbLocalBlobStore.open("search-scale");
    const ids = await uow.runWithLibrary(
      "w",
      {
        extract: (id, body) => api.indexDocument(id, body, []),
        resolve: (links) => [...links],
      },
      (stage, publish) =>
        new api.LocalImageAssets(
          stage,
          blobs,
          { workspaceId: "w", principalId: "owner" },
          { now: () => "2026-10-13T00:00:00Z" },
          { next: () => crypto.randomUUID() },
          publish,
        ),
      (_work, _notes, library) => library.searchIds!("唯一needle"),
    );
    const queryMs = performance.now() - queryStart;
    const candidates = await db.metadata.searchCandidates!(
      "w",
      "$local.librarySearch",
      "唯一n",
    );
    const foreign = await db.metadata.searchCandidates!(
      "foreign",
      "$local.librarySearch",
      "唯一n",
    );
    db.close();
    blobs.close();
    return {
      ids,
      candidateCount: candidates.length,
      foreignCount: foreign.length,
      writeMs,
      queryMs,
    };
  });
  expect(evidence.ids).toEqual(["document-1777"]);
  expect(evidence.candidateCount).toBe(1);
  expect(evidence.foreignCount).toBe(0);
  await info.attach("local-search-2000", {
    body: JSON.stringify(evidence),
    contentType: "application/json",
  });
  await writeFile(
    info.outputPath("local-search.json"),
    JSON.stringify(evidence, null, 2),
  );
});

test("binary chunks resume after restart and publish only verified complete bytes", async ({
  page,
}, info) => {
  const bundle = await readFile(
    `.artifacts/local-storage-fixture-${info.workerIndex}/storage.js`,
    "utf8",
  );
  await page.route("http://127.0.0.1:19420/chunks", (route) =>
    route.fulfill({ contentType: "text/html", body: "<html></html>" }),
  );
  await page.goto("http://127.0.0.1:19420/chunks");
  await page.addScriptTag({ content: bundle });
  const first = await page.evaluate(async () => {
    const api = (
      window as unknown as { OrivaneLocalStorageFixture: LocalWorkFixture }
    ).OrivaneLocalStorageFixture;
    const old = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("resumable.blobs", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("blobs");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const original = new Blob(["legacy original"]);
    const legacyHash = [
      ...new Uint8Array(
        await crypto.subtle.digest("SHA-256", await original.arrayBuffer()),
      ),
    ]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("");
    await new Promise<void>((resolve, reject) => {
      const tx = old.transaction("blobs", "readwrite");
      tx.objectStore("blobs").put(original, ["w", legacyHash]);
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    old.close();
    const db = await api.IndexedDbLocalBlobStore.open("resumable");
    const legacyPreserved = await (await db.get("w", legacyHash))!.text();
    const bytes = new Blob([new Uint8Array([0, 128, 255, 1, 2])]);
    const hash = await db.digest(bytes);
    await db.begin({
      workspaceId: "w",
      sha256: hash,
      size: 5,
      mime: "application/octet-stream",
      chunkSize: 3,
    });
    const chunk = bytes.slice(0, 3);
    await db.putChunk("w", hash, 0, await db.digest(chunk), chunk);
    await db.putChunk("w", hash, 0, await db.digest(chunk), chunk);
    let incomplete = "";
    try {
      await db.complete("w", hash);
    } catch (error) {
      incomplete = String(error);
    }
    const hidden = await db.get("w", hash);
    db.close();
    return { hash, incomplete, hidden: hidden === null, legacyPreserved };
  });
  expect(first.incomplete).toContain("INVALID_WRITE");
  expect(first.hidden).toBe(true);
  expect(first.legacyPreserved).toBe("legacy original");
  await page.reload();
  await page.addScriptTag({ content: bundle });
  const recovered = await page.evaluate(async (hash) => {
    const api = (
      window as unknown as { OrivaneLocalStorageFixture: LocalWorkFixture }
    ).OrivaneLocalStorageFixture;
    const db = await api.IndexedDbLocalBlobStore.open("resumable");
    const present = await db.chunks("w", hash);
    const chunk = new Blob([new Uint8Array([1, 2])]);
    let badHash = "";
    try {
      await db.putChunk("w", hash, 1, "a".repeat(64), chunk);
    } catch (error) {
      badHash = String(error);
    }
    await db.putChunk("w", hash, 1, await db.digest(chunk), chunk);
    await db.complete("w", hash);
    await db.complete("w", hash);
    const bytes = await db.get("w", hash);
    const foreign = await db.get("foreign", hash);
    db.close();
    return {
      present,
      badHash,
      bytes: [...new Uint8Array(await bytes!.arrayBuffer())],
      foreign: foreign === null,
    };
  }, first.hash);
  expect(recovered).toEqual({
    present: [0],
    badHash: "LocalStorageError: HASH_MISMATCH",
    bytes: [0, 128, 255, 1, 2],
    foreign: true,
  });
});

test("local service composition shares Project knowledge, Note promotion, ordering, Calendar and Recurrence in one durable workspace", async ({
  page,
}, info) => {
  const bundle = await readFile(
    `.artifacts/local-storage-fixture-${info.workerIndex}/storage.js`,
    "utf8",
  );
  await page.route("http://127.0.0.1:19420/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Local Application composition</title>",
    }),
  );
  await page.goto("http://127.0.0.1:19420/composition");
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async () => {
    const api = (
      window as unknown as { OrivaneLocalStorageFixture: LocalWorkFixture }
    ).OrivaneLocalStorageFixture;
    const db = await api.IndexedDbLocalStore.open("local-composition"),
      blobs = await api.IndexedDbLocalBlobStore.open("local-composition");
    const identity = await db.identity.ensure({
      schemaVersion: 1,
      workspaceId: crypto.randomUUID(),
      principalId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
    });
    const indexer = {
      extract: (sourceId: string, markdown: string) =>
        api.indexDocument(sourceId, markdown, []),
      resolve: (
        links: ReturnType<typeof api.indexDocument>,
        entries: Parameters<typeof api.buildAliasIndex>[0],
      ) => {
        const aliases = api.buildAliasIndex(entries);
        return links.map((link) => ({
          ...link,
          targetDocumentId:
            aliases.get(api.normalizeWikiTitle(link.targetText)) ?? null,
        }));
      },
    };
    const workspace = new api.LocalWorkspace(
      db.metadata,
      blobs,
      identity,
      indexer,
      { now: () => "2026-10-12T00:00:00Z", calendarTimezone: "Asia/Shanghai" },
      { next: () => crypto.randomUUID() },
    );
    const created = await workspace.run(async (services) => {
      const context = services.context;
      const category = await services.categories.save(context, {
        name: "Local category",
        version: 0,
        deleted: false,
      });
      const project = await services.work.create(context, {
        title: "Local root",
        type: "PROJECT",
        categoryId: category.id,
      });
      const child = await services.work.create(context, {
        title: "Child",
        type: "PROJECT",
        parentProjectId: project.id,
      });
      const direct = await services.work.create(context, {
        title: "Direct",
        projectIds: [project.id],
      });
      const nested = await services.work.create(context, {
        title: "Nested",
        projectIds: [child.id],
      });
      const order = await services.orders.move(context, {
        scope: { kind: "PROJECT_TASKS", projectId: project.id },
        version: 0,
        entityId: nested.id,
        anchorId: direct.id,
        placement: "BEFORE",
      });
      const space = await services.projects.createProjectSpace(context, {
        projectId: project.id,
        title: "Project knowledge",
        inheritToChildren: true,
      });
      const document = await services.projects.createProjectDocument(context, {
        projectId: project.id,
        spaceId: space.spaceId,
        title: "Project document",
        bodyMd: "Preserved project Markdown\nSecond line",
      });
      const note = await services.notes.save(context, null, 0, {
        title: "Capture",
        kind: "NOTE",
        day: null,
        bodyMd: "Captured Markdown\nSecond line",
      });
      const promoted = await services.noteKnowledge.promoteNoteToDocument(
        context,
        note.id,
        1,
        { spaceId: space.spaceId, archiveSourceNote: false },
      );
      await services.work.setCalendarSettings(context, 0, "Europe/Paris");
      const rule = await services.workflows.saveRecurrence(context, {
        version: 0,
        deleted: false,
        rule: {
          title: "Daily local",
          descriptionMd: "Repeat body",
          startDate: "2026-10-12",
          timezone: "Asia/Shanghai",
          frequency: "DAILY",
          interval: 1,
          projectIds: [project.id],
          endAfterCompleted: 1,
        },
      });
      await services.workflows.tick(context, rule.id);
      return {
        project: project.id,
        child: child.id,
        direct: direct.id,
        nested: nested.id,
        document: document.id,
        promoted: promoted.id,
        note: note.id,
        space: space.spaceId,
        order: order.entries.map((value) => value.entityId),
        rule: rule.id,
      };
    });
    const runtime = new api.LocalRuntime(workspace);
    const snapshot = await runtime.loadWorkspace();
    const occurrence = snapshot.workflows?.find(
      (value) => value.payload.kind === "OCCURRENCE",
    );
    let actorRejected = false;
    try {
      await runtime.service.create(
        { workspaceId: identity.workspaceId, principalId: "foreign" },
        { title: "Must reject" },
      );
    } catch (error) {
      actorRejected = error instanceof Error && error.message === "FORBIDDEN";
    }
    let atomic = false;
    const before = (await db.outbox.list(identity.workspaceId)).length;
    try {
      await workspace.run(async (services) => {
        await services.notes.save(services.context, null, 0, {
          title: "Aborted capture",
          kind: "NOTE",
          day: null,
          bodyMd: "Must not persist",
        });
        throw new Error("EXPECTED_ABORT");
      });
    } catch (error) {
      atomic = error instanceof Error && error.message === "EXPECTED_ABORT";
    }
    atomic =
      atomic && before === (await db.outbox.list(identity.workspaceId)).length;
    db.close();
    blobs.close();
    return {
      created,
      identity,
      actorRejected,
      atomic,
      taskCount: snapshot.items.filter((value) => value.type === "TASK").length,
      links: snapshot.links.length,
      materials: snapshot.projectMaterials.length,
      unloaded:
        snapshot.notes.every((value) => !Object.hasOwn(value, "bodyMd")) &&
        snapshot.library.every((value) => !Object.hasOwn(value, "bodyMd")),
      timezone: snapshot.calendarTimezone,
      occurrence:
        occurrence?.payload.kind === "OCCURRENCE"
          ? occurrence.payload.status
          : null,
    };
  });
  expect(result).toMatchObject({
    actorRejected: true,
    atomic: true,
    taskCount: 3,
    links: 1,
    materials: 2,
    unloaded: true,
    timezone: "Europe/Paris",
    occurrence: "OPEN",
  });
  expect(result.created.order).toEqual([
    result.created.nested,
    result.created.direct,
  ]);
  await page.reload();
  await page.addScriptTag({ content: bundle });
  const recovered = await page.evaluate(async ({ created, identity }) => {
    const api = (
      window as unknown as { OrivaneLocalStorageFixture: LocalWorkFixture }
    ).OrivaneLocalStorageFixture;
    const db = await api.IndexedDbLocalStore.open("local-composition"),
      blobs = await api.IndexedDbLocalBlobStore.open("local-composition");
    const saved = await db.identity.get();
    if (!saved) throw new Error("MISSING_IDENTITY");
    const indexer = {
      extract: (sourceId: string, markdown: string) =>
        api.indexDocument(sourceId, markdown, []),
      resolve: (
        links: ReturnType<typeof api.indexDocument>,
        entries: Parameters<typeof api.buildAliasIndex>[0],
      ) => {
        const aliases = api.buildAliasIndex(entries);
        return links.map((link) => ({
          ...link,
          targetDocumentId:
            aliases.get(api.normalizeWikiTitle(link.targetText)) ?? null,
        }));
      },
    };
    const workspace = new api.LocalWorkspace(
      db.metadata,
      blobs,
      saved,
      indexer,
      { now: () => "2026-10-12T00:00:00Z", calendarTimezone: "Asia/Shanghai" },
      { next: () => crypto.randomUUID() },
    );
    const runtime = new api.LocalRuntime(workspace);
    const before = await runtime.loadWorkspace();
    const occurrence = before.workflows?.find(
      (value) => value.payload.kind === "OCCURRENCE",
    );
    if (
      !occurrence ||
      occurrence.payload.kind !== "OCCURRENCE" ||
      !occurrence.payload.taskId
    )
      throw new Error("MISSING_OCCURRENCE");
    const occurrenceTaskId = occurrence.payload.taskId;
    const task = before.items.find((value) => value.id === occurrenceTaskId);
    if (!task) throw new Error("MISSING_OCCURRENCE_TASK");
    await runtime.service.update(runtime.context, task.id, task.version, {
      status: "DONE",
    });
    await workspace.run(async (services) => {
      await services.workflows.tick(services.context, created.rule);
    });
    const after = await runtime.loadWorkspace();
    const manifest = after.library.find(
      (value) => value.id === created.promoted,
    );
    if (!manifest) throw new Error("MISSING_DOCUMENT_MANIFEST");
    const document = await runtime.readDocumentBody(manifest);
    let foreignBodyRejected = false;
    try {
      await runtime.readDocumentBody({ ...manifest, workspaceId: "foreign" });
    } catch (error) {
      foreignBodyRejected =
        error instanceof Error && error.message === "NOT_FOUND";
    }
    let futureBodyRejected = false;
    try {
      await runtime.readDocumentBody({
        ...manifest,
        version: manifest.version + 1,
      });
    } catch (error) {
      futureBodyRejected =
        error instanceof Error && error.message === "VERSION_CONFLICT";
    }
    const bindings = await workspace.run((services) =>
      services.projects.listProjectSpaces(
        services.context,
        created.child,
        true,
      ),
    );
    const definition = after.workflows?.find(
      (value) => value.id === created.rule,
    );
    const completed = after.workflows?.find(
      (value) => value.id === occurrence.id,
    );
    db.close();
    blobs.close();
    return {
      identitySame:
        saved.workspaceId === identity.workspaceId &&
        saved.principalId === identity.principalId &&
        saved.deviceId === identity.deviceId,
      body: document.bodyMd,
      foreignBodyRejected,
      futureBodyRejected,
      policy: document.aiPolicy,
      inheritance: bindings.some((value) => value.spaceId === created.space),
      order: after.manualOrders?.[0]?.entries.map((value) => value.entityId),
      noteCount: after.notes.length,
      ruleState:
        definition?.payload.kind === "RECURRENCE"
          ? definition.payload.state
          : null,
      occurrenceState:
        completed?.payload.kind === "OCCURRENCE"
          ? completed.payload.status
          : null,
    };
  }, result);
  expect(recovered).toEqual({
    identitySame: true,
    body: "Captured Markdown\nSecond line",
    foreignBodyRejected: true,
    futureBodyRejected: true,
    policy: {
      classification: "PRIVATE",
      processingBoundary: "LOCAL_ONLY",
      aiAccess: "DENY",
    },
    inheritance: true,
    order: [result.created.nested, result.created.direct],
    noteCount: 1,
    ruleState: "ENDED",
    occurrenceState: "COMPLETED",
  });
});

test("local Runtime edits survive restart without a server or account", async ({
  page,
}, info) => {
  const bundle = await readFile(
    `.artifacts/local-storage-fixture-${info.workerIndex}/storage.js`,
    "utf8",
  );
  let unexpectedRequests = 0;
  await page.route("**/*", (route) => {
    if (route.request().url() === "http://127.0.0.1:19420/runtime")
      return route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Offline local Runtime</title>",
      });
    unexpectedRequests++;
    return route.abort();
  });
  await page.goto("http://127.0.0.1:19420/runtime");
  await page.addScriptTag({ content: bundle });
  const created = await page.evaluate(async () => {
    const api = (
      window as unknown as { OrivaneLocalStorageFixture: LocalWorkFixture }
    ).OrivaneLocalStorageFixture;
    const db = await api.IndexedDbLocalStore.open("local-runtime-offline"),
      blobs = await api.IndexedDbLocalBlobStore.open("local-runtime-offline");
    const identity = await db.identity.ensure({
      schemaVersion: 1,
      workspaceId: crypto.randomUUID(),
      principalId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
    });
    const indexer = {
      extract: (id: string, body: string) => api.indexDocument(id, body, []),
      resolve: (
        links: ReturnType<typeof api.indexDocument>,
        entries: Parameters<typeof api.buildAliasIndex>[0],
      ) => {
        const aliases = api.buildAliasIndex(entries);
        return links.map((link) => ({
          ...link,
          targetDocumentId:
            aliases.get(api.normalizeWikiTitle(link.targetText)) ?? null,
        }));
      },
    };
    const runtime = new api.LocalRuntime(
      new api.LocalWorkspace(
        db.metadata,
        blobs,
        identity,
        indexer,
        {
          now: () => "2026-10-12T00:00:00Z",
          calendarTimezone: "Asia/Shanghai",
        },
        { next: () => crypto.randomUUID() },
      ),
    );
    const project = await runtime.service.create(runtime.context, {
      title: "Offline project",
      type: "PROJECT",
    });
    const task = await runtime.service.create(runtime.context, {
      title: "Offline task",
      projectIds: [project.id],
    });
    const note = await runtime.saveNote(null, 0, {
      title: "Offline capture",
      kind: "NOTE",
      day: null,
      bodyMd: "Original\nMarkdown",
    });
    const edited = await runtime.saveNote(note.id, note.version, {
      title: note.title,
      kind: "NOTE",
      day: null,
      bodyMd: "Edited\nMarkdown",
    });
    const journal = await runtime.saveNote(null, 0, {
      title: "Offline journal",
      kind: "JOURNAL",
      day: "2026-10-12",
      bodyMd: "Day-bound original",
    });
    const space = await runtime.createProjectSpace({
      projectId: project.id,
      title: "Local knowledge",
      inheritToChildren: true,
    });
    const document = await runtime.createProjectDocument({
      projectId: project.id,
      spaceId: space.spaceId,
      title: "Local document",
      bodyMd: "Document\nSource",
    });
    const revised = await runtime.saveLibrary(document.id, document.version, {
      kind: "DOCUMENT",
      spaceId: space.spaceId,
      title: document.title,
      bodyMd: "Revised\nSource",
    });
    const removed = await runtime.deleteLibrary(
      revised.id,
      revised.version,
      true,
    );
    const restored = await runtime.deleteLibrary(
      removed.id,
      removed.version,
      false,
    );
    const reminder = await runtime.saveReminder(null, 0, {
      title: "Local reminder",
      bodyMd: "Reminder context",
      day: "2026-10-12",
      time: "09:00",
      timezone: "Asia/Shanghai",
      notifyMode: "MINUTES_BEFORE",
      notifyOffsetMinutes: 15,
      linkedProjectId: project.id,
      linkedTaskId: task.id,
      state: "ACTIVE",
    });
    const done = await runtime.saveReminder(reminder.id, reminder.version, {
      ...reminder,
      state: "DONE",
    });
    const noteRevisions = await runtime.revisions(note.id),
      documentRevisions = await runtime.libraryRevisions(document.id);
    const snapshot = await runtime.loadWorkspace();
    const unloaded = [...snapshot.notes, ...snapshot.library].every(
      (value) => !Object.hasOwn(value, "bodyMd"),
    );
    const pending = await db.outbox.list(identity.workspaceId);
    const originalBytes = [0, 1, 2, 127, 128, 254, 255];
    const uploadedFile = await runtime.uploadFile(
      { name: "原始.bin", mime: "application/octet-stream", spaceId: null },
      new Blob([new Uint8Array(originalBytes)]),
    );
    const renamedFile = await runtime.renameFile(
      uploadedFile.id,
      uploadedFile.version,
      "Display.txt",
    );
    const deletedFile = await runtime.deleteFile(
      renamedFile.id,
      renamedFile.version,
      true,
    );
    const restoredFile = await runtime.deleteFile(
      deletedFile.id,
      deletedFile.version,
      false,
    );
    const backup = await runtime.backup();
    const header = new Uint8Array(await backup.slice(0, 16).arrayBuffer());
    if (new TextDecoder().decode(header.slice(0, 8)) !== "ORIVANE1")
      throw new Error("INVALID_BACKUP_MAGIC");
    const manifestLength = new DataView(header.buffer).getUint32(8, false);
    const backupManifest = JSON.parse(
      await backup.slice(16, 16 + manifestLength).text(),
    ) as {
      credentialVault: string;
      archive: {
        identity: { workspaceId: string };
        entities: { collection: string; value: unknown }[];
        mutations: unknown[];
      };
      blobs: { hash: string; offset: number; size: number }[];
    };
    if (
      backupManifest.credentialVault !== "EXCLUDED" ||
      backupManifest.archive.identity.workspaceId !== identity.workspaceId ||
      !backupManifest.archive.entities.some(
        (entity) => entity.collection === "$local.libraryBody",
      ) ||
      backupManifest.archive.mutations.length !== pending.length + 4
    )
      throw new Error("INCOMPLETE_LOCAL_BACKUP");
    const binaryDescriptor = backupManifest.blobs.find(
      (blob) => blob.hash === restoredFile.contentHash,
    );
    if (!binaryDescriptor) throw new Error("MISSING_BACKUP_ORIGINAL");
    const backupOriginal = [
      ...new Uint8Array(
        await backup
          .slice(
            16 + manifestLength + binaryDescriptor.offset,
            16 +
              manifestLength +
              binaryDescriptor.offset +
              binaryDescriptor.size,
          )
          .arrayBuffer(),
      ),
    ];
    if (
      backupOriginal.some((byte, index) => byte !== originalBytes[index]) ||
      backupOriginal.length !== originalBytes.length
    )
      throw new Error("BACKUP_ORIGINAL_CHANGED");
    const target = await api.IndexedDbLocalStore.open("restored-local-runtime"),
      targetBlobs = await api.IndexedDbLocalBlobStore.open(
        "restored-local-runtime",
      );
    const newDeviceId = crypto.randomUUID();
    await api.restoreLocalWorkspace(
      backup,
      newDeviceId,
      target.metadata,
      targetBlobs,
    );
    const restoredIdentity = await target.identity.get();
    if (
      restoredIdentity?.workspaceId !== identity.workspaceId ||
      restoredIdentity.deviceId !== newDeviceId ||
      (await target.outbox.list(identity.workspaceId)).length !==
        pending.length + 4
    )
      throw new Error("RESTORE_IDENTITY_OR_OUTBOX_CHANGED");
    const restoredOriginal = await targetBlobs.get(
      identity.workspaceId,
      restoredFile.contentHash,
    );
    if (
      !restoredOriginal ||
      (await restoredOriginal.arrayBuffer()).byteLength !== originalBytes.length
    )
      throw new Error("RESTORE_ORIGINAL_MISSING");
    let occupiedRejected = false;
    try {
      await api.restoreLocalWorkspace(
        backup,
        crypto.randomUUID(),
        target.metadata,
        targetBlobs,
      );
    } catch (error) {
      occupiedRejected = String(error).includes(
        "LOCAL_RESTORE_TARGET_NOT_EMPTY",
      );
    }
    if (!occupiedRejected)
      throw new Error("RESTORE_REPLACED_EXISTING_WORKSPACE");
    const filePlans = (
      await api.planLocalCommands(
        runtime.context,
        db.metadata,
        await db.outbox.list(identity.workspaceId),
      )
    ).filter((plan) => plan.command?.name.startsWith("file."));
    if (
      filePlans.length !== 4 ||
      filePlans.some(
        (plan) => plan.state !== "READY" || plan.mutations.length !== 1,
      )
    )
      throw new Error("ORIGINAL_FILE_COMMAND_GROUP_MISSING");
    const fileCommands = filePlans.map((plan) => plan.command);
    if (
      JSON.stringify(fileCommands.map((command) => command?.name)) !==
      JSON.stringify([
        "file.upload",
        "file.rename",
        "file.delete",
        "file.delete",
      ])
    )
      throw new Error("ORIGINAL_FILE_COMMAND_ORDER_CHANGED");
    const uploadInput = fileCommands[0]?.input;
    if (
      !uploadInput ||
      typeof uploadInput !== "object" ||
      Array.isArray(uploadInput) ||
      JSON.stringify(uploadInput) !==
        JSON.stringify({
          id: uploadedFile.id,
          input: {
            name: "原始.bin",
            mime: "application/octet-stream",
            spaceId: null,
          },
          contentHash: uploadedFile.contentHash,
          size: originalBytes.length,
        })
    )
      throw new Error("ORIGINAL_UPLOAD_INPUT_CHANGED_AFTER_RENAME");
    const restoredFilePlans = (
      await api.planLocalCommands(
        runtime.context,
        target.metadata,
        await target.outbox.list(identity.workspaceId),
      )
    ).filter((plan) => plan.command?.name.startsWith("file."));
    if (JSON.stringify(restoredFilePlans) !== JSON.stringify(filePlans))
      throw new Error("RESTORE_ORIGINAL_FILE_COMMAND_CHANGED");
    const knowledgeCommands = (
      await db.metadata.list(identity.workspaceId, "$local.command")
    ).filter(
      (entry) =>
        JSON.stringify(entry.value).includes('"note.save"') ||
        JSON.stringify(entry.value).includes('"library.save"') ||
        JSON.stringify(entry.value).includes('"library.delete"'),
    );
    const knowledgeCommandJson = JSON.stringify(knowledgeCommands);
    const knowledgePlans = (
      await api.planLocalCommands(
        runtime.context,
        db.metadata,
        await db.outbox.list(identity.workspaceId),
      )
    ).filter((plan) => knowledgeCommands.some((entry) => entry.id === plan.id));
    const knowledgeRequests = knowledgePlans.map((plan) =>
      api.buildLocalKnowledgeReplayRequest(plan),
    );
    if (knowledgeRequests.some((request) => request === null))
      throw new Error("KNOWLEDGE_ORIGINAL_REQUEST_MISSING");
    const restoredKnowledgePlans = (
      await api.planLocalCommands(
        runtime.context,
        target.metadata,
        await target.outbox.list(identity.workspaceId),
      )
    ).filter((plan) => knowledgeCommands.some((entry) => entry.id === plan.id));
    if (
      JSON.stringify(
        restoredKnowledgePlans.map((plan) =>
          api.buildLocalKnowledgeReplayRequest(plan),
        ),
      ) !== JSON.stringify(knowledgeRequests)
    )
      throw new Error("RESTORE_ORIGINAL_KNOWLEDGE_REQUEST_CHANGED");
    const restoredKnowledgeCommands = (
      await target.metadata.list(identity.workspaceId, "$local.command")
    ).filter((entry) =>
      knowledgeCommands.some((original) => original.id === entry.id),
    );
    if (JSON.stringify(restoredKnowledgeCommands) !== knowledgeCommandJson)
      throw new Error("RESTORE_ORIGINAL_KNOWLEDGE_COMMAND_CHANGED");
    target.close();
    targetBlobs.close();
    let staleFileRejected = false;
    try {
      await runtime.renameFile(
        restoredFile.id,
        uploadedFile.version,
        "Must not overwrite.bin",
      );
    } catch (error) {
      staleFileRejected =
        error instanceof Error && error.message === "VERSION_CONFLICT";
    }
    const fileMetadata = (
      await db.metadata.get(identity.workspaceId, "files", restoredFile.id)
    )?.value;
    const fileOutbox = (await db.outbox.list(identity.workspaceId)).filter(
      (value) => value.entityType === "files",
    );
    db.close();
    blobs.close();
    return {
      identity,
      knowledgeCommandJson,
      knowledgeRequestsJson: JSON.stringify(knowledgeRequests),
      note: edited.id,
      journal: journal.id,
      document: restored.id,
      reminder: done.id,
      unloaded,
      noteBodies: noteRevisions.map((value) => value.bodyMd),
      documentBodies: documentRevisions.map((value) => value.bodyMd),
      pending: pending.length,
      file: restoredFile.id,
      staleFileRejected,
      originalBytes,
      filePayloadsMetadataOnly:
        !JSON.stringify([fileMetadata, fileOutbox]).includes("base64") &&
        !JSON.stringify([fileMetadata, fileOutbox]).includes("bodyMd"),
    };
  });
  expect(created.unloaded).toBe(true);
  expect(created.noteBodies).toContain("Original\nMarkdown");
  expect(created.noteBodies).toContain("Edited\nMarkdown");
  expect(created.documentBodies).toContain("Document\nSource");
  expect(created.documentBodies).toContain("Revised\nSource");
  expect(created.pending).toBe(14);
  const knowledgeCommands = JSON.parse(created.knowledgeCommandJson);
  expect(knowledgeCommands).toHaveLength(6);
  const knowledgeRequests = JSON.parse(created.knowledgeRequestsJson);
  expect(knowledgeRequests).toHaveLength(6);
  expect(knowledgeRequests).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: "/api/v1/note/save",
        body: expect.objectContaining({
          id: null,
          stableId: created.note,
          version: 0,
          input: expect.objectContaining({ bodyMd: "Original\nMarkdown" }),
        }),
      }),
    ]),
  );
  expect(
    knowledgeCommands.map((entry: { value: unknown }) => entry.value),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: "note.save",
        input: expect.objectContaining({
          id: created.note,
          version: 0,
          create: true,
          input: expect.objectContaining({ bodyMd: "Original\nMarkdown" }),
        }),
      }),
      expect.objectContaining({
        name: "note.save",
        input: expect.objectContaining({
          id: created.note,
          version: 1,
          create: false,
          input: expect.objectContaining({ bodyMd: "Edited\nMarkdown" }),
        }),
      }),
      expect.objectContaining({
        name: "library.save",
        input: expect.objectContaining({
          id: created.document,
          version: 1,
          create: false,
          input: expect.objectContaining({ bodyMd: "Revised\nSource" }),
        }),
      }),
    ]),
  );
  expect(created.staleFileRejected).toBe(true);
  expect(created.filePayloadsMetadataOnly).toBe(true);
  await page.reload();
  await page.addScriptTag({ content: bundle });
  const recovered = await page.evaluate(async (created) => {
    const api = (
      window as unknown as { OrivaneLocalStorageFixture: LocalWorkFixture }
    ).OrivaneLocalStorageFixture;
    const db = await api.IndexedDbLocalStore.open("local-runtime-offline"),
      blobs = await api.IndexedDbLocalBlobStore.open("local-runtime-offline");
    const identity = await db.identity.get();
    if (!identity) throw new Error("MISSING_IDENTITY");
    const originalKnowledgeCommands = JSON.parse(
      created.knowledgeCommandJson,
    ) as { id: string }[];
    const restartedKnowledgeCommands = (
      await db.metadata.list(identity.workspaceId, "$local.command")
    ).filter((entry) =>
      originalKnowledgeCommands.some((original) => original.id === entry.id),
    );
    if (
      JSON.stringify(restartedKnowledgeCommands) !==
      created.knowledgeCommandJson
    )
      throw new Error("RESTART_ORIGINAL_KNOWLEDGE_COMMAND_CHANGED");
    const runtime = new api.LocalRuntime(
      new api.LocalWorkspace(
        db.metadata,
        blobs,
        identity,
        {
          extract: (id, body) => api.indexDocument(id, body, []),
          resolve: (links) => [...links],
        },
        {
          now: () => "2026-10-12T00:00:00Z",
          calendarTimezone: "Asia/Shanghai",
        },
        { next: () => crypto.randomUUID() },
      ),
    );
    const snapshot = await runtime.loadWorkspace();
    const file = snapshot.files?.find((value) => value.id === created.file);
    if (!file) throw new Error("MISSING_FILE_AFTER_RESTART");
    const fileBytes = [
      ...new Uint8Array(
        await (await runtime.readFileBytes(file.id)).arrayBuffer(),
      ),
    ];
    const bodies = await Promise.all(
      [created.note, created.journal, created.document].map((id) => {
        const manifest = [...snapshot.notes, ...snapshot.library].find(
          (value) => value.id === id,
        );
        if (!manifest) throw new Error("MISSING_MANIFEST");
        return runtime.readDocumentBody(manifest);
      }),
    );
    const note = bodies.find((value) => value.id === created.note);
    const document = bodies.find((value) => value.id === created.document);
    if (!note || !document) throw new Error("MISSING_PURGE_SOURCE");
    await runtime.link(
      { kind: "NOTE", id: note.id },
      { kind: "DOCUMENT", id: document.id },
      "REFERENCES",
    );
    await runtime.organize({
      kind: "NOTE",
      action: "move",
      folder: "Temporary capture",
      entries: [{ id: note.id, version: note.version, organizationVersion: 0 }],
    });
    const deletedNote = await runtime.deleteNote(note.id, note.version, true);
    await runtime.purgeNote(deletedNote.id, deletedNote.version);
    const deletedDocument = await runtime.deleteLibrary(
      document.id,
      document.version,
      true,
    );
    await runtime.purgeLibrary(deletedDocument.id, deletedDocument.version);
    const purged = await runtime.loadWorkspace();
    const noteBody = await db.metadata.get(
      identity.workspaceId,
      "$local.noteBody",
      note.id,
    );
    const libraryBody = await db.metadata.get(
      identity.workspaceId,
      "$local.libraryBody",
      document.id,
    );
    const purgeClean =
      !purged.notes.some((value) => value.id === note.id) &&
      !purged.library.some((value) => value.id === document.id) &&
      purged.links.length === 0 &&
      purged.organization.length === 0 &&
      purged.projectMaterials.every(
        (value) => value.targetId !== document.id,
      ) &&
      !JSON.stringify([noteBody, libraryBody]).includes("Markdown") &&
      !JSON.stringify([noteBody, libraryBody]).includes("Source");
    db.close();
    blobs.close();
    return {
      purgeClean,
      file: {
        name: file.name,
        originalName: file.originalName,
        extension: file.extension,
        extractionStatus: file.extractionStatus,
        version: file.version,
        aiPolicy: file.aiPolicy,
        bytes: fileBytes,
      },
      identity,
      bodies: bodies.map((value) => value.bodyMd),
      reminders: snapshot.reminders?.map((value) => ({
        id: value.id,
        state: value.state,
      })),
      items: snapshot.items.length,
    };
  }, created);
  expect(recovered).toEqual({
    purgeClean: true,
    file: {
      name: "Display.txt",
      originalName: "原始.bin",
      extension: "bin",
      extractionStatus: "NOT_APPLICABLE",
      version: 4,
      aiPolicy: {
        classification: "PRIVATE",
        processingBoundary: "LOCAL_ONLY",
        aiAccess: "DENY",
      },
      bytes: created.originalBytes,
    },
    identity: created.identity,
    bodies: ["Edited\nMarkdown", "Day-bound original", "Revised\nSource"],
    reminders: [{ id: created.reminder, state: "DONE" }],
    items: 2,
  });
  expect(unexpectedRequests).toBe(0);
});

test("local invalidation hints follow durable commits across connections and exclude aborted writes", async ({
  page,
}, info) => {
  const bundle = await readFile(
    `.artifacts/local-storage-fixture-${info.workerIndex}/storage.js`,
    "utf8",
  );
  await page.route("http://127.0.0.1:19420/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Local commit hints</title>",
    }),
  );
  await page.goto("http://127.0.0.1:19420/hints");
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async () => {
    const api = (
      window as unknown as { OrivaneLocalStorageFixture: LocalWorkFixture }
    ).OrivaneLocalStorageFixture;
    const writer = await api.IndexedDbLocalStore.open("local-hints"),
      reader = await api.IndexedDbLocalStore.open("local-hints");
    const own: number[] = [],
      remote: number[] = [],
      errors: string[] = [];
    let foreign = 0;
    const observe = async (store: IndexedDbLocalStore, values: number[]) => {
      try {
        const entity = await store.metadata.get("workspace", "items", "item"),
          outbox = await store.outbox.list("workspace");
        if (!entity || outbox.length !== entity.version)
          throw new Error("HINT_BEFORE_DURABILITY");
        values.push(entity.version);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "INVALID_HINT");
      }
    };
    const stopOwn = writer.metadata.subscribe!(
      "workspace",
      () => void observe(writer, own),
    );
    const stopRemote = reader.metadata.subscribe!(
      "workspace",
      () => void observe(reader, remote),
    );
    const stopForeign = reader.metadata.subscribe!("foreign", () => foreign++);
    const write = (version: number, mutationId: string) => ({
      entity: {
        workspaceId: "workspace",
        collection: "items",
        id: "item",
        version,
        value: { version },
      },
      expectedVersion: version === 1 ? null : version - 1,
      mutation: {
        id: mutationId,
        workspaceId: "workspace",
        principalId: "owner",
        deviceId: "device",
        operation: "PATCH" as const,
        entityType: "items",
        entityId: "item",
        baseVersion: version === 1 ? null : version - 1,
        payload: { version },
        createdAt: "2026-10-12T00:00:00Z",
        attemptCount: 0,
        lastAttemptAt: null,
        state: "PENDING" as const,
      },
    });
    await writer.metadata.commit("workspace", "owner", [
      write(1, "mutation-1"),
    ]);
    const waitFor = async (condition: () => boolean) => {
      const until = performance.now() + 2000;
      while (!condition() && performance.now() < until)
        await new Promise((resolve) => setTimeout(resolve, 5));
      if (!condition()) throw new Error("MISSING_COMMIT_HINT");
    };
    await waitFor(() => own.length === 1 && remote.length === 1);
    let rejected = false;
    try {
      await writer.metadata.commit("workspace", "owner", [
        write(2, "mutation-1"),
      ]);
    } catch (error) {
      rejected =
        error instanceof DOMException && error.name === "ConstraintError";
    }
    await writer.metadata.commit("workspace", "owner", [
      write(2, "mutation-2"),
    ]);
    await waitFor(() => own.length === 2 && remote.length === 2);
    stopOwn();
    stopRemote();
    stopForeign();
    await writer.metadata.commit("workspace", "owner", [
      write(3, "mutation-3"),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 25));
    writer.close();
    reader.close();
    return { own, remote, foreign, rejected, errors };
  });
  expect(result).toEqual({
    own: [1, 2],
    remote: [1, 2],
    foreign: 0,
    rejected: true,
    errors: [],
  });
});

test("local installation identity is durable and concurrent first launches choose one stable workspace", async ({
  page,
}, info) => {
  const bundle = await readFile(
    `.artifacts/local-storage-fixture-${info.workerIndex}/storage.js`,
    "utf8",
  );
  await page.route("http://127.0.0.1:19420/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Local identity</title>",
    }),
  );
  await page.goto("http://127.0.0.1:19420/identity");
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async () => {
    const api = (
      window as unknown as { OrivaneLocalStorageFixture: LocalWorkFixture }
    ).OrivaneLocalStorageFixture;
    const first = await api.IndexedDbLocalStore.open("local-identity"),
      second = await api.IndexedDbLocalStore.open("local-identity");
    const candidate = () => ({
      schemaVersion: 1 as const,
      workspaceId: crypto.randomUUID(),
      principalId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
    });
    const empty = await first.identity.get();
    const [a, b] = await Promise.all([
      first.identity.ensure(candidate()),
      second.identity.ensure(candidate()),
    ]);
    let invalidRejected = false;
    try {
      await second.identity.ensure({ ...candidate(), deviceId: "invalid" });
    } catch (error) {
      invalidRejected =
        error instanceof Error && error.message === "LOCAL_IDENTITY_CORRUPT";
    }
    const retained = await first.identity.get();
    Object.assign(a, { workspaceId: crypto.randomUUID() });
    const detached = await second.identity.get();
    const noMutation = (await first.outbox.list(b.workspaceId)).length === 0;
    first.close();
    second.close();
    return { empty, b, retained, detached, invalidRejected, noMutation };
  });
  expect(result.empty).toBeNull();
  expect(result.retained).toEqual(result.b);
  expect(result.detached).toEqual(result.b);
  expect(result.invalidRejected).toBe(true);
  expect(result.noMutation).toBe(true);
  await page.reload();
  await page.addScriptTag({ content: bundle });
  const recovered = await page.evaluate(async () => {
    const api = (
      window as unknown as { OrivaneLocalStorageFixture: LocalWorkFixture }
    ).OrivaneLocalStorageFixture;
    const db = await api.IndexedDbLocalStore.open("local-identity");
    const value = await db.identity.get();
    db.close();
    return value;
  });
  expect(recovered).toEqual(result.b);
});

test("local schema v1 upgrades and restored v1 backups preserve exact entities, body, pending mutations and cursor", async ({
  page,
}, info) => {
  const bundle = await readFile(
    `.artifacts/local-storage-fixture-${info.workerIndex}/storage.js`,
    "utf8",
  );
  await page.route("http://127.0.0.1:19420/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Local v1 upgrade</title>",
    }),
  );
  await page.goto("http://127.0.0.1:19420/upgrade");
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async () => {
    const api = (
      window as unknown as { OrivaneLocalStorageFixture: LocalWorkFixture }
    ).OrivaneLocalStorageFixture;
    const entity = {
      workspaceId: "old-local",
      collection: "notes",
      id: "old-note",
      version: 2,
      value: { title: "Original", bodyMd: "原始正文\n第二行\n" },
    };
    const internalBody = {
      workspaceId: "old-local",
      collection: "$local.body",
      id: "original",
      version: 1,
      value: { bodyMd: "原始正文\n第二行\n" },
    };
    const mutation = {
      id: "old-pending",
      workspaceId: "old-local",
      deviceId: "old-device",
      principalId: "owner",
      operation: "PATCH",
      entityType: "notes",
      entityId: "old-note",
      baseVersion: 1,
      payload: entity.value,
      createdAt: "2026-10-12T00:00:00Z",
      attemptCount: 2,
      lastAttemptAt: "2026-10-12T00:00:01Z",
      state: "SENDING",
    };
    const sync = {
      workspaceId: "old-local",
      remoteWorkspaceId: "remote-workspace",
      serverOrigin: "https://example.invalid",
      epoch: "epoch",
      cursor: 17,
      version: 3,
    };
    const backup = {
      entities: [entity, internalBody],
      outbox: [mutation],
      sync: [sync],
    };
    const restore = async (name: string) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onupgradeneeded = () => {
          const entities = request.result.createObjectStore("entities", {
            keyPath: ["workspaceId", "collection", "id"],
          });
          entities.createIndex("collection", ["workspaceId", "collection"]);
          const outbox = request.result.createObjectStore("outbox", {
            keyPath: ["workspaceId", "id"],
          });
          outbox.createIndex("workspace", "workspaceId");
          request.result.createObjectStore("sync", { keyPath: "workspaceId" });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(["entities", "outbox", "sync"], "readwrite", {
          durability: "strict",
        });
        for (const [collection, values] of Object.entries(backup))
          for (const value of values) tx.objectStore(collection).add(value);
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
      db.close();
    };
    const results = [];
    for (const name of ["local-v1-original", "local-v1-restored-backup"]) {
      await restore(name);
      const db = await api.IndexedDbLocalStore.open(name);
      const preserved = {
        entities: await db.metadata.list("old-local", "notes"),
        body: await db.metadata.get("old-local", "$local.body", "original"),
        outbox: await db.outbox.list("old-local"),
        sync: await db.syncState.get("old-local"),
        identityBefore: await db.identity.get(),
      };
      const identity = await db.identity.ensure({
        schemaVersion: 1,
        workspaceId: crypto.randomUUID(),
        principalId: crypto.randomUUID(),
        deviceId: crypto.randomUUID(),
      });
      db.close();
      results.push({ preserved, identity });
    }
    return { entity, internalBody, mutation, sync, results };
  });
  for (const upgraded of result.results) {
    expect(upgraded.preserved).toEqual({
      entities: [result.entity],
      body: result.internalBody,
      outbox: [result.mutation],
      sync: result.sync,
      identityBefore: null,
    });
    expect(upgraded.identity.schemaVersion).toBe(1);
  }
  expect(result.results[0]?.identity.workspaceId).not.toBe(
    result.results[1]?.identity.workspaceId,
  );
});

test("corrupt durable local identity is rejected without replacing identity or deleting existing workspace data", async ({
  page,
}, info) => {
  const bundle = await readFile(
    `.artifacts/local-storage-fixture-${info.workerIndex}/storage.js`,
    "utf8",
  );
  await page.route("http://127.0.0.1:19420/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Identity corruption</title>",
    }),
  );
  await page.goto("http://127.0.0.1:19420/corrupt");
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async () => {
    const api = (
      window as unknown as { OrivaneLocalStorageFixture: LocalWorkFixture }
    ).OrivaneLocalStorageFixture;
    const db = await api.IndexedDbLocalStore.open("local-corrupt-identity");
    const sync = {
      workspaceId: "preserved",
      remoteWorkspaceId: null,
      serverOrigin: null,
      epoch: null,
      cursor: 4,
      version: 1,
    };
    await db.syncState.save(sync, null);
    const corrupt = {
      schemaVersion: 1,
      workspaceId: "corrupt",
      principalId: "must-stay",
      deviceId: "not-valid",
    };
    const raw = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("local-corrupt-identity");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = raw.transaction("identity", "readwrite");
      tx.objectStore("identity").put(corrupt, "default");
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    const errors = [];
    for (const operation of [
      () => db.identity.get(),
      () =>
        db.identity.ensure({
          schemaVersion: 1,
          workspaceId: crypto.randomUUID(),
          principalId: crypto.randomUUID(),
          deviceId: crypto.randomUUID(),
        }),
    ]) {
      try {
        await operation();
        errors.push("unexpected success");
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "unknown");
      }
    }
    const retained = await new Promise<unknown>((resolve, reject) => {
      const tx = raw.transaction("identity", "readonly"),
        request = tx.objectStore("identity").get("default");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const saved = await db.syncState.get("preserved");
    raw.close();
    db.close();
    return { errors, retained, corrupt, saved, sync };
  });
  expect(result.errors).toEqual([
    "LOCAL_IDENTITY_CORRUPT",
    "LOCAL_IDENTITY_CORRUPT",
  ]);
  expect(result.retained).toEqual(result.corrupt);
  expect(result.saved).toEqual(result.sync);
});

test("local LibraryService persists hierarchy, Wiki sources and Blob image chunks without full-body bootstrap or Base64 metadata", async ({
  page,
}, info) => {
  const bundle = await readFile(
    `.artifacts/local-storage-fixture-${info.workerIndex}/storage.js`,
    "utf8",
  );
  await page.route("http://127.0.0.1:19420/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Local Library</title>",
    }),
  );
  await page.goto("http://127.0.0.1:19420/library");
  await page.addScriptTag({ content: bundle });
  const evidence = await page.evaluate(async () => {
    const api = (
      window as unknown as { OrivaneLocalStorageFixture: LocalWorkFixture }
    ).OrivaneLocalStorageFixture;
    const db = await api.IndexedDbLocalStore.open("local-library-service"),
      blobs = await api.IndexedDbLocalBlobStore.open("local-library-service");
    const actor = { workspaceId: "library-workspace", principalId: "owner" },
      clock = { now: () => "2026-10-12T00:00:00Z" },
      ids = { next: () => crypto.randomUUID() },
      auth = { require: async () => {} };
    const uow = new api.LocalWorkUnitOfWork(
      db.metadata,
      actor,
      "device",
      clock,
      ids,
    );
    let extracts = 0;
    const indexer = {
      extract: (sourceId: string, markdown: string) => {
        extracts++;
        return api.indexDocument(sourceId, markdown, []);
      },
      resolve: (
        links: ReturnType<typeof api.indexDocument>,
        entries: Parameters<typeof api.buildAliasIndex>[0],
      ) => {
        const index = api.buildAliasIndex(entries);
        return links.map((link) => ({
          ...link,
          targetDocumentId:
            index.get(api.normalizeWikiTitle(link.targetText)) ?? null,
        }));
      },
    };
    const assets = (
      stage: LocalMutationTransaction,
      publish: ConstructorParameters<typeof api.LocalImageAssets>[5],
    ) => new api.LocalImageAssets(stage, blobs, actor, clock, ids, publish);
    const space = await uow.runWithLibrary(
      actor.workspaceId,
      indexer,
      assets,
      (_tx, _notes, store) =>
        new api.LibraryService(store, auth, clock, ids).save(actor, null, 0, {
          kind: "SPACE",
          spaceId: null,
          title: "Local knowledge",
          bodyMd: "Compact description",
        }),
    );
    const body =
      "First line\nSecond line\n[[Target|Alias]]\n" +
      "large source body\n".repeat(3500);
    const source = await uow.runWithLibrary(
      actor.workspaceId,
      indexer,
      assets,
      (_tx, _notes, store) =>
        new api.LibraryService(store, auth, clock, ids).save(actor, null, 0, {
          kind: "DOCUMENT",
          spaceId: space.id,
          title: "Source",
          bodyMd: body,
        }),
    );
    const unresolved = await uow.runWithLibrary(
      actor.workspaceId,
      indexer,
      assets,
      (_tx, _notes, store) => store.wikiLinks!(),
    );
    const target = await uow.runWithLibrary(
      actor.workspaceId,
      indexer,
      assets,
      (_tx, _notes, store) =>
        new api.LibraryService(store, auth, clock, ids).save(actor, null, 0, {
          kind: "DOCUMENT",
          spaceId: space.id,
          parentDocumentId: source.id,
          title: "Target",
          bodyMd: "Original target\nSecond line",
        }),
    );
    const resolved = await uow.runWithLibrary(
      actor.workspaceId,
      indexer,
      assets,
      (_tx, _notes, store) => store.wikiLinks!(),
    );
    const renamed = await uow.runWithLibrary(
      actor.workspaceId,
      indexer,
      assets,
      (_tx, _notes, store) =>
        new api.LibraryService(store, auth, clock, ids).save(
          actor,
          target.id,
          1,
          {
            kind: "DOCUMENT",
            spaceId: space.id,
            parentDocumentId: source.id,
            title: "Renamed",
            bodyMd: "Revised target\nSecond line",
          },
        ),
    );
    const imageId = crypto.randomUUID(),
      binary = atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1sAAAAASUVORK5CYII=",
      );
    const image = {
      id: imageId,
      spaceId: space.id,
      name: "pixel.png",
      mime: "image/png",
      base64: btoa(binary.slice(0, 20)),
    };
    await uow.runWithLibrary(
      actor.workspaceId,
      indexer,
      assets,
      (_tx, _notes, store) => store.putAssetChunk(image, 0, false),
    );
    let pendingHidden = false;
    try {
      await uow.runWithLibrary(
        actor.workspaceId,
        indexer,
        assets,
        (_tx, _notes, store) => store.asset(imageId),
      );
    } catch (error) {
      pendingHidden = error instanceof Error && error.message === "NOT_FOUND";
    }
    await uow.runWithLibrary(
      actor.workspaceId,
      indexer,
      assets,
      (_tx, _notes, store) =>
        store.putAssetChunk(
          { ...image, base64: btoa(binary.slice(20)) },
          1,
          true,
        ),
    );
    const manifest = await uow.runWithLibrary(
      actor.workspaceId,
      indexer,
      assets,
      (_tx, _notes, store) => store.listMetadata!(),
    );
    const imageMetadata = await db.metadata.get(
      actor.workspaceId,
      "libraryAssets",
      imageId,
    );
    const chunks = await uow.runWithLibrary(
      actor.workspaceId,
      indexer,
      assets,
      async (_tx, _notes, store) => [
        await store.assetChunk(imageId, 0),
        await store.assetChunk(imageId, 1),
      ],
    );
    const records = await uow.runWithLibrary(
      actor.workspaceId,
      indexer,
      assets,
      (_tx, _notes, store) => store.revisions(target.id),
    );
    const before = (await db.outbox.list(actor.workspaceId)).length;
    let cycleRejected = false;
    try {
      await uow.runWithLibrary(
        actor.workspaceId,
        indexer,
        assets,
        (_tx, _notes, store) =>
          new api.LibraryService(store, auth, clock, ids).save(
            actor,
            source.id,
            1,
            {
              kind: "DOCUMENT",
              spaceId: space.id,
              parentDocumentId: target.id,
              title: "Source",
              bodyMd: body,
            },
          ),
      );
    } catch (error) {
      cycleRejected =
        error instanceof Error && error.message === "VALIDATION_ERROR";
    }
    const atomic = before === (await db.outbox.list(actor.workspaceId)).length;
    db.close();
    blobs.close();
    return {
      space: space.id,
      source: source.id,
      target: target.id,
      imageId,
      body,
      unresolved: unresolved[0]?.targetDocumentId,
      resolved: resolved[0]?.targetDocumentId,
      aliasPreserved: renamed.aliases?.includes("Target"),
      pendingHidden,
      imageExact: chunks.map((value) => atob(value)).join("") === binary,
      noBase64:
        !!imageMetadata &&
        !Object.hasOwn(imageMetadata.value as object, "base64"),
      unloaded: manifest.every((value) => !Object.hasOwn(value, "bodyMd")),
      manifestBytes: JSON.stringify(manifest).length,
      revisions: records.map((value) => value.version),
      cycleRejected,
      atomic,
      extracts,
    };
  });
  expect(evidence).toMatchObject({
    unresolved: null,
    resolved: evidence.target,
    aliasPreserved: true,
    pendingHidden: true,
    imageExact: true,
    noBase64: true,
    unloaded: true,
    revisions: [2, 1],
    cycleRejected: true,
    atomic: true,
    extracts: 3,
  });
  expect(evidence.manifestBytes).toBeLessThan(3000);
  await page.reload();
  await page.addScriptTag({ content: bundle });
  const restored = await page.evaluate(
    async ({ source, target, imageId, body }) => {
      const api = (
        window as unknown as { OrivaneLocalStorageFixture: LocalWorkFixture }
      ).OrivaneLocalStorageFixture;
      const db = await api.IndexedDbLocalStore.open("local-library-service"),
        blobs = await api.IndexedDbLocalBlobStore.open("local-library-service");
      const actor = { workspaceId: "library-workspace", principalId: "owner" },
        clock = { now: () => "2026-10-12T00:00:00Z" },
        ids = { next: () => crypto.randomUUID() };
      const uow = new api.LocalWorkUnitOfWork(
        db.metadata,
        actor,
        "device",
        clock,
        ids,
      );
      const indexer = {
        extract: () => {
          throw new Error("CLEAN_START_MUST_NOT_PARSE_BODY");
        },
        resolve: (
          links: ReturnType<typeof api.indexDocument>,
          entries: Parameters<typeof api.buildAliasIndex>[0],
        ) => {
          const index = api.buildAliasIndex(entries);
          return links.map((link) => ({
            ...link,
            targetDocumentId:
              index.get(api.normalizeWikiTitle(link.targetText)) ?? null,
          }));
        },
      };
      const assets = (
        stage: LocalMutationTransaction,
        publish: ConstructorParameters<typeof api.LocalImageAssets>[5],
      ) => new api.LocalImageAssets(stage, blobs, actor, clock, ids, publish);
      const result = await uow.runWithLibrary(
        actor.workspaceId,
        indexer,
        assets,
        async (_tx, _notes, store) => ({
          clean: await store.ensureWikiIndex!(),
          links: await store.wikiLinks!(),
          source: await store.get(source),
          target: await store.get(target),
          image: await store.asset(imageId),
        }),
      );
      db.close();
      blobs.close();
      return {
        clean: result.clean,
        link: result.links[0]?.targetDocumentId,
        bodyExact: result.source.bodyMd === body,
        parent: result.target.parentDocumentId,
        imageChunks: result.image.chunkCount,
      };
    },
    evidence,
  );
  expect(restored).toEqual({
    clean: false,
    link: evidence.target,
    bodyExact: true,
    parent: evidence.source,
    imageChunks: 2,
  });
  const repaired = await page.evaluate(async ({ source, target, body }) => {
    const api = (
      window as unknown as { OrivaneLocalStorageFixture: LocalWorkFixture }
    ).OrivaneLocalStorageFixture;
    const db = await api.IndexedDbLocalStore.open("local-library-service"),
      blobs = await api.IndexedDbLocalBlobStore.open("local-library-service");
    const actor = { workspaceId: "library-workspace", principalId: "owner" },
      clock = { now: () => "2026-10-12T00:00:00Z" },
      ids = { next: () => crypto.randomUUID() };
    const original = await db.metadata.get(
      actor.workspaceId,
      "$local.wikiSources",
      source,
    );
    if (!original) throw new Error("MISSING_ORIGINAL_INDEX");
    const raw = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("local-library-service");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const corruption = raw.transaction("entities", "readwrite");
    const done = new Promise<void>((resolve, reject) => {
      corruption.oncomplete = () => resolve();
      corruption.onabort = () => reject(corruption.error);
    });
    corruption.objectStore("entities").put({
      ...original,
      value: {
        parserVersion: 0,
        sourceVersion: 999,
        links: ["corrupt derived syntax"],
      },
    });
    corruption
      .objectStore("entities")
      .delete([actor.workspaceId, "$local.wikiSources", target]);
    await done;
    raw.close();
    const before = (await db.outbox.list(actor.workspaceId)).length;
    let parses = 0;
    const indexer = {
      extract: (id: string, markdown: string) => {
        parses++;
        return api.indexDocument(id, markdown, []);
      },
      resolve: (
        links: ReturnType<typeof api.indexDocument>,
        entries: Parameters<typeof api.buildAliasIndex>[0],
      ) => {
        const aliases = api.buildAliasIndex(entries);
        return links.map((link) => ({
          ...link,
          targetDocumentId:
            aliases.get(api.normalizeWikiTitle(link.targetText)) ?? null,
        }));
      },
    };
    const assets = (
      stage: LocalMutationTransaction,
      publish: ConstructorParameters<typeof api.LocalImageAssets>[5],
    ) => new api.LocalImageAssets(stage, blobs, actor, clock, ids, publish);
    const uow = new api.LocalWorkUnitOfWork(
      db.metadata,
      actor,
      "device",
      clock,
      ids,
    );
    const result = await uow.runWithLibrary(
      actor.workspaceId,
      indexer,
      assets,
      async (_tx, _notes, store) => ({
        repaired: await store.ensureWikiIndex!(),
        links: await store.wikiLinks!(),
        source: await store.get(source),
        target: await store.get(target),
      }),
    );
    const after = (await db.outbox.list(actor.workspaceId)).length;
    const clean = await uow.runWithLibrary(
      actor.workspaceId,
      indexer,
      assets,
      (_tx, _notes, store) => store.ensureWikiIndex!(),
    );
    const guard = await db.metadata.get(
      actor.workspaceId,
      "$local.workspace",
      "revision",
    );
    if (!guard) throw new Error("MISSING_REPAIR_GUARD");
    let forbidden = false;
    try {
      await db.metadata.repairWikiIndex!(actor.workspaceId, actor.principalId, [
        {
          entity: { ...guard, version: guard.version + 1 },
          expectedVersion: guard.version,
        },
        {
          entity: {
            workspaceId: actor.workspaceId,
            collection: "$local.noteBody",
            id: "bypass",
            version: 1,
            value: { bodyMd: "Do not allow" },
          },
          expectedVersion: null,
        },
      ]);
    } catch (error) {
      forbidden = error instanceof Error && error.message === "INVALID_WRITE";
    }
    const sourceIndex = await db.metadata.get(
      actor.workspaceId,
      "$local.wikiSources",
      source,
    );
    if (!sourceIndex) throw new Error("MISSING_REPAIRED_INDEX");
    const repairRecords = [
      {
        entity: {
          ...guard,
          version: guard.version + 1,
          value: { revision: guard.version + 1 },
        },
        expectedVersion: guard.version,
      },
      {
        entity: { ...sourceIndex, version: sourceIndex.version + 1 },
        expectedVersion: sourceIndex.version,
      },
    ];
    const concurrent = await Promise.allSettled([
      db.metadata.repairWikiIndex!(
        actor.workspaceId,
        actor.principalId,
        repairRecords,
      ),
      db.metadata.repairWikiIndex!(
        actor.workspaceId,
        actor.principalId,
        repairRecords,
      ),
    ]);
    const repairCas =
      concurrent.filter((value) => value.status === "fulfilled").length === 1 &&
      concurrent.some(
        (value) =>
          value.status === "rejected" &&
          value.reason instanceof Error &&
          value.reason.message === "VERSION_CONFLICT",
      );
    const finalOutboxUnchanged =
      (await db.outbox.list(actor.workspaceId)).length === before;
    db.close();
    blobs.close();
    return {
      repaired: result.repaired,
      clean,
      parses,
      outboxUnchanged: before === after,
      sourceVersion: result.source.version,
      targetVersion: result.target.version,
      originalBody: result.source.bodyMd === body,
      resolved: result.links[0]?.targetDocumentId,
      forbidden,
      repairCas,
      finalOutboxUnchanged,
    };
  }, evidence);
  expect(repaired).toEqual({
    repaired: true,
    clean: false,
    parses: 2,
    outboxUnchanged: true,
    sourceVersion: 1,
    targetVersion: 2,
    originalBody: true,
    resolved: evidence.target,
    forbidden: true,
    repairCas: true,
    finalOutboxUnchanged: true,
  });
});

test("local NotebookService preserves Markdown, unloaded manifests, revisions and cross-service rollback after reload", async ({
  page,
}, info) => {
  const bundle = await readFile(
    `.artifacts/local-storage-fixture-${info.workerIndex}/storage.js`,
    "utf8",
  );
  await page.route("http://127.0.0.1:19420/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Local Notebook</title>",
    }),
  );
  await page.goto("http://127.0.0.1:19420/notes");
  await page.addScriptTag({ content: bundle });
  const evidence = await page.evaluate(async () => {
    const api = (
      window as unknown as { OrivaneLocalStorageFixture: LocalWorkFixture }
    ).OrivaneLocalStorageFixture;
    const db = await api.IndexedDbLocalStore.open("local-notebook-service");
    const actor = { workspaceId: "notebook-workspace", principalId: "owner" };
    const clock = { now: () => "2026-10-12T00:00:00Z" },
      ids = { next: () => crypto.randomUUID() };
    const auth = { require: async () => {} };
    const uow = new api.LocalWorkUnitOfWork(
      db.metadata,
      actor,
      "device",
      clock,
      ids,
    );
    const body =
      "# 原文\n第二行\n\n[[Wiki]]\n" + "large preserved body\n".repeat(3000);
    const note = await uow.runWithNotebook(
      actor.workspaceId,
      async (tx, store) => {
        const scoped = {
          run: async <T>(
            workspaceId: string,
            operation: (value: typeof tx) => T | Promise<T>,
          ) => {
            if (workspaceId !== actor.workspaceId) throw new Error("FORBIDDEN");
            return operation(tx);
          },
        };
        await new api.WorkService(scoped, auth, clock, ids).create(actor, {
          title: "Same transaction task",
        });
        return new api.NotebookService(store, auth, clock, ids).save(
          actor,
          null,
          0,
          { title: "Local note", bodyMd: body, kind: "NOTE", day: null },
        );
      },
    );
    const updated = await uow.runWithNotebook(actor.workspaceId, (_tx, store) =>
      new api.NotebookService(store, auth, clock, ids).save(actor, note.id, 1, {
        title: "Local note",
        bodyMd: body + "final\n",
        kind: "NOTE",
        day: null,
      }),
    );
    const journal = await uow.runWithNotebook(actor.workspaceId, (_tx, store) =>
      new api.NotebookService(store, auth, clock, ids).save(actor, null, 0, {
        title: "2026-10-12",
        bodyMd: "Journal\n第二行",
        kind: "JOURNAL",
        day: "2026-10-12",
      }),
    );
    const manifest = await uow.runWithNotebook(
      actor.workspaceId,
      (_tx, store) =>
        new api.NotebookService(store, auth, clock, ids).manifest(actor),
    );
    const revisions = await uow.runWithNotebook(
      actor.workspaceId,
      (_tx, store) => store.revisions(note.id),
    );
    const before = (await db.outbox.list(actor.workspaceId)).length;
    let rollback = false;
    try {
      await uow.runWithNotebook(actor.workspaceId, async (tx, store) => {
        const current = await store.get(note.id);
        await store.save({ ...current, title: "Aborted note", version: 3 }, 2);
        const item = (await tx.list())[0]!;
        await tx.replace({ ...item, title: "Aborted task", version: 2 }, 1);
        throw new Error("EXPECTED_ABORT");
      });
    } catch (error) {
      rollback = error instanceof Error && error.message === "EXPECTED_ABORT";
    }
    const mutations = await db.outbox.list(actor.workspaceId);
    const after = mutations.length;
    const originalBase = mutations.find(
      (mutation) => mutation.entityId === note.id && mutation.baseVersion === 1,
    )?.basePayload;
    const search = await uow.runWithNotebook(actor.workspaceId, (_tx, store) =>
      store.searchIds!("Wiki"),
    );
    const changeCount = await uow.run(
      actor.workspaceId,
      async (tx) => (await tx.workspaceChanges(0)).changes.length,
    );
    db.close();
    return {
      noteId: note.id,
      journalId: journal.id,
      body: updated.bodyMd,
      originalBase,
      originalNote: note,
      rollback,
      noPartial: before === after,
      count: after,
      changeCount,
      unloaded: manifest.every(
        (value) =>
          value.bodyState === "UNLOADED" && !Object.hasOwn(value, "bodyMd"),
      ),
      manifestBytes: JSON.stringify(manifest).length,
      bodyBytes: body.length,
      revisionVersions: revisions.map((value) => value.version),
      firstBody: revisions[1]?.bodyMd,
      search,
    };
  });
  expect(evidence.rollback).toBe(true);
  expect(evidence.originalBase as unknown).toEqual(evidence.originalNote);
  expect(evidence.noPartial).toBe(true);
  expect(evidence.unloaded).toBe(true);
  expect(evidence.count).toBe(4);
  expect(evidence.changeCount).toBe(4);
  expect(evidence.manifestBytes).toBeLessThan(2500);
  expect(evidence.bodyBytes).toBeGreaterThan(50000);
  expect(evidence.revisionVersions).toEqual([2, 1]);
  expect(evidence.body).toBe(evidence.firstBody + "final\n");
  expect(evidence.search).toEqual([evidence.noteId]);
  await page.reload();
  await page.addScriptTag({ content: bundle });
  const restored = await page.evaluate(
    async ({ noteId, journalId }) => {
      const api = (
        window as unknown as { OrivaneLocalStorageFixture: LocalWorkFixture }
      ).OrivaneLocalStorageFixture;
      const db = await api.IndexedDbLocalStore.open("local-notebook-service");
      const actor = { workspaceId: "notebook-workspace", principalId: "owner" };
      const uow = new api.LocalWorkUnitOfWork(
        db.metadata,
        actor,
        "device",
        { now: () => "2026-10-12T00:00:00Z" },
        { next: () => crypto.randomUUID() },
      );
      const value = await uow.runWithNotebook(
        actor.workspaceId,
        async (tx, store) => ({
          note: await store.get(noteId),
          journal: await store.get(journalId),
          task: (await tx.list())[0],
          revisions: await store.revisions(noteId),
        }),
      );
      db.close();
      return {
        body: value.note.bodyMd,
        title: value.note.title,
        version: value.note.version,
        task: value.task?.title,
        journalKind: value.journal.kind,
        journalDay: value.journal.day,
        journalBody: value.journal.bodyMd,
        revisions: value.revisions.length,
      };
    },
    { noteId: evidence.noteId, journalId: evidence.journalId },
  );
  expect(restored).toEqual({
    body: evidence.body,
    title: "Local note",
    version: 2,
    task: "Same transaction task",
    journalKind: "JOURNAL",
    journalDay: "2026-10-12",
    journalBody: "Journal\n第二行",
    revisions: 2,
  });
});

test("local WorkService persists projects, task membership, dependency, reminder and Activity with durable mutation envelopes", async ({
  page,
}, info) => {
  const bundle = await readFile(
    `.artifacts/local-storage-fixture-${info.workerIndex}/storage.js`,
    "utf8",
  );
  await page.route("http://127.0.0.1:19420/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Local Work Application</title>",
    }),
  );
  await page.goto("http://127.0.0.1:19420/work");
  await page.addScriptTag({ content: bundle });
  const created = await page.evaluate(async () => {
    const api = (
      window as unknown as { OrivaneLocalStorageFixture: LocalWorkFixture }
    ).OrivaneLocalStorageFixture;
    const db = await api.IndexedDbLocalStore.open("local-work-service");
    const actor = { workspaceId: "local-work", principalId: "owner" };
    const clock = { now: () => "2026-10-12T00:00:00Z" };
    const ids = { next: () => crypto.randomUUID() };
    const auth = {
      require: async (context: typeof actor) => {
        if (
          context.workspaceId !== actor.workspaceId ||
          context.principalId !== actor.principalId
        )
          throw new Error("FORBIDDEN");
      },
    };
    const uow = new api.LocalWorkUnitOfWork(
      db.metadata,
      actor,
      "device",
      clock,
      ids,
    );
    const work = new api.WorkService(uow, auth, clock, ids);
    const reminders = new api.ReminderService(uow, auth, clock, ids);
    const project = await work.createWithStableId(
      actor,
      "11111111-1111-4111-8111-111111111111",
      {
        title: "Local project",
        type: "PROJECT",
      },
    );
    const blocker = await work.create(actor, {
      title: "Blocker",
      projectIds: [project.id],
      descriptionMd: "原始正文\n第二行",
    });
    const dependent = await work.create(actor, {
      title: "Dependent",
      projectIds: [project.id],
      prerequisiteIds: [blocker.id],
    });
    const reminder = await reminders.save(actor, null, 0, {
      title: "Local reminder",
      bodyMd: "Reminder Markdown",
      day: "2026-10-12",
      time: "09:00",
      timezone: "Asia/Shanghai",
      notifyMode: "MINUTES_BEFORE",
      notifyOffsetMinutes: 15,
      linkedProjectId: project.id,
      linkedTaskId: dependent.id,
      state: "ACTIVE",
    });
    await work.update(actor, blocker.id, 1, { title: "Blocker updated" });
    const before = await db.outbox.list(actor.workspaceId);
    let staleRejected = false;
    try {
      await work.update(actor, blocker.id, 1, { title: "Must not overwrite" });
    } catch (error) {
      staleRejected =
        error instanceof Error && error.message === "VERSION_CONFLICT";
    }
    const after = await db.outbox.list(actor.workspaceId);
    const activity = await db.metadata.list(
      actor.workspaceId,
      "$local.activity",
    );
    const journal = await uow.run(actor.workspaceId, (tx) =>
      tx.workspaceChanges(0),
    );
    db.close();
    return {
      project: project.id,
      blocker: blocker.id,
      dependent: dependent.id,
      reminder: reminder.id,
      staleRejected,
      atomic: before.length === after.length,
      mutationCount: after.length,
      activityCount: activity.length,
      changeCount: journal.changes.length,
      uniqueIds: new Set(after.map((value) => value.id)).size === after.length,
      pending: after.every(
        (value) =>
          value.state === "PENDING" &&
          value.deviceId === "device" &&
          value.principalId === "owner",
      ),
    };
  });
  expect(created.staleRejected).toBe(true);
  expect(created.project).toBe("11111111-1111-4111-8111-111111111111");
  expect(created.atomic).toBe(true);
  expect(created.uniqueIds).toBe(true);
  expect(created.pending).toBe(true);
  expect(created.mutationCount).toBe(6);
  expect(created.changeCount).toBe(6);
  expect(created.activityCount).toBe(5);
  await page.reload();
  await page.addScriptTag({ content: bundle });
  const restored = await page.evaluate(
    async ({ project, blocker, dependent, reminder }) => {
      const api = (
        window as unknown as { OrivaneLocalStorageFixture: LocalWorkFixture }
      ).OrivaneLocalStorageFixture;
      const db = await api.IndexedDbLocalStore.open("local-work-service");
      const actor = { workspaceId: "local-work", principalId: "owner" };
      const uow = new api.LocalWorkUnitOfWork(
        db.metadata,
        actor,
        "device",
        { now: () => "2026-10-12T00:00:00Z" },
        { next: () => crypto.randomUUID() },
      );
      const result = await uow.run(actor.workspaceId, async (tx) => ({
        items: await tx.list(),
        edges: await tx.edges(),
        reminders: await tx.reminders(),
        changes: await tx.workspaceChanges(0),
        preference: await tx.navigationPreference("owner"),
        settings: await tx.calendarSettings(),
      }));
      let scopeRejected = false;
      try {
        await uow.run("foreign", (tx) => tx.list());
      } catch (error) {
        scopeRejected = error instanceof Error && error.message === "FORBIDDEN";
      }
      const outbox = await db.outbox.list(actor.workspaceId);
      db.close();
      return {
        scopeRejected,
        count: result.items.length,
        title: result.items.find((value) => value.id === blocker)?.title,
        body: result.items.find((value) => value.id === blocker)?.descriptionMd,
        membership: result.items.find((value) => value.id === dependent)
          ?.projectIds,
        edge: result.edges.some(
          (value) => value.fromId === blocker && value.toId === dependent,
        ),
        reminder: result.reminders.find((value) => value.id === reminder)
          ?.notifyOffsetMinutes,
        project: result.items.some(
          (value) => value.id === project && value.type === "PROJECT",
        ),
        outbox: outbox.length,
        changeCount: result.changes.changes.length,
        settings: result.settings,
        preferenceVersion: result.preference.version,
      };
    },
    created,
  );
  expect(restored).toMatchObject({
    scopeRejected: true,
    count: 3,
    title: "Blocker updated",
    body: "原始正文\n第二行",
    membership: [created.project],
    edge: true,
    reminder: 15,
    project: true,
    outbox: 6,
    changeCount: 6,
    settings: { version: 0, timezone: null },
    preferenceVersion: 0,
  });
});

test("local Application transaction rejects concurrent structural writes and rolls back entities, events and outbox together", async ({
  page,
}, info) => {
  const bundle = await readFile(
    `.artifacts/local-storage-fixture-${info.workerIndex}/storage.js`,
    "utf8",
  );
  await page.route("http://127.0.0.1:19420/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Local Work Atomicity</title>",
    }),
  );
  await page.goto("http://127.0.0.1:19420/atomic");
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async () => {
    const api = (
      window as unknown as { OrivaneLocalStorageFixture: LocalWorkFixture }
    ).OrivaneLocalStorageFixture;
    const db = await api.IndexedDbLocalStore.open("local-work-atomic");
    const actor = { workspaceId: "local-atomic", principalId: "owner" };
    const clock = { now: () => "2026-10-12T00:00:00Z" };
    const ids = { next: () => crypto.randomUUID() };
    const uow = new api.LocalWorkUnitOfWork(
      db.metadata,
      actor,
      "device",
      clock,
      ids,
    );
    const service = new api.WorkService(
      uow,
      { require: async () => {} },
      clock,
      ids,
    );
    const item = await service.create(actor, { title: "Original" });
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stale = uow
      .run(actor.workspaceId, async (tx) => {
        const old = await tx.get(item.id);
        entered();
        await gate;
        await tx.replace(
          { ...old, title: "Stale writer", version: old.version + 1 },
          old.version,
        );
      })
      .then(
        () => false,
        (error) =>
          error instanceof Error && error.message === "VERSION_CONFLICT",
      );
    await ready;
    await service.update(actor, item.id, 1, { title: "Winner" });
    release();
    const staleRejected = await stale;
    const count = (await db.outbox.list(actor.workspaceId)).length;
    let rollback = false;
    try {
      await uow.run(actor.workspaceId, async (tx) => {
        const current = await tx.get(item.id);
        await tx.replace(
          { ...current, title: "Aborted", version: current.version + 1 },
          current.version,
        );
        await tx.appendActivity({
          id: "aborted-event",
          workspaceId: actor.workspaceId,
          principalId: actor.principalId,
          entityId: item.id,
          type: "WORK_ITEM_UPDATED",
          occurredAt: clock.now(),
        });
        throw new Error("EXPECTED_ABORT");
      });
    } catch (error) {
      rollback = error instanceof Error && error.message === "EXPECTED_ABORT";
    }
    const saved = await uow.run(actor.workspaceId, (tx) => tx.get(item.id));
    const noEvent =
      (await db.metadata.get(
        actor.workspaceId,
        "$local.activity",
        "aborted-event",
      )) === null;
    const noMutation =
      count === (await db.outbox.list(actor.workspaceId)).length;
    db.close();
    return {
      staleRejected,
      rollback,
      noEvent,
      noMutation,
      title: saved.title,
      version: saved.version,
      count,
    };
  });
  expect(result).toEqual({
    staleRejected: true,
    rollback: true,
    noEvent: true,
    noMutation: true,
    title: "Winner",
    version: 2,
    count: 2,
  });
});

test("local candidate releases version-change locks and refuses to downgrade a newer schema", async ({
  page,
}, info) => {
  const bundle = await readFile(
    `.artifacts/local-storage-fixture-${info.workerIndex}/storage.js`,
    "utf8",
  );
  await page.route("http://127.0.0.1:19420/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Schema safety</title>",
    }),
  );
  await page.goto("http://127.0.0.1:19420/fixture");
  await page.addScriptTag({ content: bundle });
  const evidence = await page.evaluate(async () => {
    const api = (
      window as unknown as {
        OrivaneLocalStorageFixture: {
          IndexedDbLocalStore: typeof IndexedDbLocalStore;
        };
      }
    ).OrivaneLocalStorageFixture;
    const db = await api.IndexedDbLocalStore.open("local-upgrade-spike");
    const state = {
      workspaceId: "local-a",
      remoteWorkspaceId: null,
      serverOrigin: null,
      epoch: null,
      cursor: 17,
      version: 1,
    };
    await db.syncState.save(state, null);
    // A future schema fixture must not require deleting persisted user records.
    const currentVersion = await new Promise<number>((resolve, reject) => {
      const request = indexedDB.open("local-upgrade-spike");
      request.onsuccess = () => {
        const version = request.result.version;
        request.result.close();
        resolve(version);
      };
      request.onerror = () => reject(request.error);
    });
    const upgraded = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("local-upgrade-spike", currentVersion + 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("future-schema");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const preserved = await new Promise<unknown>((resolve, reject) => {
      const tx = upgraded.transaction("sync", "readonly");
      const request = tx.objectStore("sync").get("local-a");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    upgraded.close();
    let failure = "unexpected success";
    try {
      const obsolete = await api.IndexedDbLocalStore.open(
        "local-upgrade-spike",
      );
      obsolete.close();
    } catch (error) {
      failure = error instanceof Error ? error.name : "unknown error";
    }
    return { preserved, state, failure };
  });
  expect(evidence.preserved).toEqual(evidence.state);
  expect(evidence.failure).toBe("VersionError");
});

test("local sync cursor uses CAS and interrupted outbox attempts recover without losing identity", async ({
  page,
}, info) => {
  const bundle = await readFile(
    `.artifacts/local-storage-fixture-${info.workerIndex}/storage.js`,
    "utf8",
  );
  await page.route("http://127.0.0.1:19420/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Local recovery</title>",
    }),
  );
  await page.goto("http://127.0.0.1:19420/fixture");
  await page.addScriptTag({ content: bundle });
  const evidence = await page.evaluate(async () => {
    const api = (
      window as unknown as {
        OrivaneLocalStorageFixture: {
          IndexedDbLocalStore: typeof IndexedDbLocalStore;
        };
      }
    ).OrivaneLocalStorageFixture;
    const db = await api.IndexedDbLocalStore.open("local-recovery-spike");
    const initial = {
      workspaceId: "local-a",
      remoteWorkspaceId: null,
      serverOrigin: null,
      epoch: null,
      cursor: 0,
      version: 1,
    };
    await db.syncState.save(initial, null);
    const updates = await Promise.allSettled([
      db.syncState.save({ ...initial, cursor: 10, version: 2 }, 1),
      db.syncState.save({ ...initial, cursor: 20, version: 2 }, 1),
    ]);
    // Synthetic interrupted dispatch fixture; Application dispatch is Phase10.
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("local-recovery-spike");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const fixture = request.result;
        const tx = fixture.transaction("outbox", "readwrite", {
          durability: "strict",
        });
        tx.oncomplete = () => {
          fixture.close();
          resolve();
        };
        tx.onabort = () => {
          const error = tx.error;
          fixture.close();
          reject(error);
        };
        for (const workspaceId of ["local-a", "local-b"])
          tx.objectStore("outbox").add({
            workspaceId,
            id: "interrupted",
            deviceId: "device",
            principalId: "owner",
            operation: "PATCH",
            entityType: "tasks",
            entityId: "task",
            baseVersion: 1,
            payload: { title: "pending change" },
            createdAt: "2026-10-12T00:00:00Z",
            attemptCount: 2,
            lastAttemptAt: "2026-10-12T00:01:00Z",
            state: "SENDING",
          });
      };
    });
    const recovered = await db.outbox.recoverSending("local-a");
    const again = await db.outbox.recoverSending("local-a");
    const cursor = await db.syncState.get("local-a");
    const foreignCursor = await db.syncState.get("local-b");
    const pending = await db.outbox.list("local-a");
    const foreign = await db.outbox.list("local-b");
    db.close();
    return {
      successes: updates.filter((update) => update.status === "fulfilled")
        .length,
      failures: updates
        .filter((update) => update.status === "rejected")
        .map((update) =>
          update.reason instanceof Error ? update.reason.message : "unknown",
        ),
      recovered,
      again,
      cursor,
      foreignCursor,
      pending,
      foreign,
    };
  });
  expect(evidence.successes).toBe(1);
  expect(evidence.failures).toEqual(["VERSION_CONFLICT"]);
  expect(evidence.cursor?.version).toBe(2);
  expect([10, 20]).toContain(evidence.cursor?.cursor);
  expect(evidence.foreignCursor).toBeNull();
  expect(evidence.recovered).toBe(1);
  expect(evidence.again).toBe(0);
  expect(evidence.pending).toHaveLength(1);
  expect(evidence.pending[0]).toMatchObject({
    id: "interrupted",
    state: "PENDING",
    attemptCount: 2,
    lastAttemptAt: "2026-10-12T00:01:00Z",
  });
  expect(evidence.foreign[0]?.state).toBe("SENDING");
});

test("local storage candidate indexes 1500 tasks, 500 documents and 1000 file metadata with 50 pending writes", async ({
  page,
}, info) => {
  const bundle = await readFile(
    `.artifacts/local-storage-fixture-${info.workerIndex}/storage.js`,
    "utf8",
  );
  await page.route("http://127.0.0.1:19420/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Local storage benchmark</title>",
    }),
  );
  await page.goto("http://127.0.0.1:19420/fixture");
  await page.addScriptTag({ content: bundle });
  const evidence = await page.evaluate(async () => {
    const api = (
      window as unknown as {
        OrivaneLocalStorageFixture: {
          IndexedDbLocalStore: typeof IndexedDbLocalStore;
        };
      }
    ).OrivaneLocalStorageFixture;
    const local = await api.IndexedDbLocalStore.open("local-large-spike");
    // Test fixture import, not an Application mutation or production bypass.
    const started = performance.now();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("local-large-spike");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("entities", "readwrite", {
          durability: "strict",
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onabort = () => {
          const error = tx.error;
          db.close();
          reject(error);
        };
        const store = tx.objectStore("entities");
        for (const [collection, count] of [
          ["tasks", 1500],
          ["documents", 500],
          ["files", 1000],
        ] as const)
          for (let index = 0; index < count; index++)
            store.add({
              workspaceId: "large-local",
              collection,
              id: collection + "-" + index,
              version: 1,
              value: {
                title: collection + " " + index,
                ...(collection === "documents"
                  ? { bodyMd: "original Markdown\n".repeat(60) }
                  : {}),
              },
            });
      };
    });
    const importMs = performance.now() - started;
    const writeStart = performance.now();
    await local.metadata.commit(
      "large-local",
      "owner",
      Array.from(
        { length: 50 },
        (_, index): LocalWrite => ({
          entity: {
            workspaceId: "large-local",
            collection: "tasks",
            id: "tasks-" + index,
            version: 2,
            value: { title: "changed " + index },
          },
          expectedVersion: 1,
          mutation: {
            id: "pending-" + index,
            deviceId: "device",
            workspaceId: "large-local",
            principalId: "owner",
            operation: "PATCH",
            entityType: "tasks",
            entityId: "tasks-" + index,
            baseVersion: 1,
            payload: { title: "changed " + index },
            createdAt: "2026-10-12T00:00:00Z",
            attemptCount: 0,
            lastAttemptAt: null,
            state: "PENDING",
          },
        }),
      ),
    );
    const writeMs = performance.now() - writeStart;
    const readStart = performance.now();
    const [tasks, documents, files, outbox] = await Promise.all([
      local.metadata.list("large-local", "tasks"),
      local.metadata.list("large-local", "documents"),
      local.metadata.list("large-local", "files"),
      local.outbox.list("large-local"),
    ]);
    const readMs = performance.now() - readStart;
    local.close();
    return {
      importMs,
      writeMs,
      readMs,
      tasks: tasks.length,
      documents: documents.length,
      files: files.length,
      pending: outbox.filter((item) => item.state === "PENDING").length,
      changed: tasks.filter((task) => task.version === 2).length,
    };
  });
  expect(evidence.tasks).toBe(1500);
  expect(evidence.documents).toBe(500);
  expect(evidence.files).toBe(1000);
  expect(evidence.pending).toBe(50);
  expect(evidence.changed).toBe(50);
  await info.attach("local-large-benchmark", {
    body: JSON.stringify(evidence),
    contentType: "application/json",
  });
  await writeFile(
    info.outputPath("local-storage-large.json"),
    JSON.stringify(evidence, null, 2),
  );
});

test("local durable entity and outbox recover after browser process crash", async ({}, info) => {
  const profile = await mkdtemp(join(tmpdir(), "orivane-local-crash-"));
  const bundle = await readFile(
    `.artifacts/local-storage-fixture-${info.workerIndex}/storage.js`,
    "utf8",
  );
  const prepare = async () => {
    const context = await chromium.launchPersistentContext(profile, {
      headless: true,
    });
    await context.route("http://127.0.0.1:19420/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Crash recovery</title>",
      }),
    );
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:19420/fixture");
    await page.addScriptTag({ content: bundle });
    return { context, page };
  };
  const first = await prepare();
  try {
    await first.page.evaluate(async () => {
      const api = (
        window as unknown as {
          OrivaneLocalStorageFixture: {
            IndexedDbLocalStore: typeof IndexedDbLocalStore;
          };
        }
      ).OrivaneLocalStorageFixture;
      const db = await api.IndexedDbLocalStore.open("local-crash-spike");
      await db.metadata.commit("local-a", "owner", [
        {
          entity: {
            workspaceId: "local-a",
            collection: "tasks",
            id: "durable",
            version: 1,
            value: { title: "must survive process death" },
          },
          expectedVersion: null,
          mutation: {
            id: "durable-mutation",
            deviceId: "device",
            workspaceId: "local-a",
            principalId: "owner",
            operation: "CREATE",
            entityType: "tasks",
            entityId: "durable",
            baseVersion: null,
            payload: { title: "must survive process death" },
            createdAt: "2026-10-12T00:00:00Z",
            attemptCount: 0,
            lastAttemptAt: null,
            state: "PENDING",
          },
        },
      ]);
      // Leave the database open: this is process death, not graceful DB close.
    });
    const closed = new Promise<void>((resolve) =>
      first.context.once("close", () => resolve()),
    );
    const browser = first.context.browser();
    if (!browser) throw new Error("Test browser process unavailable");
    const cdp = await browser.newBrowserCDPSession();
    const processes = await cdp.send("SystemInfo.getProcessInfo");
    const browserPid = processes.processInfo.find(
      (entry) => entry.type === "browser",
    )?.id;
    if (
      !browserPid ||
      !Number.isSafeInteger(browserPid) ||
      browserPid === process.pid
    )
      throw new Error("Invalid isolated browser process identity");
    // Kill only the process returned by this freshly launched test browser.
    process.kill(browserPid, "SIGKILL");
    await closed;
  } finally {
    await first.context.close();
  }
  const restarted = await prepare();
  try {
    const recovered = await restarted.page.evaluate(async () => {
      const api = (
        window as unknown as {
          OrivaneLocalStorageFixture: {
            IndexedDbLocalStore: typeof IndexedDbLocalStore;
          };
        }
      ).OrivaneLocalStorageFixture;
      const db = await api.IndexedDbLocalStore.open("local-crash-spike");
      const entity = await db.metadata.get("local-a", "tasks", "durable");
      const mutations = await db.outbox.list("local-a");
      db.close();
      return { entity, mutations };
    });
    expect(recovered.entity?.version).toBe(1);
    expect(recovered.entity?.value).toEqual({
      title: "must survive process death",
    });
    expect(recovered.mutations.map((mutation) => mutation.id)).toEqual([
      "durable-mutation",
    ]);
  } finally {
    await restarted.context.close();
  }
});

test("local binary store preserves original bytes, verifies hashes and isolates workspaces after reload", async ({
  page,
}, info) => {
  const bundle = await readFile(
    `.artifacts/local-storage-fixture-${info.workerIndex}/storage.js`,
    "utf8",
  );
  await page.route("http://127.0.0.1:19420/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Binary storage</title>",
    }),
  );
  await page.goto("http://127.0.0.1:19420/fixture");
  await page.addScriptTag({ content: bundle });
  const stored = await page.evaluate(async () => {
    const api = (
      window as unknown as {
        OrivaneLocalStorageFixture: {
          IndexedDbLocalBlobStore: typeof IndexedDbLocalBlobStore;
          IndexedDbLocalStore: typeof IndexedDbLocalStore;
        };
      }
    ).OrivaneLocalStorageFixture;
    // The same workspace database stem must not collide with metadata schema.
    const metadata = await api.IndexedDbLocalStore.open("local-binary-spike");
    const db = await api.IndexedDbLocalBlobStore.open("local-binary-spike");
    const original = new Uint8Array([0, 255, 128, 13, 10, 1]);
    const hash = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", original)),
    ]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    await db.put(
      "local-a",
      hash,
      new Blob([original], { type: "application/octet-stream" }),
    );
    let rejected = false;
    try {
      await db.put("local-a", hash, new Blob(["corrupt replacement"]));
    } catch (error) {
      rejected = error instanceof Error && error.message === "HASH_MISMATCH";
    }
    const foreign = await db.get("local-b", hash);
    const metadataRows = await metadata.metadata.list("local-a", "documents");
    metadata.close();
    db.close();
    return { hash, rejected, foreign, metadataRows };
  });
  expect(stored.rejected).toBe(true);
  expect(stored.foreign).toBeNull();
  expect(stored.metadataRows).toEqual([]);
  await page.reload();
  await page.addScriptTag({ content: bundle });
  const restored = await page.evaluate(async (hash) => {
    const api = (
      window as unknown as {
        OrivaneLocalStorageFixture: {
          IndexedDbLocalBlobStore: typeof IndexedDbLocalBlobStore;
        };
      }
    ).OrivaneLocalStorageFixture;
    const db = await api.IndexedDbLocalBlobStore.open("local-binary-spike");
    const blob = await db.get("local-a", hash);
    const bytes = blob ? [...new Uint8Array(await blob.arrayBuffer())] : null;
    const type = blob?.type;
    db.close();
    return { bytes, type };
  }, stored.hash);
  expect(restored.bytes).toEqual([0, 255, 128, 13, 10, 1]);
  expect(restored.type).toBe("application/octet-stream");
  const corruptRead = await page.evaluate(async (hash) => {
    const raw = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("local-binary-spike.blobs", 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = raw.transaction("blobs", "readwrite");
      tx.objectStore("blobs").put(new Blob(["damaged on disk"]), [
        "local-a",
        hash,
      ]);
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    raw.close();
    const api = (
      window as unknown as {
        OrivaneLocalStorageFixture: {
          IndexedDbLocalBlobStore: typeof IndexedDbLocalBlobStore;
        };
      }
    ).OrivaneLocalStorageFixture;
    const db = await api.IndexedDbLocalBlobStore.open("local-binary-spike");
    try {
      await db.get("local-a", hash);
      return "unexpected success";
    } catch (error) {
      return error instanceof Error ? error.message : "unknown error";
    } finally {
      db.close();
    }
  }, stored.hash);
  expect(corruptRead).toBe("HASH_MISMATCH");
});

test("staged Application transactions reject concurrent collection changes without persisting partial bodies", async ({
  page,
}, info) => {
  const bundle = await readFile(
    `.artifacts/local-storage-fixture-${info.workerIndex}/storage.js`,
    "utf8",
  );
  await page.route("http://127.0.0.1:19420/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Local Application transaction</title>",
    }),
  );
  await page.goto("http://127.0.0.1:19420/staged");
  await page.addScriptTag({ content: bundle });
  const evidence = await page.evaluate(async () => {
    const api = (
      window as unknown as {
        OrivaneLocalStorageFixture: {
          IndexedDbLocalStore: typeof import("../../packages/storage-local/src/indexed-db").IndexedDbLocalStore;
          LocalMutationTransaction: typeof import("../../packages/application/src/local-mutation-transaction").LocalMutationTransaction;
        };
      }
    ).OrivaneLocalStorageFixture;
    const db = await api.IndexedDbLocalStore.open("staged-local");
    const actor = { workspaceId: "local-a", principalId: "owner-a" };
    const begin = () =>
      api.LocalMutationTransaction.begin(
        db.metadata,
        actor,
        "device-a",
        { now: () => "2026-10-12T00:00:00Z" },
        { next: () => crypto.randomUUID() },
      );
    const first = await begin(),
      stale = await begin();
    const before = await stale.list("tasks");
    first.stage(
      {
        workspaceId: "local-a",
        collection: "tasks",
        id: "first",
        version: 1,
        value: { title: "First" },
      },
      null,
      "CREATE",
      { title: "First" },
    );
    await first.commit();
    stale.stage(
      {
        workspaceId: "local-a",
        collection: "tasks",
        id: "stale",
        version: 1,
        value: { title: "Stale" },
      },
      null,
      "CREATE",
      { title: "Stale" },
    );
    stale.stageInternal(
      {
        workspaceId: "local-a",
        collection: "$local.body",
        id: "stale",
        version: 1,
        value: { bodyMd: "Must never persist" },
      },
      null,
    );
    let rejected = false;
    try {
      await stale.commit();
    } catch (error) {
      rejected = error instanceof Error && error.message === "VERSION_CONFLICT";
    }
    const canceled = await begin();
    canceled.stage(
      {
        workspaceId: "local-a",
        collection: "tasks",
        id: "aborted",
        version: 1,
        value: {},
      },
      null,
      "CREATE",
      {},
    );
    canceled.abort();
    let closed = false;
    try {
      await canceled.commit();
    } catch (error) {
      closed =
        error instanceof Error && error.message === "LOCAL_TRANSACTION_CLOSED";
    }
    const successful = await begin();
    const read = await successful.get("tasks", "first");
    successful.stage(
      {
        workspaceId: "local-a",
        collection: "tasks",
        id: "second",
        version: 1,
        value: { title: "Second" },
      },
      null,
      "CREATE",
      { title: "Second" },
    );
    successful.stageInternal(
      {
        workspaceId: "local-a",
        collection: "$local.body",
        id: "second",
        version: 1,
        value: { bodyMd: "Preserved\nMarkdown" },
      },
      null,
    );
    const pending = await successful.list("tasks");
    successful.stage(
      {
        workspaceId: "local-a",
        collection: "tasks",
        id: "second",
        version: 2,
        value: { title: "Reconciled second" },
      },
      1,
      "PATCH",
      { title: "Reconciled second" },
    );
    successful.stageInternal(
      {
        workspaceId: "local-a",
        collection: "$local.body",
        id: "second",
        version: 2,
        value: { bodyMd: "Preserved\nMarkdown, revision two" },
      },
      1,
    );
    await successful.commit();
    const result = {
      before: before.length,
      rejected,
      closed,
      read: read?.id,
      pending: pending.map((entry) => entry.id),
      stale: await db.metadata.get("local-a", "tasks", "stale"),
      body: await db.metadata.get("local-a", "$local.body", "stale"),
      aborted: await db.metadata.get("local-a", "tasks", "aborted"),
      savedBody: (await db.metadata.get("local-a", "$local.body", "second"))
        ?.value,
      outbox: await db.outbox.list("local-a"),
      secondVersion: (await db.metadata.get("local-a", "tasks", "second"))
        ?.version,
      revision: (
        await db.metadata.get("local-a", "$local.workspace", "revision")
      )?.version,
    };
    db.close();
    return result;
  });
  expect(evidence.before).toBe(0);
  expect(evidence.rejected).toBe(true);
  expect(evidence.closed).toBe(true);
  expect(evidence.read).toBe("first");
  expect(evidence.pending).toEqual(["first", "second"]);
  expect(evidence.stale).toBeNull();
  expect(evidence.body).toBeNull();
  expect(evidence.aborted).toBeNull();
  expect(evidence.savedBody).toEqual({
    bodyMd: "Preserved\nMarkdown, revision two",
  });
  expect(evidence.secondVersion).toBe(2);
  expect(evidence.revision).toBe(2);
  expect(evidence.outbox).toHaveLength(3);
  expect(new Set(evidence.outbox.map((entry) => entry.id)).size).toBe(3);
  expect(evidence.outbox.map((entry) => entry.entityId).sort()).toEqual([
    "first",
    "second",
    "second",
  ]);
  expect(
    evidence.outbox
      .filter((entry) => entry.entityId === "second")
      .map((entry) => entry.baseVersion)
      .sort(),
  ).toEqual([1, null]);
});

test("local IndexedDB commits entity and outbox atomically, rejects stale writes, and survives reload", async ({
  page,
}, info) => {
  const bundle = await readFile(
    `.artifacts/local-storage-fixture-${info.workerIndex}/storage.js`,
    "utf8",
  );
  await page.route("http://127.0.0.1:19420/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Isolated local storage</title>",
    }),
  );
  await page.goto("http://127.0.0.1:19420/fixture");
  await page.addScriptTag({ content: bundle });
  const evidence = await page.evaluate(async () => {
    const { IndexedDbLocalStore } = (
      window as unknown as {
        OrivaneLocalStorageFixture: {
          IndexedDbLocalStore: typeof import("../../packages/storage-local/src/indexed-db").IndexedDbLocalStore;
        };
      }
    ).OrivaneLocalStorageFixture;
    const db = await IndexedDbLocalStore.open("local-spike");
    const write = (
      id: string,
      expectedVersion: number | null,
      mutationId = id,
    ): LocalWrite => ({
      entity: {
        workspaceId: "local-a",
        collection: "tasks",
        id,
        version: (expectedVersion ?? 0) + 1,
        value: { title: id },
      },
      expectedVersion,
      mutation: {
        id: mutationId,
        deviceId: "device-a",
        workspaceId: "local-a",
        principalId: "owner-a",
        operation: expectedVersion === null ? "CREATE" : "PATCH",
        entityType: "tasks",
        entityId: id,
        baseVersion: expectedVersion,
        payload: { title: id },
        createdAt: "2026-10-12T00:00:00Z",
        attemptCount: 0,
        lastAttemptAt: null,
        state: "PENDING",
      },
    });
    const started = performance.now();
    await db.metadata.commit(
      "local-a",
      "owner-a",
      Array.from({ length: 50 }, (_, index) => write("task-" + index, null)),
      [
        {
          entity: {
            workspaceId: "local-a",
            collection: "$local.workspace",
            id: "revision",
            version: 1,
            value: { revision: 1 },
          },
          expectedVersion: null,
        },
        {
          entity: {
            workspaceId: "local-a",
            collection: "$local.body",
            id: "note-a",
            version: 1,
            value: { bodyMd: "Original\nMarkdown" },
          },
          expectedVersion: null,
        },
      ],
    );
    const commitMs = performance.now() - started;
    let staleRejected = false;
    try {
      await db.metadata.commit("local-a", "owner-a", [
        write("new-before-stale", null),
        write("task-0", null, "stale"),
      ]);
    } catch (error) {
      staleRejected =
        error instanceof Error && error.message === "VERSION_CONFLICT";
    }
    let duplicateRejected = false;
    try {
      await db.metadata.commit("local-a", "owner-a", [
        write("task-1", 1, "task-0"),
      ]);
    } catch (error) {
      duplicateRejected =
        error instanceof DOMException && error.name === "ConstraintError";
    }
    let internalGuardRejected = false;
    try {
      await db.metadata.commit(
        "local-a",
        "owner-a",
        [write("guarded-task", null)],
        [
          {
            entity: {
              workspaceId: "local-a",
              collection: "$local.workspace",
              id: "revision",
              version: 1,
              value: { revision: 1 },
            },
            expectedVersion: null,
          },
          {
            entity: {
              workspaceId: "local-a",
              collection: "$local.body",
              id: "note-a",
              version: 2,
              value: { bodyMd: "Must roll back" },
            },
            expectedVersion: 1,
          },
        ],
      );
    } catch (error) {
      internalGuardRejected =
        error instanceof Error && error.message === "VERSION_CONFLICT";
    }
    let businessBypassRejected = false;
    try {
      await db.metadata.commit(
        "local-a",
        "owner-a",
        [write("bypass-task", null)],
        [
          {
            entity: {
              workspaceId: "local-a",
              collection: "tasks",
              id: "untracked",
              version: 1,
              value: {},
            },
            expectedVersion: null,
          },
        ],
      );
    } catch (error) {
      businessBypassRejected =
        error instanceof Error && error.message === "INVALID_WRITE";
    }
    const evidence = {
      internalGuardRejected,
      businessBypassRejected,
      guardedTask: await db.metadata.get("local-a", "tasks", "guarded-task"),
      bypassTask: await db.metadata.get("local-a", "tasks", "bypass-task"),
      originalBody: (await db.metadata.get("local-a", "$local.body", "note-a"))
        ?.value,
      commitMs,
      staleRejected,
      duplicateRejected,
      rollbackEntity: await db.metadata.get(
        "local-a",
        "tasks",
        "new-before-stale",
      ),
      originalVersion: (await db.metadata.get("local-a", "tasks", "task-1"))
        ?.version,
      outboxCount: (await db.outbox.list("local-a")).length,
      foreignWorkspaceCount: (await db.metadata.list("local-b", "tasks"))
        .length,
    };
    db.close();
    return evidence;
  });
  expect(evidence.staleRejected).toBe(true);
  expect(evidence.internalGuardRejected).toBe(true);
  expect(evidence.businessBypassRejected).toBe(true);
  expect(evidence.guardedTask).toBeNull();
  expect(evidence.bypassTask).toBeNull();
  expect(evidence.originalBody).toEqual({ bodyMd: "Original\nMarkdown" });
  expect(evidence.duplicateRejected).toBe(true);
  expect(evidence.rollbackEntity).toBeNull();
  expect(evidence.originalVersion).toBe(1);
  expect(evidence.outboxCount).toBe(50);
  expect(evidence.foreignWorkspaceCount).toBe(0);
  await page.reload();
  await page.addScriptTag({ content: bundle });
  const recovered = await page.evaluate(async () => {
    const api = (
      window as unknown as {
        OrivaneLocalStorageFixture: {
          IndexedDbLocalStore: typeof IndexedDbLocalStore;
        };
      }
    ).OrivaneLocalStorageFixture;
    const db = await api.IndexedDbLocalStore.open("local-spike");
    const entities = await db.metadata.list("local-a", "tasks");
    const outbox = await db.outbox.list("local-a");
    db.close();
    return {
      count: entities.length,
      outboxCount: outbox.length,
      versions: entities.map((entity) => entity.version),
    };
  });
  expect(recovered.count).toBe(50);
  expect(recovered.outboxCount).toBe(50);
  expect(recovered.versions.every((version) => version === 1)).toBe(true);
  await info.attach("local-transaction-benchmark", {
    body: JSON.stringify(evidence),
    contentType: "application/json",
  });
});
