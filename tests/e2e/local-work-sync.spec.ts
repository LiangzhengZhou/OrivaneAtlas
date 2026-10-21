import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import type * as localApi from "../../apps/web/test-fixtures/local-storage";
import type * as hostApi from "../fixtures/local-sync-host";

test.beforeAll(async ({}, info) => {
  await Promise.all(
    [
      "scripts/build-local-storage-fixture.mjs",
      "scripts/build-local-sync-host-fixture.mjs",
    ].map((script) =>
      promisify(execFile)(
        process.execPath,
        [script, String(info.workerIndex)],
        { timeout: 30000 },
      ),
    ),
  );
});

test("real cookie/CSRF Work replay and atomic IndexedDB ACK preserve subsequent offline edits", async ({
  page,
}, info) => {
  const api = (await import(
    pathToFileURL(
      resolve(
        `.artifacts/local-sync-host-fixture-${info.workerIndex}/local-sync-host.js`,
      ),
    ).href
  )) as typeof hostApi;
  const reserve = createServer();
  await new Promise<void>((done) => reserve.listen(0, "127.0.0.1", done));
  const port = (reserve.address() as AddressInfo).port;
  await new Promise<void>((done, reject) =>
    reserve.close((error) => (error ? reject(error) : done())),
  );
  const origin = `http://127.0.0.1:${port}`;
  const directory = await mkdtemp(join(tmpdir(), "orivane-local-work-sync-"));
  const host = await api.createHost({
    database: join(directory, "work.sqlite"),
    secret: randomBytes(32).toString("hex"),
    origin,
    webRoot: directory,
    model: null,
    clock: { now: () => "2026-10-13T12:00:00Z" },
  });
  try {
    const verifier = await api.passwordHash("Test-only-password-123");
    await host.db.accounts((store) => store.register("owner", verifier, true));
    await new Promise<void>((done) =>
      host.server.listen(port, "127.0.0.1", done),
    );
    await page.route(origin + "/fixture.html", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Local Work Sync</title>",
      }),
    );
    await page.goto(origin + "/fixture.html");
    await page.addScriptTag({
      content: await readFile(
        `.artifacts/local-storage-fixture-${info.workerIndex}/storage.js`,
        "utf8",
      ),
    });
    const result = await page.evaluate(async () => {
      const api = (
        window as unknown as { OrivaneLocalStorageFixture: typeof localApi }
      ).OrivaneLocalStorageFixture;
      const login = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "owner",
          password: "Test-only-password-123",
        }),
      });
      if (!login.ok) throw new Error("TEST_LOGIN_FAILED");
      const session = await login.json();
      let db = await api.IndexedDbLocalStore.open("live-work-sync");
      const blobs = await api.IndexedDbLocalBlobStore.open(
        "live-work-sync-bytes",
      );
      const own = await db.identity.ensure({
        schemaVersion: 1,
        workspaceId: crypto.randomUUID(),
        principalId: crypto.randomUUID(),
        deviceId: crypto.randomUUID(),
      });
      const makeRuntime = () =>
        new api.LocalRuntime(
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
                    aliases.get(api.normalizeWikiTitle(link.targetText)) ??
                    null,
                }));
              },
            },
            { now: () => "2026-10-13T00:00:00Z" },
            { next: () => crypto.randomUUID() },
          ),
        );
      let runtime = makeRuntime();
      const task = await runtime.service.create(runtime.context, {
        title: "Offline source",
        descriptionMd: "原文\n第二行",
      });
      const remoteState = await (await fetch("/api/sync?after=0")).json();
      const binding = {
        workspaceId: own.workspaceId,
        remoteWorkspaceId: session.context.workspaceId as string,
        remotePrincipalId: session.context.principalId as string,
        serverOrigin: location.origin,
        epoch: remoteState.epoch as string,
        cursor: remoteState.cursor as number,
        version: 1,
      };
      await db.syncState.save(binding, null); // Explicit isolated test binding, not product auto-merge.
      const plans = await api.planLocalCommands(
        runtime.context,
        db.metadata,
        await db.outbox.list(own.workspaceId),
      );
      const ready = plans.find((plan) => plan.command?.name === "work.create");
      if (!ready) throw new Error("MISSING_CREATE_PLAN");
      const request = api.buildLocalWorkReplayRequest(ready);
      if (!request) throw new Error("MISSING_REPLAY_REQUEST");
      await db.outbox.transitionMany(
        ready.mutations.map((mutation) => ({
          workspaceId: own.workspaceId,
          mutationId: mutation.id,
          binding,
          expectedState: "PENDING" as const,
          expectedAttemptCount: 0,
          expectedLastAttemptAt: null,
          nextState: "SENDING" as const,
          at: "2026-10-13T00:01:00Z",
        })),
      );
      const response = await fetch(request.path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrf,
          "Idempotency-Key": request.idempotencyKey,
        },
        body: JSON.stringify(request.body),
      });
      if (!response.ok) throw new Error(`REPLAY_${response.status}`);
      const receipt = await response.json();
      // Interrupt the local connection after the server committed but before ACK.
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      runtime = makeRuntime();
      const recoveredPlans = await api.planLocalCommands(
        runtime.context,
        db.metadata,
        await db.outbox.list(own.workspaceId),
      );
      const recoveredPlan = recoveredPlans.find((plan) => plan.id === ready.id);
      if (recoveredPlan?.state !== "RECEIPT_REQUIRED")
        throw new Error("ATTEMPT_NOT_DURABLE");
      const recoveredRequest = api.buildLocalWorkReplayRequest(recoveredPlan);
      if (JSON.stringify(recoveredRequest) !== JSON.stringify(request))
        throw new Error("ORIGINAL_REQUEST_CHANGED_ON_RESTART");
      const lookupPath = `/api/v1/sync/receipt?commandId=${request.idempotencyKey}&deviceId=${request.deviceId}`;
      const recoveredResponse = await fetch(lookupPath);
      if (!recoveredResponse.ok)
        throw new Error(`RECEIPT_LOOKUP_${recoveredResponse.status}`);
      const recoveredReceipt = await recoveredResponse.json();
      if (JSON.stringify(recoveredReceipt) !== JSON.stringify(receipt))
        throw new Error("RECEIPT_LOOKUP_CHANGED");
      const missingReceipt = await fetch(
        `/api/v1/sync/receipt?commandId=${request.idempotencyKey}&deviceId=${crypto.randomUUID()}`,
      );
      if (missingReceipt.status !== 404)
        throw new Error("FOREIGN_DEVICE_RECEIPT_EXPOSED");
      // Real user edit occurs after server acceptance, before durable local ACK.
      await runtime.service.update(runtime.context, task.id, task.version, {
        title: "Later local edit",
        descriptionMd: "本地后续\n不能覆盖",
      });
      const pending = await db.outbox.list(own.workspaceId);
      const sending = (
        await api.planLocalCommands(runtime.context, db.metadata, pending)
      ).find((plan) => plan.id === ready.id);
      if (!sending) throw new Error("MISSING_SENDING_PLAN");
      const prepared = await api.prepareLocalWorkReplayAcknowledgement(
        runtime.context,
        binding,
        sending,
        recoveredReceipt,
        pending,
        db.metadata,
      );
      const recovery = await api.recoverLocalWorkReceipts(runtime.context, {
        metadata: db.metadata,
        outbox: db.outbox,
        syncState: db.syncState,
        replica: db.replica,
        transport: {
          lookup: async (scope, commandId, deviceId) => {
            if (
              scope.remotePrincipalId !== session.context.principalId ||
              scope.remoteWorkspaceId !== session.context.workspaceId ||
              scope.serverOrigin !== location.origin
            )
              throw new Error("RECOVERY_SCOPE_MISMATCH");
            const response = await fetch(
              `/api/v1/sync/receipt?commandId=${commandId}&deviceId=${deviceId}`,
            );
            if (response.status === 404) return null;
            if (!response.ok) throw new Error(`RECOVERY_${response.status}`);
            return response.json();
          },
        },
      });
      if (
        JSON.stringify(recovery) !==
        JSON.stringify({ acknowledged: [ready.id], unresolved: [] })
      )
        throw new Error("APPLICATION_RECOVERY_FAILED");
      const beforeDuplicate = JSON.stringify(
        await db.metadata.exportWorkspace!(own.workspaceId),
      );
      let duplicateRejected = false;
      try {
        await db.replica.commit(prepared);
      } catch (error) {
        duplicateRejected =
          error instanceof Error && error.message === "VERSION_CONFLICT";
      }
      const duplicateAtomic =
        beforeDuplicate ===
        JSON.stringify(await db.metadata.exportWorkspace!(own.workspaceId));
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      const retained = await db.metadata.get(own.workspaceId, "items", task.id);
      const base = await db.metadata.get(
        own.workspaceId,
        "$local.remoteBase",
        JSON.stringify(["items", task.id]),
      );
      const remaining = await db.outbox.list(own.workspaceId);
      const sync = await db.syncState.get(own.workspaceId);
      const duplicateResponse = await fetch(request.path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrf,
          "Idempotency-Key": request.idempotencyKey,
        },
        body: JSON.stringify(request.body),
      });
      const repeated = await duplicateResponse.json();
      const snapshot = await (await fetch("/api/snapshot")).json();
      const pullBinding = await db.syncState.get(own.workspaceId);
      if (!pullBinding) throw new Error("MISSING_PULL_BINDING");
      const deltaResponse = await fetch(
        `/api/v1/sync?after=${pullBinding.cursor}&epoch=${encodeURIComponent(pullBinding.epoch!)}&bodyMode=metadata`,
      );
      if (!deltaResponse.ok) throw new Error(`PULL_${deltaResponse.status}`);
      const delta = await deltaResponse.json();
      const pull = await api.prepareLocalWorkPull(
        runtime.context,
        pullBinding,
        delta,
        remaining,
        db.metadata,
      );
      if (!pull) throw new Error("MISSING_WORK_DELTA");
      await db.replica.commit(pull);
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      const pulledSync = await db.syncState.get(own.workspaceId);
      const pulledTask = await db.metadata.get(
        own.workspaceId,
        "items",
        task.id,
      );
      const pulledPending = await db.outbox.list(own.workspaceId);
      let loseReplyOnce = true,
        coordinatorSends = 0;
      const makeCoordinator = () =>
        new api.LocalWorkSyncCoordinator(runtime.context, {
          metadata: db.metadata,
          outbox: db.outbox,
          syncState: db.syncState,
          replica: db.replica,
          clock: { now: () => "2026-10-13T00:02:00Z" },
          pendingRebase: {
            store: db.pendingWorkRebase,
            ids: { next: () => crypto.randomUUID() },
          },
          knowledgeWiki: {
            extract: (id, body) => api.indexDocument(id, body, []),
            resolve: (links) => [...links],
          },
          transport: {
            lookup: async (scope, commandId, deviceId) => {
              if (
                scope.remotePrincipalId !== session.context.principalId ||
                scope.remoteWorkspaceId !== session.context.workspaceId ||
                scope.serverOrigin !== location.origin
              )
                throw new Error("COORDINATOR_SCOPE_MISMATCH");
              const response = await fetch(
                `/api/v1/sync/receipt?commandId=${commandId}&deviceId=${deviceId}`,
              );
              if (response.status === 404) return null;
              if (!response.ok) throw new Error(`LOOKUP_${response.status}`);
              return response.json();
            },
            pull: async (scope) => {
              const response = await fetch(
                `/api/v1/sync?after=${scope.cursor}&epoch=${encodeURIComponent(scope.epoch!)}&bodyMode=metadata`,
              );
              if (!response.ok)
                throw new Error(`COORDINATOR_PULL_${response.status}`);
              return response.json();
            },
            send: async (_scope, request) => {
              coordinatorSends++;
              const response = await fetch(request.path, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-CSRF-Token": session.csrf,
                  "Idempotency-Key": request.idempotencyKey,
                },
                body: JSON.stringify(request.body),
              });
              if (response.status === 409)
                throw new api.DomainError("VERSION_CONFLICT");
              if (!response.ok)
                throw new Error(`COORDINATOR_PUSH_${response.status}`);
              const receipt = await response.json();
              // Lose one transport result after a real server commit, never fake a success response.
              if (loseReplyOnce) {
                loseReplyOnce = false;
                throw new Error("TEST_RESPONSE_LOST_AFTER_COMMIT");
              }
              return receipt;
            },
          },
        });
      let coordinator = makeCoordinator();
      let uncertainRejected = false;
      try {
        await coordinator.run();
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message !== "TEST_RESPONSE_LOST_AFTER_COMMIT"
        )
          throw error;
        uncertainRejected = true;
      }
      const uncertainPending = await db.outbox.list(own.workspaceId);
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      coordinator = makeCoordinator();
      runtime = makeRuntime();
      const firstSync = coordinator.run(),
        overlappingSync = coordinator.run();
      if (firstSync !== overlappingSync)
        throw new Error("COORDINATOR_NOT_COALESCED");
      const coordinated = await firstSync;
      await overlappingSync;
      const coordinatedPending = await db.outbox.list(own.workspaceId);
      const coordinatedSnapshot = await (await fetch("/api/snapshot")).json();
      const coordinatorSendsBeforeConflict = coordinatorSends;
      await runtime.service.update(runtime.context, task.id, 2, {
        title: "Unsent conflicting title",
      });
      const conflictPendingBefore = await db.outbox.list(own.workspaceId);
      const remoteEdit = await fetch("/api/work/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrf,
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          id: task.id,
          version: 2,
          input: { title: "Remote conflicting title" },
        }),
      });
      if (!remoteEdit.ok) throw new Error(`REMOTE_EDIT_${remoteEdit.status}`);
      const conflictResult = await coordinator.run();
      const conflictPendingAfter = await db.outbox.list(own.workspaceId);
      const conflictLocalTask = await db.metadata.get(
        own.workspaceId,
        "items",
        task.id,
      );
      const conflictRemoteSnapshot = await (
        await fetch("/api/snapshot")
      ).json();
      const workCoordinatorSends = coordinatorSends;
      const mergeTask = await runtime.service.create(runtime.context, {
        title: "Clean merge source",
      });
      await coordinator.run();
      await runtime.service.update(runtime.context, mergeTask.id, 1, {
        priority: "HIGH",
      });
      const beforeRebase = (await db.outbox.list(own.workspaceId)).find(
        (entry) => entry.entityId === mergeTask.id,
      );
      if (!beforeRebase) throw new Error("MISSING_REBASE_INTENT");
      const disjointEdit = await fetch("/api/work/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrf,
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          id: mergeTask.id,
          version: 1,
          input: { title: "Canonical remote title" },
        }),
      });
      if (!disjointEdit.ok)
        throw new Error(`DISJOINT_EDIT_${disjointEdit.status}`);
      await coordinator.run();
      const rebasedTask = await db.metadata.get(
        own.workspaceId,
        "items",
        mergeTask.id,
      );
      const supersededIntent = await db.metadata.get(
        own.workspaceId,
        "$local.superseded",
        beforeRebase.id,
      );
      if (
        !rebasedTask ||
        !supersededIntent ||
        (await db.outbox.list(own.workspaceId)).some(
          (entry) => entry.entityId === mergeTask.id,
        )
      )
        throw new Error("CLEAN_REBASE_NOT_ACKNOWLEDGED");
      const note = await runtime.saveNote(null, 0, {
        title: "Offline note",
        bodyMd: "知识原文\n第二行",
        kind: "NOTE",
        day: null,
      });
      const knowledgeReady = (
        await api.planLocalCommands(
          runtime.context,
          db.metadata,
          await db.outbox.list(own.workspaceId),
        )
      ).find((plan) => plan.command?.name === "note.save");
      if (!knowledgeReady) throw new Error("MISSING_KNOWLEDGE_PLAN");
      const knowledgeRequest =
        api.buildLocalKnowledgeReplayRequest(knowledgeReady);
      const knowledgeBinding = await db.syncState.get(own.workspaceId);
      if (
        !knowledgeRequest ||
        !knowledgeBinding ||
        !knowledgeBinding.remoteWorkspaceId ||
        !knowledgeBinding.serverOrigin
      )
        throw new Error("MISSING_KNOWLEDGE_BINDING");
      const knowledgeClaimBinding = {
        ...knowledgeBinding,
        remoteWorkspaceId: knowledgeBinding.remoteWorkspaceId,
        serverOrigin: knowledgeBinding.serverOrigin,
      };
      await db.outbox.transitionMany(
        knowledgeReady.mutations.map((mutation) => ({
          workspaceId: own.workspaceId,
          mutationId: mutation.id,
          binding: knowledgeClaimBinding,
          expectedState: "PENDING" as const,
          expectedAttemptCount: 0,
          expectedLastAttemptAt: null,
          nextState: "SENDING" as const,
          at: "2026-10-13T00:03:00Z",
        })),
      );
      const knowledgeResponse = await fetch(knowledgeRequest.path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrf,
          "Idempotency-Key": knowledgeRequest.idempotencyKey,
        },
        body: JSON.stringify(knowledgeRequest.body),
      });
      if (!knowledgeResponse.ok)
        throw new Error(`KNOWLEDGE_PUSH_${knowledgeResponse.status}`);
      const knowledgeReceipt = await knowledgeResponse.json();
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      runtime = makeRuntime();
      const knowledgePending = await db.outbox.list(own.workspaceId);
      const knowledgeAttempt = (
        await api.planLocalCommands(
          runtime.context,
          db.metadata,
          knowledgePending,
        )
      ).find((plan) => plan.id === knowledgeReady.id);
      if (!knowledgeAttempt)
        throw new Error("MISSING_KNOWLEDGE_ATTEMPT_AFTER_RESTART");
      const knowledgeRecovery = await api.recoverLocalWorkReceipts(
        runtime.context,
        {
          metadata: db.metadata,
          outbox: db.outbox,
          syncState: db.syncState,
          replica: db.replica,
          knowledgeWiki: {
            extract: (id, body) => api.indexDocument(id, body, []),
            resolve: (links) => [...links],
          },
          transport: {
            lookup: async (scope, commandId, deviceId) => {
              if (
                scope.serverOrigin !== location.origin ||
                scope.remoteWorkspaceId !== session.context.workspaceId ||
                scope.remotePrincipalId !== session.context.principalId
              )
                throw new Error("KNOWLEDGE_RECOVERY_SCOPE_MISMATCH");
              const response = await fetch(
                `/api/v1/sync/receipt?commandId=${commandId}&deviceId=${deviceId}`,
              );
              if (response.status === 404) return null;
              if (!response.ok)
                throw new Error(`KNOWLEDGE_RECEIPT_${response.status}`);
              return response.json();
            },
          },
        },
      );
      if (
        JSON.stringify(knowledgeRecovery.acknowledged) !==
        JSON.stringify([knowledgeAttempt.id])
      )
        throw new Error("KNOWLEDGE_RECOVERY_NOT_ACKNOWLEDGED");
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      runtime = makeRuntime();
      const knowledgeRecovered = await runtime.readDocumentBody(note);
      const knowledgeRevisions = await runtime.revisions(note.id);
      const knowledgeRemaining = await db.outbox.list(own.workspaceId);
      const space = await runtime.saveLibrary(null, 0, {
        kind: "SPACE",
        spaceId: null,
        title: "Offline knowledge",
        bodyMd: "Description",
      });
      const document = await runtime.saveLibrary(null, 0, {
        kind: "DOCUMENT",
        spaceId: space.id,
        title: "Offline document",
        bodyMd: "Original document\n[[Target]]",
      });
      const libraryPlans = (
        await api.planLocalCommands(
          runtime.context,
          db.metadata,
          await db.outbox.list(own.workspaceId),
        )
      ).filter((plan) => plan.command?.name === "library.save");
      for (const ready of libraryPlans) {
        const currentBinding = await db.syncState.get(own.workspaceId);
        const request = api.buildLocalKnowledgeReplayRequest(ready);
        if (
          !currentBinding ||
          !request ||
          !currentBinding.remoteWorkspaceId ||
          !currentBinding.serverOrigin
        )
          throw new Error("MISSING_LIBRARY_REPLAY");
        const libraryClaimBinding = {
          ...currentBinding,
          remoteWorkspaceId: currentBinding.remoteWorkspaceId,
          serverOrigin: currentBinding.serverOrigin,
        };
        await db.outbox.transitionMany(
          ready.mutations.map((mutation) => ({
            workspaceId: own.workspaceId,
            mutationId: mutation.id,
            binding: libraryClaimBinding,
            expectedState: "PENDING" as const,
            expectedAttemptCount: 0,
            expectedLastAttemptAt: null,
            nextState: "SENDING" as const,
            at: "2026-10-13T00:04:00Z",
          })),
        );
        const response = await fetch(request.path, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrf,
            "Idempotency-Key": request.idempotencyKey,
          },
          body: JSON.stringify(request.body),
        });
        if (!response.ok) throw new Error(`LIBRARY_REPLAY_${response.status}`);
        const pending = await db.outbox.list(own.workspaceId);
        const attempted = (
          await api.planLocalCommands(runtime.context, db.metadata, pending)
        ).find((plan) => plan.id === ready.id);
        if (!attempted) throw new Error("MISSING_LIBRARY_ATTEMPT");
        await db.replica.commit(
          await api.prepareLocalKnowledgeReplayAcknowledgement(
            runtime.context,
            currentBinding,
            attempted,
            await response.json(),
            pending,
            db.metadata,
            {
              extract: (id, body) => api.indexDocument(id, body, []),
              resolve: (links) => [...links],
            },
          ),
        );
      }
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      runtime = makeRuntime();
      const libraryRecovered = await runtime.readDocumentBody(document);
      const librarySource = await db.metadata.get(
        own.workspaceId,
        "$local.wikiSources",
        document.id,
      );
      const librarySearch = await db.metadata.get(
        own.workspaceId,
        "$local.librarySearch",
        document.id,
      );
      const libraryRemaining = await db.outbox.list(own.workspaceId);
      const remoteNoteResponse = await fetch("/api/note/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrf,
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          id: null,
          version: 0,
          input: {
            kind: "NOTE",
            day: null,
            title: "Remote-only note",
            bodyMd: "远端正文\n不能变空",
          },
        }),
      });
      if (!remoteNoteResponse.ok)
        throw new Error(`REMOTE_NOTE_${remoteNoteResponse.status}`);
      const remoteNote = await remoteNoteResponse.json();
      const remoteDocumentResponse = await fetch("/api/library/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrf,
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          id: null,
          version: 0,
          input: {
            kind: "DOCUMENT",
            spaceId: space.id,
            title: "Remote-only document",
            bodyMd: "远端知识\n[[Remote Target]]",
          },
        }),
      });
      if (!remoteDocumentResponse.ok)
        throw new Error(`REMOTE_DOCUMENT_${remoteDocumentResponse.status}`);
      const remoteDocument = await remoteDocumentResponse.json();
      const metadataBinding = await db.syncState.get(own.workspaceId);
      if (!metadataBinding) throw new Error("MISSING_METADATA_BINDING");
      const metadataPage = await (
        await fetch(
          `/api/v1/sync?after=${metadataBinding.cursor}&epoch=${encodeURIComponent(metadataBinding.epoch!)}&bodyMode=metadata`,
        )
      ).json();
      const metadataCommit = await api
        .prepareLocalWorkPull(
          runtime.context,
          metadataBinding,
          metadataPage,
          await db.outbox.list(own.workspaceId),
          db.metadata,
        )
        .catch((error: unknown) => {
          throw new Error(
            JSON.stringify({
              failure: String(error),
              details: error instanceof api.DomainError ? error.params : null,
              collections: Object.keys(metadataPage.changes.collections),
              values: Object.keys(metadataPage.changes.values),
              records: metadataPage.records.map(
                (record: {
                  collection: string;
                  entityId: string;
                  version: number;
                }) => ({
                  collection: record.collection,
                  id: record.entityId,
                  version: record.version,
                }),
              ),
            }),
          );
        });
      if (!metadataCommit) throw new Error("MISSING_REMOTE_METADATA_COMMIT");
      await db.replica.commit(metadataCommit);
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      runtime = makeRuntime();
      const metadataWorkspace = await runtime.loadWorkspace();
      const unhydratedWiki = metadataWorkspace.wikiLinks?.filter(
        (link) => link.sourceDocumentId === remoteDocument.id,
      );
      const remoteManifest = metadataWorkspace.notes.find(
        (entry) => entry.id === remoteNote.id,
      );
      if (!remoteManifest) throw new Error("MISSING_REMOTE_MANIFEST");
      let remoteUnavailable = false;
      try {
        await runtime.readDocumentBody(remoteManifest);
      } catch (error) {
        remoteUnavailable =
          error instanceof Error && error.message === "LOCAL_BODY_UNAVAILABLE";
      }
      if (!remoteUnavailable)
        throw new Error("REMOTE_BODY_MUST_NOT_BE_EMPTY_OR_CORRUPT");
      const hydrationBinding = await db.syncState.get(own.workspaceId);
      if (!hydrationBinding) throw new Error("MISSING_HYDRATION_BINDING");
      const remoteBody = await (
        await fetch(
          `/api/document/body?id=${encodeURIComponent(remoteNote.id)}&kind=NOTE`,
        )
      ).json();
      await db.replica.commit(
        await api.prepareLocalKnowledgeHydration(
          runtime.context,
          hydrationBinding,
          "notes",
          remoteNote.id,
          remoteManifest.version,
          remoteBody,
          await db.outbox.list(own.workspaceId),
          db.metadata,
          {
            extract: (id, body) => api.indexDocument(id, body, []),
            resolve: (links) => [...links],
          },
        ),
      );
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      runtime = makeRuntime();
      const hydratedRemoteNote = await runtime.readDocumentBody(remoteManifest);
      const remoteDocumentManifest = metadataWorkspace.library.find(
        (entry) => entry.id === remoteDocument.id,
      );
      const documentBinding = await db.syncState.get(own.workspaceId);
      if (!remoteDocumentManifest || !documentBinding)
        throw new Error("MISSING_REMOTE_DOCUMENT_MANIFEST");
      const documentBody = await (
        await fetch(
          `/api/document/body?id=${encodeURIComponent(remoteDocument.id)}&kind=LIBRARY`,
        )
      ).json();
      await db.replica.commit(
        await api.prepareLocalKnowledgeHydration(
          runtime.context,
          documentBinding,
          "library",
          remoteDocument.id,
          remoteDocumentManifest.version,
          documentBody,
          await db.outbox.list(own.workspaceId),
          db.metadata,
          {
            extract: (id, body) => api.indexDocument(id, body, []),
            resolve: (links) => [...links],
          },
        ),
      );
      const hydratedRemoteDocument = await runtime.readDocumentBody(
        remoteDocumentManifest,
      );
      const hydratedWiki = (await runtime.loadWorkspace()).wikiLinks?.filter(
        (link) => link.sourceDocumentId === remoteDocument.id,
      );
      const hydratedPending = await db.outbox.list(own.workspaceId);
      const coordinatedNote = await runtime.saveNote(null, 0, {
        kind: "NOTE",
        day: null,
        title: "Coordinated note",
        bodyMd: "协调器原文\n不重建命令",
      });
      const coordinatedKnowledgeReady = (
        await api.planLocalCommands(
          runtime.context,
          db.metadata,
          await db.outbox.list(own.workspaceId),
        )
      ).find(
        (plan) => plan.command?.name === "note.save" && plan.state === "READY",
      );
      if (!coordinatedKnowledgeReady)
        throw new Error("MISSING_COORDINATED_KNOWLEDGE");
      const coordinatedKnowledge = await makeCoordinator().run();
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      runtime = makeRuntime();
      const coordinatedKnowledgeBody =
        await runtime.readDocumentBody(coordinatedNote);
      const coordinatedKnowledgePending = await db.outbox.list(own.workspaceId);
      const reminderInput = {
        title: "Coordinated reminder",
        bodyMd: "提醒原文\n离线保留",
        day: "2026-10-14",
        time: "10:30",
        timezone: "Asia/Shanghai",
        notifyMode: "MINUTES_BEFORE" as const,
        notifyOffsetMinutes: 15,
        linkedProjectId: null,
        linkedTaskId: null,
        state: "ACTIVE" as const,
      };
      const coordinatedReminder = await runtime.saveReminder(
        null,
        0,
        reminderInput,
      );
      const reminderPlan = (
        await api.planLocalCommands(
          runtime.context,
          db.metadata,
          await db.outbox.list(own.workspaceId),
        )
      ).find(
        (plan) =>
          plan.command?.name === "reminder.save" && plan.state === "READY",
      );
      if (!reminderPlan) throw new Error("MISSING_REMINDER_COMMAND");
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      runtime = makeRuntime();
      const coordinatedReminderResult = await makeCoordinator()
        .run()
        .catch((error: unknown) => {
          if (error instanceof api.DomainError)
            throw new Error(
              "REMINDER_COORDINATOR " +
                JSON.stringify({ code: error.code, params: error.params }),
            );
          throw error;
        });
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      runtime = makeRuntime();
      const coordinatedReminderSnapshot = (
        await runtime.loadWorkspace()
      ).reminders?.find((value) => value.id === coordinatedReminder.id);
      const coordinatedReminderPending = await db.outbox.list(own.workspaceId);
      const reminderDone = await runtime.saveReminder(
        coordinatedReminder.id,
        1,
        { ...reminderInput, state: "DONE" },
      );
      const reminderDoneResult = await makeCoordinator().run();
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      runtime = makeRuntime();
      const reminderDoneSnapshot = (
        await runtime.loadWorkspace()
      ).reminders?.find((value) => value.id === reminderDone.id);
      await runtime.service.setCalendarSettings(
        runtime.context,
        0,
        "Asia/Shanghai",
      );
      const calendarPlan = (
        await api.planLocalCommands(
          runtime.context,
          db.metadata,
          await db.outbox.list(own.workspaceId),
        )
      ).find(
        (plan) =>
          plan.command?.name === "calendar.settings" && plan.state === "READY",
      );
      if (!calendarPlan) throw new Error("MISSING_CALENDAR_COMMAND");
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      runtime = makeRuntime();
      const calendarResult = await makeCoordinator().run();
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      runtime = makeRuntime();
      const calendarSnapshot = (await runtime.loadWorkspace()).calendarSettings;
      const calendarPending = await db.outbox.list(own.workspaceId);
      const localPreference = (await runtime.loadWorkspace())
        .navigationPreference;
      if (!localPreference) throw new Error("MISSING_LOCAL_NAVIGATION");
      await runtime.service.setNavigationPreference(runtime.context, {
        ...localPreference,
        desktop: { ...localPreference.desktop, hidden: ["journal"] },
      });
      const navigationPlan = (
        await api.planLocalCommands(
          runtime.context,
          db.metadata,
          await db.outbox.list(own.workspaceId),
        )
      ).find(
        (plan) =>
          plan.command?.name === "navigation.save" && plan.state === "READY",
      );
      if (!navigationPlan) throw new Error("MISSING_NAVIGATION_COMMAND");
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      runtime = makeRuntime();
      const navigationResult = await makeCoordinator().run();
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      runtime = makeRuntime();
      const navigationSnapshot = (await runtime.loadWorkspace())
        .navigationPreference;
      const navigationPending = await db.outbox.list(own.workspaceId);
      await runtime.service.moveNavigationPreference(runtime.context, {
        version: 1,
        movingId: "focus",
        anchorId: "tasks",
        placement: "BEFORE",
      });
      const navigationMoveResult = await makeCoordinator().run();
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      runtime = makeRuntime();
      const navigationMoveSnapshot = (await runtime.loadWorkspace())
        .navigationPreference;
      const orderTask = await runtime.service.create(runtime.context, {
        title: "Order replay member",
      });
      const orderTaskResult = await makeCoordinator().run();
      await runtime.moveManualOrder({
        scope: { kind: "WORKSPACE_TASKS" },
        version: 0,
        entityId: orderTask.id,
        anchorId: task.id,
        placement: "BEFORE",
      });
      const orderPlan = (
        await api.planLocalCommands(
          runtime.context,
          db.metadata,
          await db.outbox.list(own.workspaceId),
        )
      ).find(
        (plan) =>
          plan.command?.name === "manual-order.move" && plan.state === "READY",
      );
      if (!orderPlan) throw new Error("MISSING_ORDER_COMMAND");
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      runtime = makeRuntime();
      const orderResult = await makeCoordinator().run();
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      runtime = makeRuntime();
      const orderSnapshot = (await runtime.loadWorkspace()).manualOrders?.find(
        (state) => state.id === "WORKSPACE_TASKS",
      );
      const orderPending = await db.outbox.list(own.workspaceId);
      const categoryA = await runtime.saveCategory({
        version: 0,
        name: "Replay category A",
        deleted: false,
      });
      const categoryB = await runtime.saveCategory({
        version: 0,
        name: "Replay category B",
        deleted: false,
      });
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      runtime = makeRuntime();
      const categoryCreateResult = await makeCoordinator().run();
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      runtime = makeRuntime();
      const categoryCreated = (await runtime.loadWorkspace()).categories;
      await runtime.reorderCategories([
        { id: categoryB.id, version: 1 },
        { id: categoryA.id, version: 1 },
      ]);
      const categoryPlans = await api.planLocalCommands(
        runtime.context,
        db.metadata,
        await db.outbox.list(own.workspaceId),
      );
      const categoryOrderPlan = categoryPlans.find(
        (plan) =>
          plan.command?.name === "category.reorder" && plan.state === "READY",
      );
      if (!categoryOrderPlan)
        throw new Error("MISSING_CATEGORY_REORDER_COMMAND");
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      runtime = makeRuntime();
      const categoryOrderResult = await makeCoordinator().run();
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      runtime = makeRuntime();
      const categoryOrdered = (await runtime.loadWorkspace()).categories;
      const categoryPending = await db.outbox.list(own.workspaceId);
      await runtime
        .organize({
          kind: "WORK",
          action: "archive",
          entries: [{ id: orderTask.id, version: 1, organizationVersion: 0 }],
        })
        .catch((error: unknown) => {
          throw new Error("ORGANIZATION_LOCAL " + String(error));
        });
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      runtime = makeRuntime();
      const organizationResult = await makeCoordinator()
        .run()
        .catch((error: unknown) => {
          throw new Error("ORGANIZATION_SYNC " + String(error));
        });
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      runtime = makeRuntime();
      const organizationSnapshot = (await runtime.loadWorkspace()).organization;
      const organizationPending = await db.outbox.list(own.workspaceId);
      await runtime.organize({
        kind: "WORK",
        action: "delete",
        entries: [{ id: orderTask.id, version: 1, organizationVersion: 1 }],
      });
      const organizationDeleteResult = await makeCoordinator().run();
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      runtime = makeRuntime();
      const organizationDeletedTask = (
        await runtime.loadWorkspace()
      ).items.find((item) => item.id === orderTask.id);
      const organizationDeletePending = await db.outbox.list(own.workspaceId);
      await runtime.organize({
        kind: "NOTE",
        action: "move",
        folder: "Replay folder",
        entries: [
          {
            id: coordinatedNote.id,
            version: 1,
            organizationVersion: 0,
          },
        ],
      });
      const noteMoveResult = await makeCoordinator().run();
      await runtime.organize({
        kind: "NOTE",
        action: "delete",
        entries: [
          {
            id: coordinatedNote.id,
            version: 1,
            organizationVersion: 1,
          },
        ],
      });
      const noteDeleteResult = await makeCoordinator()
        .run()
        .catch((error: unknown) => {
          if (error instanceof api.DomainError)
            throw new Error(
              "NOTE_ORGANIZATION_DELETE " +
                JSON.stringify({ code: error.code, params: error.params }),
            );
          throw error;
        });
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      runtime = makeRuntime();
      const organizedNote = await db.metadata.get(
        own.workspaceId,
        "notes",
        coordinatedNote.id,
      );
      const noteOrganization = await db.metadata.get(
        own.workspaceId,
        "organization",
        `NOTE:${coordinatedNote.id}`,
      );
      const noteDeletePending = await db.outbox.list(own.workspaceId);
      const knowledgeProject = await runtime.service.create(runtime.context, {
        type: "PROJECT",
        title: "Offline bound project",
      });
      await makeCoordinator().run();
      const projectSpace = await runtime.createProjectSpace({
        projectId: knowledgeProject.id,
        title: "Project replay space",
      });
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      runtime = makeRuntime();
      const projectSpaceResult = await makeCoordinator().run();
      const projectDocument = await runtime.createProjectDocument({
        projectId: knowledgeProject.id,
        spaceId: projectSpace.spaceId,
        title: "Project replay document",
        bodyMd: "项目原文\n[[Target]]\n不可丢失",
      });
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      runtime = makeRuntime();
      const projectDocumentResult = await makeCoordinator().run();
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      runtime = makeRuntime();
      const projectDocumentBody =
        await runtime.readDocumentBody(projectDocument);
      const projectMaterials = (await runtime.loadWorkspace()).projectMaterials;
      const documentMaterial = projectMaterials.find(
        (value) => value.targetId === projectDocument.id,
      );
      if (!documentMaterial)
        throw new Error("MISSING_PROJECT_DOCUMENT_BINDING");
      await runtime.projectDelete(documentMaterial.id, 1, true);
      const projectDeleteResult = await makeCoordinator().run();
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      runtime = makeRuntime();
      const projectDeletedMaterial = await db.metadata.get(
        own.workspaceId,
        "projectMaterials",
        documentMaterial.id,
      );
      const projectDeletedDocument = await db.metadata.get(
        own.workspaceId,
        "library",
        projectDocument.id,
      );
      const projectPending = await db.outbox.list(own.workspaceId);
      const recurrenceRule = {
        title: "Offline series",
        descriptionMd: "周期原文\r\n[[Target]]",
        startDate: "2026-10-14",
        timezone: "UTC",
        frequency: "DAILY" as const,
        interval: 1,
        state: "PAUSED" as const,
      };
      const recurrence = await runtime.saveRecurrence({
        version: 0,
        deleted: false,
        rule: recurrenceRule,
      });
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      runtime = makeRuntime();
      const recurrenceResult = await makeCoordinator().run();
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      runtime = makeRuntime();
      const recurrenceSnapshot = await db.metadata.get(
        own.workspaceId,
        "workflows",
        recurrence.id,
      );
      await runtime.saveRecurrence({
        id: recurrence.id,
        version: 1,
        deleted: true,
        rule: recurrenceRule,
      });
      const recurrenceDeleteResult = await makeCoordinator().run();
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      runtime = makeRuntime();
      const recurrenceDeleted = await db.metadata.get(
        own.workspaceId,
        "workflows",
        recurrence.id,
      );
      const recurrencePending = await db.outbox.list(own.workspaceId);
      const conversionTask = await runtime.service.create(runtime.context, {
        title: "Convert offline task",
        descriptionMd: "转换原文",
      });
      await makeCoordinator().run();
      const conversion = await runtime.saveTaskRecurrence({
        task: { id: conversionTask.id, version: 1 },
        draft: { title: "Converted task", descriptionMd: "转换原文" },
        recurrence: {
          version: 0,
          deleted: false,
          rule: { ...recurrenceRule, state: "ACTIVE", startDate: "2026-10-13" },
        },
      });
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      runtime = makeRuntime();
      const conversionResult = await makeCoordinator().run();
      const conversionOccurrenceId = `occurrence:${conversion.definition.id}:2026-10-13`;
      await runtime.skipOccurrence(conversionOccurrenceId, 1);
      const skipResult = await makeCoordinator().run();
      const skippedOccurrence = await db.metadata.get(
        own.workspaceId,
        "workflows",
        conversionOccurrenceId,
      );
      const skippedTask = await db.metadata.get(
        own.workspaceId,
        "items",
        conversionTask.id,
      );
      const missedDefinition = await runtime.saveRecurrence({
        version: 0,
        deleted: false,
        rule: { ...recurrenceRule, state: "ACTIVE", startDate: "2026-10-12" },
      });
      await makeCoordinator().run();
      await runtime.generateRecurrence(
        missedDefinition.id,
        1,
        "2026-10-12",
        "2026-10-12",
      );
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      runtime = makeRuntime();
      const generatedResult = await makeCoordinator().run(),
        missedOccurrenceId = `occurrence:${missedDefinition.id}:2026-10-12`;
      const missedOccurrence = await db.metadata.get(
        own.workspaceId,
        "workflows",
        missedOccurrenceId,
      );
      await runtime.backfillOccurrence(
        missedOccurrenceId,
        1,
        "2026-10-12T12:00:00Z",
      );
      const backfillPlans = await api.planLocalCommands(
        runtime.context,
        db.metadata,
        await db.outbox.list(own.workspaceId),
      );
      const backfillPlan = backfillPlans.find(
        (plan) => plan.command?.name === "recurrence.backfill",
      );
      const backfillTaskId = backfillPlan?.mutations.find(
        (mutation) => mutation.entityType === "items",
      )?.entityId;
      if (!backfillTaskId) throw new Error("MISSING_ORIGINAL_BACKFILL_TASK");
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      runtime = makeRuntime();
      const backfillResult = await makeCoordinator().run();
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      runtime = makeRuntime();
      const backfilledOccurrence = await db.metadata.get(
        own.workspaceId,
        "workflows",
        missedOccurrenceId,
      );
      const backfilledTask = await db.metadata.get(
        own.workspaceId,
        "items",
        backfillTaskId,
      );
      const lifecyclePending = await db.outbox.list(own.workspaceId);
      const linked = await runtime.link(
        { kind: "WORK", id: conversionTask.id },
        { kind: "WORK", id: knowledgeProject.id },
        "RELATED",
      );
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      runtime = makeRuntime();
      const linkResult = await makeCoordinator().run();
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      runtime = makeRuntime();
      const linkedRecord = await db.metadata.get(
        own.workspaceId,
        "links",
        linked.id,
      );
      await runtime.unlink(linked.id, 1);
      const unlinkResult = await makeCoordinator().run();
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      runtime = makeRuntime();
      const deletedLink = await db.metadata.get(
          own.workspaceId,
          "links",
          linked.id,
        ),
        linkPending = await db.outbox.list(own.workspaceId);
      runtime = makeRuntime();
      const promotionNote = await runtime.saveNote(null, 0, {
        kind: "NOTE",
        day: null,
        title: "Original promotion",
        bodyMd: "第一行\n第二行\n[[Original]]",
      });
      await makeCoordinator().run();
      const spaceLink = await runtime.linkNoteToSpace(
        promotionNote.id,
        1,
        space.id,
      );
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      runtime = makeRuntime();
      const spaceLinkResult = await makeCoordinator().run();
      const promoted = await runtime.promoteNote(
        promotionNote.id,
        1,
        space.id,
        false,
      );
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      runtime = makeRuntime();
      const promotionResult = await makeCoordinator().run();
      db.close();
      db = await api.IndexedDbLocalStore.open("live-work-sync");
      runtime = makeRuntime();
      const promotedBody = await runtime.readDocumentBody(promoted),
        promotionPending = await db.outbox.list(own.workspaceId);
      db.close();
      blobs.close();
      return {
        taskId: task.id,
        remoteWorkspaceId: session.context.workspaceId,
        receipt,
        repeated,
        duplicateStatus: duplicateResponse.status,
        retained,
        base,
        remaining,
        sync,
        originalCursor: binding.cursor,
        snapshot,
        duplicateRejected,
        duplicateAtomic,
        pulledSync,
        pulledTask,
        pulledPending,
        deltaCursor: delta.cursor,
        coordinated,
        coordinatedPending,
        coordinatedSnapshot,
        uncertainRejected,
        uncertainPending,
        coordinatorSends: workCoordinatorSends,
        rebasedTask,
        supersededIntent,
        coordinatorSendsBeforeConflict,
        conflictPendingBefore,
        conflictPendingAfter,
        conflictResult,
        conflictLocalTask,
        conflictRemoteSnapshot,
        knowledgeProofJson: JSON.stringify({
          knowledgeRecovered,
          knowledgeRevisions,
          knowledgeRemaining,
          knowledgeReceipt,
          libraryRecovered,
          librarySource,
          librarySearch,
          libraryRemaining,
          remoteUnavailable,
          hydratedRemoteNote,
          hydratedPending,
          unhydratedWiki,
          hydratedWiki,
          hydratedRemoteDocument,
          coordinatedKnowledge,
          coordinatedKnowledgeBody,
          coordinatedKnowledgePending,
          coordinatedKnowledgeId: coordinatedKnowledgeReady.id,
          coordinatedReminderResult,
          coordinatedReminderId: reminderPlan.id,
          coordinatedReminderSnapshot,
          coordinatedReminderPending,
          reminderDoneResult,
          reminderDoneSnapshot,
          calendarResult,
          calendarCommandId: calendarPlan.id,
          calendarSnapshot,
          calendarPending,
          navigationResult,
          navigationCommandId: navigationPlan.id,
          navigationSnapshot,
          navigationPending,
          navigationMoveResult,
          navigationMoveSnapshot,
          localPrincipalId: runtime.context.principalId,
          remotePrincipalId: session.context.principalId,
          orderTaskResult,
          orderResult,
          orderCommandId: orderPlan.id,
          orderTaskId: orderTask.id,
          orderAnchorId: task.id,
          orderSnapshot,
          orderPending,
          localWorkspaceId: own.workspaceId,
          categoryAId: categoryA.id,
          categoryBId: categoryB.id,
          categoryCreateResult,
          categoryCreated,
          categoryOrderResult,
          categoryOrderCommandId: categoryOrderPlan.id,
          categoryOrdered,
          categoryPending,
          organizationResult,
          organizationSnapshot,
          organizationPending,
          organizationDeleteResult,
          organizationDeletedTask,
          organizationDeletePending,
          noteMoveResult,
          noteDeleteResult,
          organizedNote,
          noteOrganization,
          noteDeletePending,
          projectSpace,
          projectSpaceResult,
          projectDocumentResult,
          projectDocumentBody,
          projectMaterials,
          projectDeleteResult,
          projectDeletedMaterial,
          projectDeletedDocument,
          projectPending,
          recurrence,
          recurrenceResult,
          recurrenceSnapshot,
          recurrenceDeleteResult,
          recurrenceDeleted,
          recurrencePending,
          conversion,
          conversionResult,
          skipResult,
          skippedOccurrence,
          skippedTask,
          generatedResult,
          missedOccurrence,
          backfillResult,
          backfilledOccurrence,
          backfilledTask,
          backfillTaskId,
          lifecyclePending,
          linked,
          linkResult,
          linkedRecord,
          unlinkResult,
          deletedLink,
          linkPending,
          promotionNote,
          spaceLink,
          spaceLinkResult,
          promoted,
          promotionResult,
          promotedBody,
          promotionPending,
        }),
      };
    });
    expect(result.receipt.result).toMatchObject({
      id: result.taskId,
      workspaceId: result.remoteWorkspaceId,
      title: "Offline source",
      descriptionMd: "原文\n第二行",
      version: 1,
    });
    expect(result.repeated).toEqual(result.receipt);
    const knowledgeProof = JSON.parse(result.knowledgeProofJson);
    expect(knowledgeProof.linkResult.accepted).toHaveLength(1);
    expect(knowledgeProof.linkResult.unresolved).toEqual([]);
    expect(knowledgeProof.linkedRecord).toMatchObject({
      version: 1,
      value: {
        id: knowledgeProof.linked.id,
        workspaceId: knowledgeProof.localWorkspaceId,
        from: knowledgeProof.linked.from,
        to: knowledgeProof.linked.to,
        relation: "RELATED",
      },
    });
    expect(knowledgeProof.unlinkResult.accepted).toHaveLength(1);
    expect(knowledgeProof.spaceLinkResult.accepted).toHaveLength(1);
    expect(knowledgeProof.spaceLinkResult.unresolved).toEqual([]);
    expect(knowledgeProof.promotionResult.accepted).toHaveLength(1);
    expect(knowledgeProof.promotionResult.unresolved).toEqual([]);
    expect(knowledgeProof.promotedBody).toMatchObject({
      id: knowledgeProof.promoted.id,
      title: knowledgeProof.promotionNote.title,
      bodyMd: knowledgeProof.promotionNote.bodyMd,
      version: 1,
    });
    expect(knowledgeProof.promotionPending).toEqual(knowledgeProof.linkPending);
    expect(knowledgeProof.deletedLink).toMatchObject({
      version: 2,
      value: { id: knowledgeProof.linked.id, deletedAt: expect.any(String) },
    });
    expect(knowledgeProof.linkPending).toEqual(knowledgeProof.lifecyclePending);
    expect(knowledgeProof.conversionResult.unresolved).toEqual([]);
    expect(knowledgeProof.conversionResult.accepted).toHaveLength(1);
    expect(knowledgeProof.skipResult.accepted).toHaveLength(1);
    expect(knowledgeProof.skippedOccurrence).toMatchObject({
      version: 2,
      value: { payload: { status: "SKIPPED" } },
    });
    expect(knowledgeProof.skippedTask).toMatchObject({
      version: 3,
      value: { status: "CANCELED", descriptionMd: "转换原文" },
    });
    expect(knowledgeProof.generatedResult.accepted).toHaveLength(1);
    expect(knowledgeProof.missedOccurrence).toMatchObject({
      version: 1,
      value: { payload: { status: "MISSED", taskId: null } },
    });
    expect(knowledgeProof.backfillResult.accepted).toHaveLength(1);
    expect(knowledgeProof.backfillResult.unresolved).toEqual([]);
    expect(knowledgeProof.backfilledOccurrence).toMatchObject({
      version: 2,
      value: {
        payload: {
          status: "BACKFILLED",
          taskId: knowledgeProof.backfillTaskId,
          completedAt: "2026-10-12T12:00:00Z",
        },
      },
    });
    expect(knowledgeProof.backfilledTask).toMatchObject({
      version: 2,
      value: {
        id: knowledgeProof.backfillTaskId,
        status: "DONE",
        descriptionMd: "周期原文\r\n[[Target]]",
      },
    });
    expect(knowledgeProof.lifecyclePending).toEqual(
      knowledgeProof.recurrencePending,
    );
    expect(knowledgeProof.recurrenceResult.accepted).toHaveLength(1);
    expect(knowledgeProof.recurrenceResult.unresolved).toEqual([]);
    expect(knowledgeProof.recurrenceSnapshot).toMatchObject({
      version: 1,
      value: {
        id: knowledgeProof.recurrence.id,
        workspaceId: knowledgeProof.localWorkspaceId,
        payload: {
          title: "Offline series",
          descriptionMd: "周期原文\r\n[[Target]]",
          state: "PAUSED",
        },
      },
    });
    expect(knowledgeProof.recurrenceDeleteResult.accepted).toHaveLength(1);
    expect(knowledgeProof.recurrenceDeleted).toMatchObject({
      version: 2,
      value: {
        id: knowledgeProof.recurrence.id,
        deletedAt: expect.any(String),
      },
    });
    expect(knowledgeProof.recurrencePending).toEqual(
      knowledgeProof.projectPending,
    );
    expect(knowledgeProof.projectSpaceResult.accepted).toHaveLength(1);
    expect(knowledgeProof.projectDocumentResult.accepted).toHaveLength(1);
    expect(knowledgeProof.projectDocumentBody.bodyMd).toBe(
      "项目原文\n[[Target]]\n不可丢失",
    );
    expect(knowledgeProof.projectMaterials).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: knowledgeProof.projectSpace.id,
          targetId: knowledgeProof.projectSpace.spaceId,
          workspaceId: knowledgeProof.localWorkspaceId,
          ownership: "OWNED",
          version: 1,
        }),
      ]),
    );
    expect(knowledgeProof.projectDeleteResult.accepted).toHaveLength(1);
    expect(knowledgeProof.projectDeletedMaterial).toMatchObject({
      version: 2,
      value: { deletedAt: expect.any(String) },
    });
    expect(knowledgeProof.projectDeletedDocument).toMatchObject({
      version: 2,
      value: { deletedAt: expect.any(String) },
    });
    expect(knowledgeProof.projectPending).toEqual(
      knowledgeProof.noteDeletePending,
    );
    expect(knowledgeProof.noteMoveResult.accepted).toHaveLength(1);
    expect(knowledgeProof.noteDeleteResult.accepted).toHaveLength(1);
    expect(knowledgeProof.organizedNote).toMatchObject({
      version: 2,
      value: { deletedAt: expect.any(String) },
    });
    expect(knowledgeProof.noteOrganization).toMatchObject({
      version: 1,
      value: {
        kind: "NOTE",
        folder: "Replay folder",
        workspaceId: knowledgeProof.localWorkspaceId,
      },
    });
    expect(knowledgeProof.noteDeletePending).toEqual(
      knowledgeProof.organizationDeletePending,
    );
    expect(knowledgeProof.organizationDeleteResult.accepted).toHaveLength(1);
    expect(knowledgeProof.organizationDeletedTask).toMatchObject({
      id: knowledgeProof.orderTaskId,
      version: 2,
      deletedAt: expect.any(String),
    });
    expect(knowledgeProof.organizationDeletePending).toEqual(
      knowledgeProof.organizationPending,
    );
    expect(knowledgeProof.categoryCreateResult.accepted).toHaveLength(2);
    expect(knowledgeProof.categoryCreated).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: knowledgeProof.categoryAId,
          version: 1,
          name: "Replay category A",
        }),
        expect.objectContaining({
          id: knowledgeProof.categoryBId,
          version: 1,
          name: "Replay category B",
        }),
      ]),
    );
    expect(knowledgeProof.categoryOrderResult.accepted).toContain(
      knowledgeProof.categoryOrderCommandId,
    );
    expect(knowledgeProof.categoryOrdered).toEqual([
      expect.objectContaining({
        id: knowledgeProof.categoryBId,
        version: 2,
        position: 1024,
      }),
      expect.objectContaining({
        id: knowledgeProof.categoryAId,
        version: 2,
        position: 2048,
      }),
    ]);
    expect(knowledgeProof.categoryPending).toEqual(knowledgeProof.orderPending);
    expect(knowledgeProof.organizationResult.accepted).toHaveLength(1);
    expect(knowledgeProof.organizationSnapshot).toEqual([
      expect.objectContaining({
        kind: "WORK",
        id: knowledgeProof.orderTaskId,
        workspaceId: knowledgeProof.localWorkspaceId,
        version: 1,
        archived: true,
      }),
    ]);
    expect(knowledgeProof.organizationPending).toEqual(
      knowledgeProof.categoryPending,
    );
    expect(knowledgeProof.orderTaskResult.accepted).toHaveLength(1);
    expect(knowledgeProof.orderResult.accepted).toEqual([
      knowledgeProof.orderCommandId,
    ]);
    expect(knowledgeProof.orderSnapshot).toMatchObject({
      workspaceId: knowledgeProof.localWorkspaceId,
      version: 1,
      scope: { kind: "WORKSPACE_TASKS" },
    });
    expect(
      knowledgeProof.orderSnapshot.entries.every(
        (entry: { workspaceId: string }) =>
          entry.workspaceId === knowledgeProof.localWorkspaceId,
      ),
    ).toBe(true);
    const orderedIds = knowledgeProof.orderSnapshot.entries.map(
      (entry: { entityId: string }) => entry.entityId,
    );
    expect(orderedIds.indexOf(knowledgeProof.orderTaskId)).toBeLessThan(
      orderedIds.indexOf(knowledgeProof.orderAnchorId),
    );
    expect(knowledgeProof.orderPending).toEqual(
      knowledgeProof.coordinatedKnowledgePending,
    );
    expect(knowledgeProof.localPrincipalId).not.toBe(
      knowledgeProof.remotePrincipalId,
    );
    expect(knowledgeProof.navigationResult.accepted).toEqual([
      knowledgeProof.navigationCommandId,
    ]);
    expect(knowledgeProof.navigationSnapshot).toMatchObject({
      version: 1,
      desktop: { hidden: ["journal"] },
    });
    expect(knowledgeProof.navigationPending).toEqual(
      knowledgeProof.coordinatedKnowledgePending,
    );
    expect(knowledgeProof.navigationMoveResult.accepted).toHaveLength(1);
    expect(knowledgeProof.navigationMoveSnapshot.version).toBe(2);
    expect(
      knowledgeProof.navigationMoveSnapshot.desktop.order.indexOf("focus"),
    ).toBeLessThan(
      knowledgeProof.navigationMoveSnapshot.desktop.order.indexOf("tasks"),
    );
    expect(knowledgeProof.coordinatedReminderResult.accepted).toEqual([
      knowledgeProof.coordinatedReminderId,
    ]);
    expect(knowledgeProof.coordinatedReminderSnapshot).toMatchObject({
      title: "Coordinated reminder",
      bodyMd: "提醒原文\n离线保留",
      state: "ACTIVE",
      version: 1,
      notifyMode: "MINUTES_BEFORE",
      notifyOffsetMinutes: 15,
    });
    expect(knowledgeProof.coordinatedReminderPending).toEqual(
      knowledgeProof.coordinatedKnowledgePending,
    );
    expect(knowledgeProof.reminderDoneResult.accepted).toHaveLength(1);
    expect(knowledgeProof.reminderDoneSnapshot).toMatchObject({
      title: "Coordinated reminder",
      state: "DONE",
      version: 2,
    });
    expect(knowledgeProof.calendarResult.accepted).toEqual([
      knowledgeProof.calendarCommandId,
    ]);
    expect(knowledgeProof.calendarSnapshot).toEqual({
      version: 1,
      timezone: "Asia/Shanghai",
    });
    expect(knowledgeProof.calendarPending).toEqual(
      knowledgeProof.coordinatedKnowledgePending,
    );
    expect(knowledgeProof.remoteUnavailable).toBe(true);
    expect(knowledgeProof.coordinatedKnowledge.accepted).toEqual([
      knowledgeProof.coordinatedKnowledgeId,
    ]);
    expect(knowledgeProof.coordinatedKnowledgeBody).toMatchObject({
      bodyMd: "协调器原文\n不重建命令",
      version: 1,
    });
    expect(knowledgeProof.coordinatedKnowledgePending).toEqual(
      knowledgeProof.libraryRemaining,
    );
    expect(knowledgeProof.unhydratedWiki).toEqual([
      expect.objectContaining({ targetText: "Remote Target" }),
    ]);
    expect(knowledgeProof.hydratedWiki).toEqual([
      expect.objectContaining({ targetText: "Remote Target" }),
    ]);
    expect(knowledgeProof.hydratedRemoteDocument).toMatchObject({
      bodyMd: "远端知识\n[[Remote Target]]",
      version: 1,
    });
    expect(knowledgeProof.hydratedRemoteNote).toMatchObject({
      bodyMd: "远端正文\n不能变空",
      version: 1,
    });
    expect(knowledgeProof.hydratedPending).toEqual(
      knowledgeProof.libraryRemaining,
    );
    expect(knowledgeProof.knowledgeRecovered).toMatchObject({
      title: "Offline note",
      bodyMd: "知识原文\n第二行",
      version: 1,
    });
    expect(knowledgeProof.knowledgeRevisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ bodyMd: "知识原文\n第二行" }),
      ]),
    );
    expect(knowledgeProof.knowledgeRemaining).toHaveLength(1);
    expect(knowledgeProof.libraryRecovered).toMatchObject({
      title: "Offline document",
      bodyMd: "Original document\n[[Target]]",
      version: 1,
    });
    expect(knowledgeProof.librarySource.value).toMatchObject({
      parserVersion: 1,
      sourceVersion: 1,
      links: [expect.objectContaining({ targetText: "Target" })],
    });
    expect(knowledgeProof.librarySearch.value.text).toContain(
      "original document",
    );
    expect(knowledgeProof.libraryRemaining).toHaveLength(1);
    expect(knowledgeProof.knowledgeRemaining[0]).toMatchObject({
      state: "CONFLICT",
      entityId: result.taskId,
    });
    expect(result.duplicateStatus).toBe(200);
    expect(result.snapshot.items).toHaveLength(1);
    expect(result.retained).toMatchObject({
      version: 2,
      value: { title: "Later local edit", descriptionMd: "本地后续\n不能覆盖" },
    });
    expect(result.base).toMatchObject({
      value: {
        remoteWorkspaceId: result.remoteWorkspaceId,
        version: 1,
        value: { title: "Offline source", descriptionMd: "原文\n第二行" },
      },
    });
    expect(result.remaining).toHaveLength(1);
    const retainedMutation = result.remaining[0];
    if (!retainedMutation) throw new Error("MISSING_RETAINED_MUTATION");
    expect(result.remaining[0]).toMatchObject({
      state: "PENDING",
      entityId: result.taskId,
      baseVersion: 1,
      attemptCount: 0,
    });
    expect(result.sync).toMatchObject({
      version: 2,
      cursor: result.originalCursor,
    });
    expect(result.duplicateRejected).toBe(true);
    expect(result.duplicateAtomic).toBe(true);
    expect(result.pulledSync).toMatchObject({
      version: 3,
      cursor: result.deltaCursor,
    });
    expect(result.deltaCursor).toBeGreaterThan(result.originalCursor);
    expect(result.pulledTask).toEqual(result.retained);
    expect(result.pulledPending).toEqual(result.remaining);
    expect(result.coordinated).toMatchObject({
      accepted: [retainedMutation.id],
      conflicted: [],
      unresolved: [],
    });
    expect(result.coordinated.cursor).toBeGreaterThan(result.deltaCursor);
    expect(result.coordinatedPending).toEqual([]);
    expect(result.uncertainRejected).toBe(true);
    expect(result.uncertainPending).toHaveLength(1);
    expect(result.uncertainPending[0]).toMatchObject({
      id: retainedMutation.id,
      state: "SENDING",
      attemptCount: 1,
    });
    expect(result.coordinatorSendsBeforeConflict).toBe(1);
    expect(result.coordinatorSends).toBe(2);
    expect(result.rebasedTask).toMatchObject({
      version: 3,
      value: { title: "Canonical remote title", priority: "HIGH" },
    });
    expect(result.supersededIntent).toMatchObject({
      value: {
        reason: "CLEAN_REBASE",
        original: { attemptCount: 0, state: "PENDING" },
      },
    });
    expect(result.coordinatedSnapshot.items).toHaveLength(1);
    expect(result.coordinatedSnapshot.items[0]).toMatchObject({
      id: result.taskId,
      version: 2,
      title: "Later local edit",
      descriptionMd: "本地后续\n不能覆盖",
    });
    expect(result.conflictPendingBefore).toHaveLength(1);
    const conflictingMutation = result.conflictPendingBefore[0];
    if (!conflictingMutation) throw new Error("MISSING_CONFLICTING_MUTATION");
    expect(result.conflictResult).toMatchObject({
      accepted: [],
      conflicted: [conflictingMutation.id],
      unresolved: [],
    });
    expect(result.conflictPendingAfter).toHaveLength(1);
    expect(result.conflictPendingAfter[0]).toMatchObject({
      id: conflictingMutation.id,
      baseVersion: 2,
      state: "CONFLICT",
      attemptCount: 1,
      payload: conflictingMutation.payload,
    });
    expect(result.conflictLocalTask?.value).toMatchObject({
      title: "Unsent conflicting title",
      version: 3,
    });
    expect(result.conflictRemoteSnapshot.items[0]).toMatchObject({
      title: "Remote conflicting title",
      version: 3,
    });
  } finally {
    await host.close();
  }
});
