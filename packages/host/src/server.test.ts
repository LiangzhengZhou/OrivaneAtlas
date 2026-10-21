import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  apiScopes,
  canonicalEntityMemoId,
  continueWorkspaceImport,
  createWorkspaceImportJournal,
  type FileParser,
  LocalRuntime,
  LocalWorkSyncCoordinator,
  type LocalWorkSyncPorts,
  LocalWorkspace,
  listLocalWorkConflictReviews,
  localDto,
  type ModelPort,
  materializeWorkspaceMemoCopies,
  type PersonalModelVault,
  planLocalCommands,
  planWorkspaceImportSteps,
  planWorkspaceMergeSelection,
  prepareLocalKnowledgeHydration,
  prepareLocalPendingWorkRebase,
  providerFailure,
  readWorkspacePrivateMemoReview,
  syncVerifiedLocalFileBinary,
  WorkflowService,
} from "@arclattice/application";
import { DomainError } from "@arclattice/domain";
import {
  currentSchemaVersion,
  restoreDatabase,
} from "@arclattice/storage-sqlite";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveEntityMemoId } from "../../storage-local/src/entity-memo-identity";
import { IndexedDbLocalStore } from "../../storage-local/src/indexed-db";
import { IndexedDbWorkspaceImports } from "../../storage-local/src/workspace-import";
import { actualFileParserFixture } from "../test-fixtures/file-parser";
import { granularRouteGrants } from "./api-authorization";
import { passwordHash } from "./password";
import { openPersonalVault } from "./personal-model";
import { createHost } from "./server";

let directory: string,
  secret: string,
  host: Awaited<ReturnType<typeof createHost>>,
  base: string,
  cookie: string,
  csrf: string;
async function latestConversation() {
  const summaries = await (await call("/api/ai/sessions")).json();
  expect(summaries[0]).not.toHaveProperty("messages");
  return (
    await (
      await call(
        "/api/ai/sessions/messages?id=" + encodeURIComponent(summaries[0].id),
      )
    ).json()
  ).session;
}
const ownerPassword = "Test-only-password-123";

it.each(["work", "note", "library"])(
  "permanent %s response-loss recovery ACKs once after real IndexedDB restart",
  async (family) => {
    await login();
    const original =
      family === "work"
        ? await create("Restart purge")
        : family === "note"
          ? await note("Keep exact purge source\r\n")
          : await (
              await call("/api/library/save", {
                id: null,
                version: 0,
                input: {
                  kind: "SPACE",
                  spaceId: null,
                  title: "Restart purge space",
                  bodyMd: "Private space source",
                },
              })
            ).json();
    if (family === "work")
      expect(
        (
          await call("/api/memo/save", {
            version: 0,
            deleted: false,
            input: {
              targetKind: "TASK",
              targetId: original.id,
              bodyMd: "Owner-only purge memo",
            },
          })
        ).status,
      ).toBe(200);
    const removed = await call(`/api/${family}/delete`, {
      id: original.id,
      version: original.version,
      deleted: true,
    });
    expect(removed.status).toBe(200);
    const canonical = await removed.json();
    const manifest = await (await call("/api/bootstrap")).json();
    const factory = new IDBFactory();
    const own = {
      schemaVersion: 1 as const,
      workspaceId: randomUUID(),
      principalId: randomUUID(),
      deviceId: randomUUID(),
    };
    let store = await IndexedDbLocalStore.open("purge-restart", factory);
    await store.identity.ensure(own);
    await store.syncState.bindEmpty!({
      workspaceId: own.workspaceId,
      remoteWorkspaceId: canonical.workspaceId,
      remotePrincipalId: canonical.createdBy,
      serverOrigin: base,
      epoch: manifest.epoch,
      cursor: 0,
      version: 1,
    });
    const clock = { now: () => new Date().toISOString() },
      ids = { next: randomUUID },
      wiki = { extract: () => [], resolve: () => [] };
    const memoIdentity = {
      forTarget: deriveEntityMemoId,
      nextChangeId: randomUUID,
    };
    const runtime = () =>
      new LocalRuntime(
        new LocalWorkspace(
          store.metadata,
          { get: async () => null, put: async () => {} },
          own,
          wiki,
          clock,
          ids,
        ),
        memoIdentity,
      );
    let lose = false,
      sent = 0;
    const transport: LocalWorkSyncPorts["transport"] = {
      pull: async (scope) =>
        (
          await call(
            `/api/v1/sync?after=${scope.cursor}&epoch=${scope.epoch}&bodyMode=metadata&relationMode=canonical&privateMemos=include`,
          )
        ).json(),
      pullPrivateMemos: async (scope, after) =>
        (
          await call(
            `/api/v1/sync?after=${after}&epoch=${scope.epoch}&bodyMode=metadata&privateMemos=only`,
          )
        ).json(),
      lookup: async (_scope, commandId, deviceId) => {
        const res = await call(
          `/api/v1/sync/receipt?commandId=${commandId}&deviceId=${deviceId}`,
        );
        if (res.status === 404) return null;
        expect(res.status).toBe(200);
        return res.json();
      },
      send: async (_scope, request) => {
        sent++;
        const res = await call(request.path, request.body, {
          "Idempotency-Key": request.idempotencyKey,
        });
        const result = await res.json();
        expect(res.status, JSON.stringify(result)).toBe(200);
        if (lose) {
          lose = false;
          throw new Error("PURGE_RESPONSE_LOST");
        }
        return result;
      },
    };
    const coordinator = () =>
      new LocalWorkSyncCoordinator(runtime().context, {
        metadata: store.metadata,
        outbox: store.outbox,
        syncState: store.syncState,
        replica: store.replica,
        memoIdentity,
        knowledgeWiki: wiki,
        transport,
        clock,
      });
    try {
      await coordinator().run();
      const r = runtime();
      if (family !== "work") {
        const binding = (await store.syncState.get(own.workspaceId))!;
        const hydration = await prepareLocalKnowledgeHydration(
          r.context,
          binding,
          family === "note" ? "notes" : "library",
          canonical.id,
          canonical.version,
          canonical,
          [],
          store.metadata,
          wiki,
        );
        await store.replica.commit(hydration);
      }
      if (family === "work")
        await r.service.purge(r.context, canonical.id, canonical.version);
      else if (family === "note")
        await r.purgeNote(canonical.id, canonical.version);
      else await r.purgeLibrary(canonical.id, canonical.version);
      lose = true;
      await expect(coordinator().run()).rejects.toThrow("PURGE_RESPONSE_LOST");
      const pending = await store.outbox.list(own.workspaceId);
      expect(pending.length).toBeGreaterThan(0);
      expect(pending.every((m) => m.state === "SENDING")).toBe(true);
      store.close();
      store = await IndexedDbLocalStore.open("purge-restart", factory);
      const recovered = await coordinator().run();
      expect(recovered.accepted).toHaveLength(1);
      expect(await store.outbox.list(own.workspaceId)).toHaveLength(0);
      expect(sent).toBe(1);
      const collection =
        family === "work" ? "items" : family === "note" ? "notes" : "library";
      expect(
        (await runtime().loadWorkspace())[collection].some(
          (row) => row.id === canonical.id,
        ),
      ).toBe(false);
      expect(
        (await (await call("/api/snapshot")).json())[collection].some(
          (row: { id: string }) => row.id === canonical.id,
        ),
      ).toBe(false);
      if (family === "work") {
        const localMemoId = await deriveEntityMemoId(runtime().context, {
          targetKind: "TASK",
          targetId: canonical.id,
        });
        expect(
          await store.metadata.get(own.workspaceId, "entityMemos", localMemoId),
        ).toMatchObject({ value: { localTombstone: true } });
      }
    } finally {
      store.close();
    }
  },
);

it.each(["work", "note", "library"])(
  "permanent %s replay guards complete effects and recovers exact scoped receipts",
  async (family) => {
    await login();
    let target: { id: string; version: number };
    const effects: {
      collection: string;
      id: string;
      op: string;
      baseVersion: number;
    }[] = [];
    if (family === "work") {
      target = await create("Purge root");
      const peer = await note("Retained reference");
      const edge = await (
        await call("/api/link/create", {
          from: { kind: "WORK", id: target.id },
          to: { kind: "NOTE", id: peer.id },
          relation: "REFERENCES",
        })
      ).json();
      effects.push({
        collection: "links",
        id: edge.id,
        op: "DELETE",
        baseVersion: 1,
      });
      expect(
        (
          await call("/api/organize", {
            kind: "WORK",
            action: "archive",
            entries: [{ id: target.id, version: 1, organizationVersion: 0 }],
          })
        ).status,
      ).toBe(200);
      effects.push({
        collection: "organization",
        id: "WORK:" + target.id,
        op: "DELETE",
        baseVersion: 1,
      });
      const memo = await (
        await call("/api/memo/save", {
          version: 0,
          deleted: false,
          input: {
            targetKind: "TASK",
            targetId: target.id,
            bodyMd: "Private purge original",
          },
        })
      ).json();
      effects.push({
        collection: "entityMemos",
        id: memo.id,
        op: "DELETE",
        baseVersion: 1,
      });
    } else if (family === "note") target = await note("Exact purge source\r\n");
    else
      target = await (
        await call("/api/library/save", {
          id: null,
          version: 0,
          input: {
            kind: "SPACE",
            spaceId: null,
            title: "Purge space",
            bodyMd: "Exact Space",
          },
        })
      ).json();
    if (family === "work") {
      const current = await (await call("/api/snapshot")).json();
      target = current.items.find(
        (row: { id: string }) => row.id === target.id,
      );
    }
    const deleted = await call(`/api/${family}/delete`, {
      id: target.id,
      version: target.version,
      deleted: true,
    });
    expect(deleted.status).toBe(200);
    target = await deleted.json();
    const collection =
      family === "work" ? "items" : family === "note" ? "notes" : "library";
    effects.push({
      collection,
      id: target.id,
      op: "DELETE",
      baseVersion: target.version,
    });
    for (const bad of [
      effects.map((e) => ({ ...e, baseVersion: e.baseVersion + 1 })),
      [
        ...effects,
        { collection: "items", id: randomUUID(), op: "DELETE", baseVersion: 1 },
      ],
      ...(effects.length > 1 ? [effects.slice(1)] : []),
    ]) {
      const commandId = randomUUID();
      expect(
        (
          await call(
            `/api/v1/${family}/purge`,
            {
              id: target.id,
              version: target.version,
              syncCommand: { commandId, deviceId: randomUUID(), effects: bad },
            },
            { "Idempotency-Key": commandId },
          )
        ).status,
      ).toBe(409);
      const snapshot = await (await call("/api/snapshot")).json();
      expect(
        snapshot[collection].some(
          (row: { id: string }) => row.id === target.id,
        ),
      ).toBe(true);
    }
    const commandId = randomUUID(),
      deviceId = randomUUID();
    const body = {
      id: target.id,
      version: target.version,
      syncCommand: { commandId, deviceId, effects },
    };
    expect(
      (
        await call(`/api/v1/${family}/purge`, body, {
          "Idempotency-Key": commandId,
          "X-CSRF-Token": "wrong",
        })
      ).status,
    ).toBe(403);
    const response = await call(`/api/v1/${family}/purge`, body, {
      "Idempotency-Key": commandId,
    });
    expect(response.status).toBe(200);
    const receipt = await response.json();
    expect(receipt).toMatchObject({
      commandId,
      deviceId,
      result: { purged: true },
    });
    expect(receipt.effects).toHaveLength(effects.length);
    expect(
      receipt.effects.every((e: { value: unknown }) => e.value === null),
    ).toBe(true);
    expect(JSON.stringify(receipt)).not.toContain("Private purge original");
    expect(
      await (
        await call(`/api/v1/${family}/purge`, body, {
          "Idempotency-Key": commandId,
        })
      ).json(),
    ).toEqual(receipt);
    expect(
      await (
        await call(
          `/api/v1/sync/receipt?commandId=${commandId}&deviceId=${deviceId}`,
        )
      ).json(),
    ).toEqual(receipt);
    expect(
      (
        await call(
          `/api/v1/sync/receipt?commandId=${commandId}&deviceId=${randomUUID()}`,
        )
      ).status,
    ).toBe(404);
    expect(
      (await (await call("/api/snapshot")).json())[collection].some(
        (row: { id: string }) => row.id === target.id,
      ),
    ).toBe(false);
    if (family === "work") {
      const hash = await passwordHash(ownerPassword);
      await host.db.accounts((store) => {
        const other = store.register("other-purge", hash, false);
        store.status(other.id, other.version, "ACTIVE");
      });
      const loginResponse = await call(
        "/api/session",
        { username: "other-purge", password: ownerPassword },
        { Cookie: "" },
      );
      expect(loginResponse.status).toBe(200);
      const otherCookie = loginResponse.headers
        .get("set-cookie")!
        .split(";")[0]!;
      const otherIdentity = await loginResponse.json();
      expect(
        (
          await call(
            `/api/v1/sync/receipt?commandId=${commandId}&deviceId=${deviceId}`,
            undefined,
            { Cookie: otherCookie },
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await call("/api/v1/work/purge", body, {
            Cookie: otherCookie,
            "X-CSRF-Token": otherIdentity.csrf,
            "Idempotency-Key": commandId,
          })
        ).status,
      ).toBe(409);
    }
  },
);

it("empty Memo import requires reviewed replay and never overrides an existing destination", async () => {
  await login();
  const task = await create("Empty Memo import"),
    input = { targetKind: "TASK" as const, targetId: task.id, bodyMd: "  \n" };
  const id = await deriveEntityMemoId(
    { workspaceId: task.workspaceId, principalId: task.createdBy },
    input,
  );
  const ordinary = await call("/api/memo/save", {
    version: 0,
    input,
    deleted: false,
  });
  expect(ordinary.status).toBe(200);
  expect(await ordinary.json()).toBeNull();
  const request = () => {
    const commandId = randomUUID();
    return {
      version: 0,
      input,
      deleted: false,
      syncCommand: {
        commandId,
        deviceId: randomUUID(),
        effects: [
          { collection: "entityMemos", id, op: "UPSERT", baseVersion: 0 },
        ],
      },
    };
  };
  const unreviewed = request();
  expect(
    (
      await call("/api/memo/save", unreviewed, {
        "Idempotency-Key": unreviewed.syncCommand.commandId,
      })
    ).status,
  ).toBe(409);
  const manifest = await (await call("/api/bootstrap")).json();
  const copy = request();
  const response = await call("/api/memo/save", copy, {
    "Idempotency-Key": copy.syncCommand.commandId,
    "X-Workspace-Precondition": JSON.stringify({
      epoch: manifest.epoch,
      cursor: manifest.cursor,
    }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    result: { result: { id, bodyMd: input.bodyMd, version: 1 } },
  });
  const fresh = await (await call("/api/bootstrap")).json(),
    duplicate = request();
  expect(
    (
      await call("/api/memo/save", duplicate, {
        "Idempotency-Key": duplicate.syncCommand.commandId,
        "X-Workspace-Precondition": JSON.stringify({
          epoch: fresh.epoch,
          cursor: fresh.cursor,
        }),
      })
    ).status,
  ).toBe(409);
  expect(
    await (await call(`/api/memo?targetKind=TASK&targetId=${task.id}`)).json(),
  ).toMatchObject({ bodyMd: input.bodyMd, version: 1 });
});

it.each(["  Private original\n[[literal source]]\n", "  \n"])(
  "reviewed Memo import writes owner-mapped commands with workspace preconditions and private journal evidence (%j)",
  async (originalBody) => {
    await login();
    const baseline = await create("Memo import seed"),
      actor = { workspaceId: randomUUID(), principalId: randomUUID() },
      remoteActor = {
        workspaceId: baseline.workspaceId,
        principalId: baseline.createdBy,
      };
    const target = { targetKind: "TASK" as const, targetId: baseline.id },
      memo = {
        ...target,
        id: await deriveEntityMemoId(actor, target),
        workspaceId: actor.workspaceId,
        ownerPrincipalId: actor.principalId,
        bodyMd: originalBody,
        version: 2,
        createdAt: "2026-10-18T00:00:00Z",
        updatedAt: "2026-10-18T00:00:00Z",
        createdBy: actor.principalId,
        updatedBy: actor.principalId,
        deletedAt: null,
      };
    const source = {
      workspaceId: actor.workspaceId,
      revision: 2,
      records: [
        {
          workspaceId: actor.workspaceId,
          collection: "items",
          id: baseline.id,
          version: baseline.version,
          value: localDto({
            ...baseline,
            workspaceId: actor.workspaceId,
            createdBy: actor.principalId,
            updatedBy: actor.principalId,
          }),
        },
        {
          workspaceId: actor.workspaceId,
          collection: "entityMemos",
          id: memo.id,
          version: 2,
          value: localDto(memo),
        },
      ],
    };
    let head = await (await call("/api/bootstrap")).json();
    const plan = planWorkspaceMergeSelection(
      actor,
      source,
      {
        workspaceId: remoteActor.workspaceId,
        revision: head.cursor,
        records: [],
      },
      source.records.map((row) => ({
        collection: row.collection,
        sourceId: row.id,
        action: "COPY" as const,
      })),
      { next: randomUUID },
    );
    const materialized = await materializeWorkspaceMemoCopies(
      source,
      plan,
      remoteActor,
      { forTarget: deriveEntityMemoId },
    );
    const steps = planWorkspaceImportSteps(
      materialized.copies,
      {
        sourcePrincipalId: actor.principalId,
        targetPrincipalId: remoteActor.principalId,
        deviceId: randomUUID(),
      },
      { next: randomUUID },
    );
    for (const step of steps) {
      const response = await call(step.path, step.payload, {
        "Idempotency-Key": step.id,
        "X-Workspace-Precondition": JSON.stringify({
          epoch: head.epoch,
          cursor: head.cursor,
        }),
      });
      const reply = await response.json();
      expect(response.status, JSON.stringify(reply)).toBe(200);
      head = reply.workspaceRevision;
    }
    const manifest = await (await call("/api/bootstrap")).json();
    const rows = await readWorkspacePrivateMemoReview(
      remoteActor,
      manifest,
      async (after) => {
        const response = await call(
          `/api/v1/sync?after=${after}&epoch=${encodeURIComponent(manifest.epoch)}&privateMemos=only`,
        );
        expect(response.status).toBe(200);
        return response.json();
      },
      { forTarget: deriveEntityMemoId },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.value).toMatchObject({
      bodyMd: memo.bodyMd,
      ownerPrincipalId: remoteActor.principalId,
      targetId: materialized.copies.find((copy) => copy.collection === "items")!
        .targetId,
      version: 1,
    });
    expect(rows[0]!.id).not.toBe(memo.id);
    expect(manifest).not.toHaveProperty("entityMemos");
  },
);

it.each(["LOCAL", "REMOTE"] as const)(
  "private Memo sync converges two local installations through real Host CAS and recovers a lost response after restart (sequential %s)",
  async (sequentialChoice) => {
    await login();
    const task = await create("Memo two-install target");
    const target = { targetKind: "TASK" as const, targetId: task.id as string };
    const clock = { now: () => "2026-10-16T04:00:00Z" },
      ids = { next: () => randomUUID() };
    const memoIdentity = {
      forTarget: deriveEntityMemoId,
      nextChangeId: ids.next,
    };
    const devices = await Promise.all(
      [0, 1].map(async (index) => {
        const factory = new IDBFactory(),
          own = {
            schemaVersion: 1 as const,
            workspaceId: randomUUID(),
            principalId: randomUUID(),
            deviceId: randomUUID(),
          };
        let store = await IndexedDbLocalStore.open(
          "memo-host-" + index,
          factory,
        );
        await store.identity.ensure(own);
        await store.syncState.save(
          {
            workspaceId: own.workspaceId,
            remoteWorkspaceId: task.workspaceId,
            remotePrincipalId: task.createdBy,
            serverOrigin: base,
            epoch: (await (await call("/api/bootstrap")).json()).epoch,
            cursor: 0,
            version: 1,
          },
          null,
        );
        const runtime = () =>
          new LocalRuntime(
            new LocalWorkspace(
              store.metadata,
              {
                get: async () => null,
                put: async () => {
                  throw new Error("UNEXPECTED_BINARY_WRITE");
                },
              },
              own,
              { extract: () => [], resolve: () => [] },
              clock,
              ids,
            ),
            memoIdentity,
          );
        let loseResponse = false,
          sent = 0;
        const transport: LocalWorkSyncPorts["transport"] = {
          pull: async (scope) => {
            const response = await call(
              `/api/v1/sync?after=${scope.cursor}&epoch=${encodeURIComponent(scope.epoch!)}&bodyMode=metadata&privateMemos=include`,
            );
            expect(response.status).toBe(200);
            return response.json();
          },
          pullPrivateMemos: async (scope, after) => {
            const response = await call(
              `/api/v1/sync?after=${after}&epoch=${encodeURIComponent(scope.epoch!)}&bodyMode=metadata&privateMemos=only`,
            );
            expect(response.status).toBe(200);
            return response.json();
          },
          lookup: async (_scope, commandId, deviceId) => {
            const response = await call(
              `/api/v1/sync/receipt?commandId=${commandId}&deviceId=${deviceId}`,
            );
            if (response.status === 404) return null;
            expect(response.status).toBe(200);
            return response.json();
          },
          send: async (_scope, request) => {
            sent++;
            const response = await call(request.path, request.body, {
              "Idempotency-Key": request.idempotencyKey,
            });
            if (response.status === 409)
              throw new DomainError("VERSION_CONFLICT");
            expect(response.status).toBe(200);
            const receipt: unknown = await response.json();
            if (loseResponse) {
              loseResponse = false;
              throw new Error("TEST_COMMITTED_RESPONSE_LOST");
            }
            return receipt;
          },
        };
        const coordinator = () =>
          new LocalWorkSyncCoordinator(runtime().context, {
            metadata: store.metadata,
            outbox: store.outbox,
            syncState: store.syncState,
            replica: store.replica,
            memoIdentity,
            pendingRebase: { store: store.pendingWorkRebase, ids },
            clock,
            transport,
          });
        return {
          own,
          runtime,
          coordinator,
          get store() {
            return store;
          },
          loseResponse() {
            loseResponse = true;
          },
          get sent() {
            return sent;
          },
          async restart() {
            store.close();
            store = await IndexedDbLocalStore.open(
              "memo-host-" + index,
              factory,
            );
          },
          close() {
            store.close();
          },
        };
      }),
    );
    const first = devices[0]!,
      second = devices[1]!;
    try {
      await first.coordinator().run();
      await second.coordinator().run();
      const a = (await first.runtime().saveEntityMemo(
        {
          ...target,
          bodyMd: "first installation draft",
          aiPolicy: {
            classification: "PRIVATE",
            processingBoundary: "ANY",
            aiAccess: "ASK",
          },
        },
        0,
      ))!;
      const b = (await second.runtime().saveEntityMemo(
        {
          ...target,
          bodyMd: "second installation draft",
          aiPolicy: {
            classification: "PRIVATE",
            processingBoundary: "ANY",
            aiAccess: "DENY",
          },
        },
        0,
      ))!;
      expect(a.id).not.toBe(b.id);
      expect((await first.coordinator().run()).accepted).toHaveLength(1);
      expect((await second.coordinator().run()).conflicted).toHaveLength(1);
      expect(await second.runtime().getEntityMemo(target)).toEqual(b);
      const scope = (await second.store.syncState.get(second.own.workspaceId))!;
      const pending = await second.store.outbox.list(second.own.workspaceId);
      const plan = (
        await planLocalCommands(
          second.runtime().context,
          second.store.metadata,
          pending,
        )
      )[0]!;
      const captured = (
        await listLocalWorkConflictReviews(
          second.runtime().context,
          scope,
          second.store.metadata,
          second.store.outbox,
        )
      )[0]!;
      const reviewed = (await prepareLocalPendingWorkRebase(
        second.runtime().context,
        scope,
        plan,
        pending,
        second.store.metadata,
        ids,
        clock,
        { captured, choice: "LOCAL" },
        undefined,
        memoIdentity,
      ))!;
      expect(reviewed).not.toBeNull();
      await second.store.pendingWorkRebase.commit(reviewed);
      expect((await second.coordinator().run()).accepted).toHaveLength(1);
      await first.coordinator().run();
      expect(await first.runtime().getEntityMemo(target)).toMatchObject({
        id: a.id,
        ownerPrincipalId: first.own.principalId,
        bodyMd: b.bodyMd,
        version: 2,
        aiPolicy: b.aiPolicy,
      });
      await first
        .runtime()
        .saveEntityMemo(
          { ...target, bodyMd: "accepted before response loss" },
          2,
        );
      const sentBefore = first.sent;
      first.loseResponse();
      await expect(first.coordinator().run()).rejects.toThrow(
        "TEST_COMMITTED_RESPONSE_LOST",
      );
      expect(first.sent).toBe(sentBefore + 1);
      expect(
        (await first.store.outbox.list(first.own.workspaceId))[0],
      ).toMatchObject({ state: "SENDING", attemptCount: 1 });
      await first.restart();
      expect((await first.coordinator().run()).accepted).toHaveLength(1);
      expect(first.sent).toBe(sentBefore + 1);
      expect(await first.store.outbox.list(first.own.workspaceId)).toEqual([]);
      await second.coordinator().run();
      for (const device of devices)
        expect(await device.runtime().getEntityMemo(target)).toMatchObject({
          ownerPrincipalId: device.own.principalId,
          bodyMd: "accepted before response loss",
          version: 3,
          aiPolicy: b.aiPolicy,
        });
      expect(
        await (
          await call(`/api/memo?targetKind=TASK&targetId=${target.targetId}`)
        ).json(),
      ).toMatchObject({
        bodyMd: "accepted before response loss",
        ownerPrincipalId: task.createdBy,
        version: 3,
      });
      await first
        .runtime()
        .saveEntityMemo({ ...target, bodyMd: "earlier device intent" }, 3);
      const latestDraft = await first
        .runtime()
        .saveEntityMemo(
          { ...target, bodyMd: "later device intent must survive" },
          4,
        );
      await second
        .runtime()
        .saveEntityMemo({ ...target, bodyMd: "concurrent remote intent" }, 3);
      expect((await second.coordinator().run()).accepted).toHaveLength(1);
      expect((await first.coordinator().run()).conflicted).toHaveLength(1);
      expect(await first.runtime().getEntityMemo(target)).toEqual(latestDraft);
      const sequentialScope = (await first.store.syncState.get(
        first.own.workspaceId,
      ))!;
      const sequentialPending = await first.store.outbox.list(
        first.own.workspaceId,
      );
      expect(sequentialPending).toHaveLength(2);
      const sequentialReviews = await listLocalWorkConflictReviews(
        first.runtime().context,
        sequentialScope,
        first.store.metadata,
        first.store.outbox,
      );
      expect(sequentialReviews).toHaveLength(1);
      const sequentialReview = sequentialReviews[0]!;
      expect(sequentialReview.followers).toHaveLength(1);
      const sequentialPlan = (
        await planLocalCommands(
          first.runtime().context,
          first.store.metadata,
          sequentialPending,
        )
      ).find((entry) => entry.id === sequentialReview.original.commandId)!;
      const sequentialReplacement = await prepareLocalPendingWorkRebase(
        first.runtime().context,
        sequentialScope,
        sequentialPlan,
        sequentialPending,
        first.store.metadata,
        ids,
        clock,
        { captured: sequentialReview, choice: sequentialChoice },
        undefined,
        memoIdentity,
      );
      expect(sequentialReplacement).not.toBeNull();
      await first.store.pendingWorkRebase.commit(sequentialReplacement!);
      expect(await first.runtime().getEntityMemo(target)).toEqual(latestDraft);
      const sequentialResult = await first.coordinator().run();
      if (sequentialChoice === "LOCAL") {
        expect(sequentialResult.accepted).toHaveLength(2);
        expect(sequentialResult.conflicted).toEqual([]);
      } else {
        expect(sequentialResult.accepted).toHaveLength(1);
        expect(sequentialResult.conflicted).toHaveLength(1);
        expect(await first.runtime().getEntityMemo(target)).toEqual(
          latestDraft,
        );
        const finalScope = (await first.store.syncState.get(
          first.own.workspaceId,
        ))!;
        const finalPending = await first.store.outbox.list(
          first.own.workspaceId,
        );
        expect(finalPending).toHaveLength(1);
        const finalReview = (
          await listLocalWorkConflictReviews(
            first.runtime().context,
            finalScope,
            first.store.metadata,
            first.store.outbox,
          )
        )[0]!;
        const finalPlan = (
          await planLocalCommands(
            first.runtime().context,
            first.store.metadata,
            finalPending,
          )
        )[0]!;
        expect(finalPlan.state).toBe("CONFLICT");
        const finalReplacement = await prepareLocalPendingWorkRebase(
          first.runtime().context,
          finalScope,
          finalPlan,
          finalPending,
          first.store.metadata,
          ids,
          clock,
          { captured: finalReview, choice: "LOCAL" },
          undefined,
          memoIdentity,
        );
        expect(finalReplacement).not.toBeNull();
        await first.store.pendingWorkRebase.commit(finalReplacement!);
        expect((await first.coordinator().run()).accepted).toHaveLength(1);
      }
      expect(await first.store.outbox.list(first.own.workspaceId)).toEqual([]);
      await second.coordinator().run();
      for (const device of devices)
        expect(await device.runtime().getEntityMemo(target)).toMatchObject({
          bodyMd: "later device intent must survive",
          version: 6,
          ownerPrincipalId: device.own.principalId,
        });
    } finally {
      devices.forEach((device) => device.close());
    }
  },
);

it("private Memo original replay receipts recover accepted values and reject altered effects atomically", async () => {
  await login();
  const task = await create("Private replay target");
  const input = {
    targetKind: "TASK" as const,
    targetId: task.id,
    bodyMd: "Original private command\n",
  };
  const id = await canonicalEntityMemoId(
    { workspaceId: task.workspaceId, principalId: task.createdBy },
    input,
    async (bytes) => createHash("sha1").update(bytes).digest(),
  );
  const commandId = randomUUID(),
    deviceId = randomUUID();
  const body = {
    version: 0,
    input,
    syncCommand: {
      commandId,
      deviceId,
      effects: [
        { collection: "entityMemos", id, op: "UPSERT", baseVersion: 0 },
      ],
    },
  };
  const response = await call("/api/v1/memo/save", body, {
    "Idempotency-Key": commandId,
  });
  expect(response.status).toBe(200);
  const receipt = await response.json();
  expect(receipt).toMatchObject({
    commandId,
    deviceId,
    result: { id, ...input, version: 1 },
    effects: [
      {
        collection: "entityMemos",
        id,
        op: "UPSERT",
        version: 1,
        value: { id, ...input, version: 1 },
      },
    ],
  });
  expect(
    (
      await call("/api/memo/save", {
        version: 1,
        input: { ...input, bodyMd: "Newer remote draft" },
      })
    ).status,
  ).toBe(200);
  await host.close();
  await start();
  expect(
    await (
      await call(
        `/api/v1/sync/receipt?commandId=${commandId}&deviceId=${deviceId}`,
      )
    ).json(),
  ).toEqual(receipt);
  expect(
    await (
      await call("/api/v1/memo/save", body, { "Idempotency-Key": commandId })
    ).json(),
  ).toEqual(receipt);
  expect(
    (
      await call(
        `/api/v1/sync/receipt?commandId=${commandId}&deviceId=${randomUUID()}`,
      )
    ).status,
  ).toBe(404);
  for (const effect of [
    {
      collection: "entityMemos",
      id: id.replace(/^./, id[0] === "a" ? "b" : "a"),
      op: "UPSERT",
      baseVersion: 2,
    },
    { collection: "entityMemos", id, op: "UPSERT", baseVersion: 1 },
    { collection: "items", id: task.id, op: "UPSERT", baseVersion: 2 },
    { collection: "entityMemos", id, op: "DELETE", baseVersion: 2 },
  ]) {
    const failedId = randomUUID();
    const result = await call(
      "/api/memo/save",
      {
        version: 2,
        input,
        syncCommand: { commandId: failedId, deviceId, effects: [effect] },
      },
      { "Idempotency-Key": failedId },
    );
    expect(result.status).toBe(
      effect.collection === "items" || effect.op === "DELETE" ? 400 : 409,
    );
    expect(
      (
        await call(
          `/api/sync/receipt?commandId=${failedId}&deviceId=${deviceId}`,
        )
      ).status,
    ).toBe(404);
  }
  expect(
    await (await call("/api/memo?targetKind=TASK&targetId=" + task.id)).json(),
  ).toMatchObject({ id, version: 2, bodyMd: "Newer remote draft" });
});

it("private Memo host saves are durable, owner-derived, CAS checked and denied to public tokens", async () => {
  expect(
    (await call("/api/memo?targetKind=TASK&targetId=missing")).status,
  ).toBe(401);
  await login();
  const task = await create("Private Memo target");
  const input = {
    targetKind: "TASK",
    targetId: task.id,
    bodyMd: "  私人原文\n第二行\n",
  };
  const readPath = "/api/memo?targetKind=TASK&targetId=" + task.id;
  expect(await (await call(readPath)).json()).toBeNull();
  const key = randomUUID();
  const request = { version: 0, input, deleted: false };
  const response = await call("/api/memo/save", request, {
    "Idempotency-Key": key,
  });
  expect(response.status).toBe(200);
  const original = await response.json();
  expect(original).toMatchObject({ ...input, version: 1, deletedAt: null });
  expect(original.id).toMatch(
    /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
  );
  expect(
    await (
      await call("/api/memo/save", request, { "Idempotency-Key": key })
    ).json(),
  ).toEqual(original);
  expect((await call("/api/memo/save", request)).status).toBe(409);
  expect(
    (
      await call("/api/memo/save", {
        ...request,
        ownerPrincipalId: "someone-else",
      })
    ).status,
  ).toBe(400);
  expect((await call(readPath + "&ownerPrincipalId=someone-else")).status).toBe(
    400,
  );
  expect((await call(readPath + "&targetKind=FILE")).status).toBe(400);
  expect(
    (
      await call(
        "/api/memo/save",
        { version: 1, input },
        { "X-CSRF-Token": "wrong" },
      )
    ).status,
  ).toBe(403);
  expect(
    (await call(readPath, undefined, { "X-Workspace-Id": randomUUID() }))
      .status,
  ).toBe(403);
  const token = await (
    await call("/api/tokens/create", {
      name: "No private Memo access",
      scope: "read-write",
    })
  ).json();
  const bearer = { Authorization: "Bearer " + token.secret };
  expect((await call(readPath, undefined, bearer)).status).toBe(403);
  expect(
    (await call("/api/memo/save", { version: 1, input }, bearer)).status,
  ).toBe(403);
  const publicDelta = await (
    await call("/api/v1/sync?after=0&bodyMode=metadata")
  ).json();
  expect(
    publicDelta.records.some(
      (record: { collection: string }) => record.collection === "entityMemos",
    ),
  ).toBe(false);
  expect(publicDelta.changes.collections).not.toHaveProperty("entityMemos");
  const privatePath =
    "/api/v1/sync?after=0&privateMemos=only&bodyMode=metadata";
  const privateDelta = await (await call(privatePath)).json();
  expect(privateDelta.records.length).toBeGreaterThan(0);
  expect(
    privateDelta.records.every(
      (record: { collection: string }) => record.collection === "entityMemos",
    ),
  ).toBe(true);
  expect(privateDelta.changes.collections).toEqual({
    entityMemos: { upserts: [original], removed: [] },
  });
  expect(privateDelta.changes.values).toEqual({});
  expect((await call(privatePath, undefined, bearer)).status).toBe(403);
  expect((await call(privatePath + "&privateMemos=include")).status).toBe(400);
  expect(
    (await call("/api/v1/sync?after=0&privateMemos=someone-else")).status,
  ).toBe(400);
  expect(
    (await call(privatePath, undefined, { "X-Workspace-Id": randomUUID() }))
      .status,
  ).toBe(403);
  const nextResponse = await call("/api/memo/save", {
    version: 1,
    input: { ...input, bodyMd: "Updated\n" },
  });
  expect(nextResponse.status).toBe(200);
  const updated = await nextResponse.json();
  expect(updated).toMatchObject({
    id: original.id,
    version: 2,
    bodyMd: "Updated\n",
  });
  await host.close();
  await start();
  expect(await (await call(readPath)).json()).toEqual(updated);
  expect((await call("/api/memo/save", { version: 1, input })).status).toBe(
    409,
  );
  expect(
    (
      await call("/api/memo/save", {
        version: 2,
        input: { ...input, bodyMd: "Updated\n" },
        deleted: true,
      })
    ).status,
  ).toBe(200);
  expect(await (await call(readPath)).json()).toBeNull();
  const restored = await (
    await call("/api/memo/save", { version: 3, input })
  ).json();
  expect(restored).toMatchObject({
    id: original.id,
    version: 4,
    bodyMd: input.bodyMd,
  });
});

it("document home move receipts preserve identity and body with exact CAS and idempotency", async () => {
  await login();
  const createSpace = async (title: string) =>
    (
      await call("/api/library/save", {
        id: null,
        version: 0,
        input: { kind: "SPACE", spaceId: null, title, bodyMd: "" },
      })
    ).json();
  const source = await createSpace("Original home"),
    target = await createSpace("New home");
  const document = await (
    await call("/api/library/save", {
      id: null,
      version: 0,
      input: {
        kind: "DOCUMENT",
        spaceId: source.id,
        title: "",
        bodyMd: "Original\n中文原文",
      },
    })
  ).json();
  const commandId = randomUUID(),
    deviceId = randomUUID();
  const input = {
    id: document.id,
    version: document.version,
    spaceId: target.id,
    syncCommand: {
      commandId,
      deviceId,
      effects: [
        {
          collection: "library",
          id: document.id,
          op: "UPSERT",
          baseVersion: document.version,
        },
      ],
    },
  };
  const response = await call("/api/v1/library/move", input, {
    "Idempotency-Key": commandId,
  });
  expect(response.status).toBe(200);
  const receipt = await response.json();
  expect(
    await (
      await call("/api/v1/library/move", input, {
        "Idempotency-Key": commandId,
      })
    ).json(),
  ).toEqual(receipt);
  const body = await (
    await call("/api/document/body?kind=LIBRARY&id=" + document.id)
  ).json();
  expect(body).toMatchObject({
    id: document.id,
    title: "",
    bodyMd: document.bodyMd,
    spaceId: target.id,
    version: document.version + 1,
  });
  expect(
    (
      await call("/api/library/move", {
        id: document.id,
        version: document.version,
        spaceId: source.id,
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await (
        await call("/api/document/body?kind=LIBRARY&id=" + document.id)
      ).json()
    ).spaceId,
  ).toBe(target.id);
});

it("private Memo Atlas context is owner-canonical, temporary and rechecks revoked policy before approval", async () => {
  const complete = vi.fn(async () => "Proposed action from Memo");
  await host.close();
  await start(undefined, {
    route: {
      fingerprint: "memo-ci",
      provider: "test",
      model: "test",
      maxInputChars: 32000,
      maxOutputTokens: 100,
      maxRunsPerDay: 10,
      timeoutMs: 5000,
    },
    complete,
  });
  await login();
  const task = await create("Memo Atlas target");
  const target = { targetKind: "TASK", targetId: task.id };
  const bodyMd = "Private owner source only\n";
  const saved = await call("/api/memo/save", {
    version: 0,
    input: { ...target, bodyMd },
  });
  expect(saved.status).toBe(200);
  let memo = await saved.json();
  const request = () => ({
    prompt: "Extract an untracked action",
    responseFormat: "ANSWER",
    sources: [{ kind: "MEMO", id: memo.id, version: memo.version, target }],
  });
  expect((await call("/api/ai/propose", request())).status).toBe(403);
  expect(complete).not.toHaveBeenCalled();
  async function policy(aiAccess: "ASK" | "DENY") {
    const response = await call("/api/memo/save", {
      version: memo.version,
      input: {
        ...target,
        bodyMd,
        aiPolicy: {
          classification: "PRIVATE",
          processingBoundary: "ANY",
          aiAccess,
        },
      },
    });
    expect(response.status).toBe(200);
    memo = await response.json();
  }
  await policy("ASK");
  expect(
    (await call("/api/ai/propose", { ...request(), responseFormat: undefined }))
      .status,
  ).toBe(400);
  expect(
    (await call("/api/ai/propose", request(), { "X-CSRF-Token": "" })).status,
  ).toBe(403);
  expect(
    (
      await call("/api/ai/propose", {
        ...request(),
        sources: [{ ...request().sources[0], bodyMd: "Forged source" }],
      })
    ).status,
  ).toBe(400);
  const prepared = await call("/api/ai/propose", request());
  expect(prepared.status).toBe(200);
  const stale = await prepared.json();
  expect(stale.context[0]).toMatchObject({
    ref: { kind: "MEMO", id: memo.id, target },
    bodyMd,
    memo: { target, ownerPrincipalId: task.createdBy },
  });
  expect(complete).not.toHaveBeenCalled();
  await policy("DENY");
  expect(
    (
      await call("/api/ai/decide", {
        id: stale.id,
        version: stale.version,
        approve: true,
      })
    ).status,
  ).toBe(403);
  expect(complete).not.toHaveBeenCalled();
  await policy("ASK");
  const fresh = await (await call("/api/ai/propose", request())).json();
  expect(
    (
      await call("/api/ai/decide", {
        id: fresh.id,
        version: fresh.version,
        approve: true,
      })
    ).status,
  ).toBe(200);
  await expect
    .poll(
      async () =>
        (await (await call(`/api/ai/run?id=${fresh.id}`)).json()).status,
    )
    .toBe("SUCCEEDED");
  expect(complete).toHaveBeenCalledOnce();
  expect(await (await call("/api/ai/sessions")).json()).toEqual([]);
  const finishedMemoRun = await (
    await call(`/api/ai/run?id=${fresh.id}`)
  ).json();
  const promotion = {
    title: "Explicit private Memo conversation",
    runs: [{ id: finishedMemoRun.id, version: finishedMemoRun.version }],
  };
  const promoted = await call("/api/v1/ai/sessions/promote", promotion);
  expect(promoted.status).toBe(200);
  const conversation = await promoted.json();
  expect(conversation.messages).toHaveLength(2);
  expect(conversation.messages[1].evidence).toEqual([
    {
      ref: { kind: "MEMO", id: memo.id, target },
      title: finishedMemoRun.context[0].title,
      version: memo.version,
      source: "current",
    },
  ]);
  expect((await call("/api/v1/ai/sessions/promote", promotion)).status).toBe(
    409,
  );
  const queued = await (await call("/api/ai/propose", request())).json();
  const originalRequest = host.db.request.bind(host.db);
  let revokedBeforeDispatch = false;
  const dispatchGate = vi.spyOn(host.db, "request");
  dispatchGate.mockImplementation((async (
    ...args: Parameters<typeof originalRequest>
  ) => {
    if (!revokedBeforeDispatch) {
      const current = await originalRequest(
        args[0],
        null,
        async (_uow, _notes, connected) => connected.getRun(queued.id),
      );
      if (current.approvedAt && current.status === "RUNNING") {
        revokedBeforeDispatch = true;
        await policy("DENY");
      }
    }
    return originalRequest(...args);
  }) as typeof host.db.request);
  try {
    expect(
      (
        await call("/api/ai/decide", {
          id: queued.id,
          version: queued.version,
          approve: true,
        })
      ).status,
    ).toBe(200);
    await expect
      .poll(
        async () =>
          (await (await call(`/api/ai/run?id=${queued.id}`)).json()).status,
      )
      .toBe("FAILED");
    expect(revokedBeforeDispatch).toBe(true);
    expect(complete).toHaveBeenCalledOnce();
  } finally {
    dispatchGate.mockRestore();
  }
  expect(
    (await (await call(`/api/memo?targetKind=TASK&targetId=${task.id}`)).json())
      .bodyMd,
  ).toBe(bodyMd);
});

it("contextual editor replacement preserves canonical permission and approval and excludes durable sessions", async () => {
  const complete = vi.fn(async () => "Reviewed replacement");
  await host.close();
  await start(undefined, {
    route: {
      fingerprint: "editor-ci",
      provider: "test",
      model: "test",
      maxInputChars: 32000,
      maxOutputTokens: 100,
      maxRunsPerDay: 10,
      timeoutMs: 5000,
    },
    complete,
  });
  await login();
  const saved = await call("/api/library/save", {
    id: null,
    version: 0,
    input: {
      kind: "SPACE",
      spaceId: null,
      title: "Editor source",
      bodyMd: "Canonical paragraph" + "x".repeat(100000),
      aiPolicy: {
        classification: "PRIVATE",
        processingBoundary: "ANY",
        aiAccess: "ASK",
      },
    },
  });
  expect(saved.status).toBe(200);
  const document = await saved.json();
  const input = {
    prompt: "Polish the selected paragraph",
    sources: [
      {
        kind: "SPACE",
        id: document.id,
        version: document.version,
        source: "selected",
        range: { from: 0, to: 19, text: "Canonical paragraph" },
      },
    ],
    responseFormat: "REPLACEMENT",
  };
  const prepared = await call("/api/ai/propose", input);
  expect(prepared.status).toBe(200);
  const run = await prepared.json();
  expect(run.status).toBe("WAITING_APPROVAL");
  expect(run.prompt).toContain("Return only replacement Markdown");
  expect(run.prompt).not.toContain('return ONLY JSON: {"edits"');
  expect(run.context[0].bodyMd).toBe("Canonical paragraph");
  expect(complete).not.toHaveBeenCalled();
  expect(run.prompt.length).toBeLessThan(32000);
  expect(run.context[0].range).toEqual({ from: 0, to: 19 });
  const answerResponse = await call("/api/ai/propose", {
    ...input,
    responseFormat: "ANSWER",
  });
  expect(answerResponse.status).toBe(200);
  const answerRun = await answerResponse.json();
  expect(answerRun.status).toBe("WAITING_APPROVAL");
  expect(answerRun.prompt).not.toContain("Return only replacement Markdown");
  expect(answerRun.prompt).not.toContain('return ONLY JSON: {"edits"');
  expect(
    (
      await call("/api/ai/decide", {
        id: answerRun.id,
        version: answerRun.version,
        approve: false,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await call("/api/ai/propose", {
        ...input,
        sources: [
          {
            ...input.sources[0],
            range: { from: 0, to: 19, text: "Stale local content" },
          },
        ],
      })
    ).status,
  ).toBe(409);
  expect(
    (await call("/api/ai/propose", { ...input, responseFormat: "UNSAFE" }))
      .status,
  ).toBe(400);
  expect(
    (await call("/api/ai/propose", { ...input, sources: [] })).status,
  ).toBe(400);
  expect(
    (
      await call("/api/ai/propose", {
        ...input,
        sessionId: randomUUID(),
        sessionVersion: 1,
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await call("/api/ai/decide", {
        id: run.id,
        version: run.version,
        approve: true,
      })
    ).status,
  ).toBe(200);
  for (let attempt = 0; attempt < 100 && !complete.mock.calls.length; attempt++)
    await new Promise((done) => setTimeout(done, 10));
  expect(complete).toHaveBeenCalledOnce();
  expect(await (await call("/api/ai/sessions")).json()).toEqual([]);
  let finished = run;
  await expect
    .poll(async () => {
      finished = await (await call(`/api/v1/ai/run?id=${run.id}`)).json();
      return finished.status;
    })
    .toBe("SUCCEEDED");
  const promotion = {
      title: "Explicitly saved",
      runs: [{ id: finished.id, version: finished.version }],
    },
    key = randomUUID();
  expect(
    (
      await call("/api/v1/ai/sessions/promote", promotion, {
        "X-CSRF-Token": "",
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await call("/api/v1/ai/sessions/promote", {
        ...promotion,
        messages: [{ kind: "ASSISTANT", text: "Forged" }],
      })
    ).status,
  ).toBe(400);
  const savedResponse = await call("/api/v1/ai/sessions/promote", promotion, {
    "Idempotency-Key": key,
  });
  expect(savedResponse.status).toBe(200);
  const savedSession = await savedResponse.json();
  expect(
    savedSession.messages.map((message: { text: string }) => message.text),
  ).toEqual([input.prompt, "Reviewed replacement"]);
  expect(
    await (
      await call("/api/v1/ai/sessions/promote", promotion, {
        "Idempotency-Key": key,
      })
    ).json(),
  ).toEqual(savedSession);
  expect((await call("/api/v1/ai/sessions/promote", promotion)).status).toBe(
    409,
  );
  expect(await (await call("/api/ai/sessions")).json()).toHaveLength(1);
  expect(complete).toHaveBeenCalledOnce();
});

it("File Atlas uses original worker citations and never sends denied, unapproved or stale content", async () => {
  const parser = await actualFileParserFixture("host-file-atlas-test");
  const complete = vi.fn(async () => "A cited answer");
  const model: ModelPort = {
    route: {
      fingerprint: "file-context-test",
      provider: "test",
      model: "test",
      maxInputChars: 32000,
      maxOutputTokens: 100,
      maxRunsPerDay: 10,
      timeoutMs: 5000,
    },
    complete,
  };
  await host.close();
  await start(undefined, model, undefined, parser);
  await login();
  const bytes = Buffer.from(
    "Original canonical satellites finding\n" +
      "Unrelated original text. ".repeat(1800),
  );
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  expect(
    (
      await call("/api/v1/files/binary/begin", {
        contentHash,
        size: bytes.length,
        mime: "text/plain",
        chunkSize: 262144,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await call(
        `/api/v1/files/binary/chunk?hash=${contentHash}&index=0`,
        {},
        {
          "Content-Type": "application/octet-stream",
          "X-File-Chunk-Hash": contentHash,
        },
        bytes,
      )
    ).status,
  ).toBe(200);
  expect(
    (await call("/api/v1/files/binary/complete", { contentHash })).status,
  ).toBe(200);
  const file = await (
    await call("/api/v1/files/register", {
      name: "original.txt",
      mime: "text/plain",
      contentHash,
      size: bytes.length,
      spaceId: null,
    })
  ).json();
  const request = {
    prompt: "satellites",
    sources: [{ kind: "FILE", id: file.id, version: 1 }],
  };
  expect((await call("/api/ai/propose", request)).status).toBe(403);
  expect(complete).not.toHaveBeenCalled();
  const permitted = await (
    await call("/api/v1/files/policy", {
      id: file.id,
      version: 1,
      aiPolicy: {
        classification: "PRIVATE",
        processingBoundary: "ANY",
        aiAccess: "ASK",
      },
    })
  ).json();
  request.sources[0]!.version = permitted.version;
  const response = await call("/api/ai/propose", request);
  const proposal = await response.json();
  expect(response.status, JSON.stringify(proposal)).toBe(200);
  expect(proposal.status).toBe("WAITING_APPROVAL");
  expect(await (await call(`/api/v1/ai/run?id=${proposal.id}`)).json()).toEqual(
    proposal,
  );
  expect(
    (await call(`/api/v1/ai/run?id=${proposal.id}`, undefined, { Cookie: "" }))
      .status,
  ).toBe(401);
  expect(proposal.context).toHaveLength(1);
  const source = proposal.context[0];
  expect(source.ref).toEqual({ kind: "FILE", id: file.id });
  expect(source.file.contentHash).toBe(contentHash);
  expect(source.file.locators.length).toBeGreaterThan(0);
  expect(source.file.locators.length).toBeLessThanOrEqual(3);
  expect(source.bodyMd).toContain("Original canonical satellites finding");
  expect(source.bodyMd.length).toBeLessThan(bytes.length);
  expect(complete).not.toHaveBeenCalled();
  expect(
    (
      await call("/api/ai/decide", {
        id: proposal.id,
        version: proposal.version,
        approve: true,
      })
    ).status,
  ).toBe(200);
  await vi.waitFor(async () => {
    const runs = (await (await call("/api/ai")).json()).runs;
    expect(
      runs.find((run: { id: string }) => run.id === proposal.id).status,
    ).toBe("SUCCEEDED");
  });
  expect(complete).toHaveBeenCalledOnce();
  const stale = await (await call("/api/ai/propose", request)).json();
  expect(
    (
      await call("/api/v1/files/policy", {
        id: file.id,
        version: permitted.version,
        aiPolicy: {
          classification: "PRIVATE",
          processingBoundary: "ANY",
          aiAccess: "DENY",
        },
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await call("/api/ai/decide", {
        id: stale.id,
        version: stale.version,
        approve: true,
      })
    ).status,
  ).toBe(409);
  expect(complete).toHaveBeenCalledOnce();
  expect(
    Buffer.from(
      await (await call(`/api/v1/files/bytes?id=${file.id}`)).arrayBuffer(),
    ),
  ).toEqual(bytes);
  const token = await (
    await call("/api/tokens/create", {
      name: "File citations",
      scope: "read-write",
    })
  ).json();
  const headers = { Authorization: "Bearer " + token.secret, Cookie: "" };
  expect(
    (await call(`/api/v1/ai/run?id=${proposal.id}`, undefined, headers)).status,
  ).toBe(403);
  const rpc = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "read_file_chunks",
      arguments: { id: file.id, version: 3, query: "satellites" },
    },
  };
  expect((await call("/api/mcp", rpc, headers)).status).toBe(403);
  const externallyAllowed = await (
    await call("/api/v1/files/policy", {
      id: file.id,
      version: 3,
      aiPolicy: {
        classification: "PRIVATE",
        processingBoundary: "ANY",
        aiAccess: "ALLOW",
      },
    })
  ).json();
  expect(
    (
      await call(
        `/api/v1/files/extraction?id=${file.id}&version=${externallyAllowed.version}`,
      )
    ).status,
  ).toBe(200);
  rpc.params.arguments.version = externallyAllowed.version;
  const mcp = await call("/api/mcp", rpc, headers),
    body = await mcp.json();
  expect(mcp.status, JSON.stringify(body)).toBe(200);
  const cited = JSON.parse(body.result.content[0].text);
  expect(cited.ref).toEqual({ kind: "FILE", id: file.id });
  expect(cited.file.contentHash).toBe(contentHash);
  expect(cited.file.locators.length).toBeLessThanOrEqual(3);
  expect(cited.bodyMd).toContain("Original canonical satellites finding");
  expect(cited).not.toHaveProperty("bytes");
  expect(cited).not.toHaveProperty("base64");
  expect(complete).toHaveBeenCalledOnce();
});
it("authenticated Host extraction uses the real Node worker, preserves originals and rejects stale/foreign reads", async () => {
  const parser = await actualFileParserFixture("host-extraction-worker-test");
  await host.close();
  await start(undefined, undefined, undefined, parser);
  await login();
  const bytes = Buffer.from("canonical original\n第二行"),
    contentHash = createHash("sha256").update(bytes).digest("hex");
  expect(
    (
      await call("/api/v1/files/binary/begin", {
        contentHash,
        size: bytes.length,
        mime: "text/plain",
        chunkSize: 262144,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await call(
        `/api/v1/files/binary/chunk?hash=${contentHash}&index=0`,
        {},
        {
          "Content-Type": "application/octet-stream",
          "X-File-Chunk-Hash": contentHash,
        },
        bytes,
      )
    ).status,
  ).toBe(200);
  expect(
    (await call("/api/v1/files/binary/complete", { contentHash })).status,
  ).toBe(200);
  const created = await call("/api/v1/files/register", {
    name: "canonical.txt",
    mime: "text/plain",
    spaceId: null,
    contentHash,
    size: bytes.length,
  });
  expect(created.status).toBe(200);
  const file = await created.json();
  const before = await (await call("/api/bootstrap")).json();
  const path = `/api/v1/files/extraction?id=${file.id}&version=1`;
  const response = await call(path);
  const document = await response.json();
  expect(response.status, JSON.stringify(document)).toBe(200);
  expect(document).toMatchObject({
    fileId: file.id,
    fileVersion: 1,
    contentHash,
    indexVersion: 2,
  });
  expect(document.chunks).toEqual([
    expect.objectContaining({
      kind: "TEXT",
      locator: "text:1/chunk:1",
      text: bytes.toString("utf8"),
      fileVersion: 1,
      contentHash,
    }),
  ]);
  expect(await (await call(path)).json()).toEqual(document);
  const after = await (await call("/api/bootstrap")).json();
  expect(after.cursor).toBe(before.cursor);
  expect(after.workspace.files).toEqual(before.workspace.files);
  expect(
    Buffer.from(
      await (await call(`/api/v1/files/bytes?id=${file.id}`)).arrayBuffer(),
    ),
  ).toEqual(bytes);
  expect((await call(path, undefined, { Cookie: "" })).status).toBe(401);
  const token = await (
    await call("/api/tokens/create", {
      name: "Extraction boundary",
      scope: "read-write",
    })
  ).json();
  for (const grants of [
    ["files:read"],
    ["files:content"],
    ["files:read", "files:content"],
  ]) {
    const scoped = await (
      await call("/api/tokens/create", {
        name: "File grants",
        scope: "write",
        grants,
      })
    ).json();
    const bearer = { Authorization: "Bearer " + scoped.secret, Cookie: "" };
    expect(
      (await call(`/api/v1/files/metadata?id=${file.id}`, undefined, bearer))
        .status,
    ).toBe(grants.includes("files:read") ? 200 : 403);
    const excerpt = await call(path, undefined, bearer);
    expect(excerpt.status).toBe(grants.length === 2 ? 200 : 403);
    const original = await call(
      `/api/v1/files/bytes?id=${file.id}`,
      undefined,
      bearer,
    );
    expect(original.status).toBe(grants.length === 2 ? 200 : 403);
    if (grants.length === 2)
      expect(Buffer.from(await original.arrayBuffer())).toEqual(bytes);
  }
  const foreignSecret = "arc_" + randomBytes(32).toString("hex");
  await host.db.accounts((store) => {
    const pending = store.register(
      "foreign-file-reader",
      "fixture-verifier",
      false,
    );
    const active = store.status(pending.id, pending.version, "ACTIVE");
    store.issue(
      active.id,
      "Foreign File grant",
      "write",
      createHash("sha256").update(foreignSecret).digest("hex"),
      null,
      ["files:read", "files:content"],
    );
  });
  for (const foreignPath of [
    path,
    `/api/v1/files/metadata?id=${file.id}`,
    `/api/v1/files/bytes?id=${file.id}`,
  ]) {
    expect(
      (
        await call(foreignPath, undefined, {
          Authorization: "Bearer " + foreignSecret,
          Cookie: "",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(foreignPath, undefined, {
          Authorization: "Bearer " + foreignSecret,
          Cookie: "",
          "X-Workspace-Id": file.workspaceId,
        })
      ).status,
    ).toBe(403);
  }
  expect(
    (
      await call(path, undefined, {
        Authorization: "Bearer " + token.secret,
        Cookie: "",
      })
    ).status,
  ).toBe(403);
  expect(
    (await call(`/api/v1/files/extraction?id=${file.id}&version=0`)).status,
  ).toBe(400);
  expect(
    (
      await call("/api/v1/files/rename", {
        id: file.id,
        version: 1,
        name: "Renamed.txt",
      })
    ).status,
  ).toBe(200);
  expect((await call(path)).status).toBe(409);
  const latest = await (
    await call(`/api/v1/files/extraction?id=${file.id}&version=2`)
  ).json();
  expect(latest.chunks[0]).toMatchObject({
    fileVersion: 2,
    text: bytes.toString("utf8"),
  });
});
it("first-class File binary chunks resume independently and original metadata replay retains exact bytes and receipts", async () => {
  await login();
  const bytes = Buffer.from([0, 1, 127, 128, 255]),
    contentHash = createHash("sha256").update(bytes).digest("hex"),
    id = randomUUID(),
    deviceId = randomUUID();
  const begin = {
    contentHash,
    size: bytes.length,
    mime: "application/octet-stream",
    chunkSize: 2,
  };
  expect((await call("/api/v1/files/binary/begin", begin)).status).toBe(200);
  const commandId = randomUUID(),
    request = {
      name: "原始.bin",
      mime: "application/octet-stream",
      spaceId: null,
      contentHash,
      size: bytes.length,
      stableId: id,
      deviceId,
      syncCommand: {
        commandId,
        deviceId,
        effects: [{ collection: "files", id, op: "UPSERT", baseVersion: 0 }],
      },
    };
  expect(
    (
      await call("/api/v1/files/register", request, {
        "Idempotency-Key": commandId,
      })
    ).status,
  ).toBe(404);
  expect(
    (await call("/api/v1/files/binary/complete", { contentHash })).status,
  ).toBe(400);
  const upload = async (
    index: number,
    chunk: Buffer,
    hash = createHash("sha256").update(chunk).digest("hex"),
  ) =>
    call(
      `/api/v1/files/binary/chunk?hash=${contentHash}&index=${index}`,
      {},
      { "Content-Type": "application/octet-stream", "X-File-Chunk-Hash": hash },
      chunk,
    );
  expect((await upload(0, bytes.subarray(0, 2))).status).toBe(200);
  expect((await upload(0, bytes.subarray(0, 2))).status).toBe(200);
  expect((await upload(1, bytes.subarray(2, 4), "0".repeat(64))).status).toBe(
    400,
  );
  expect(
    await (await call("/api/v1/files/binary/begin", begin)).json(),
  ).toEqual({ contentHash, received: [0] });
  expect((await upload(1, bytes.subarray(2, 4))).status).toBe(200);
  expect((await upload(2, bytes.subarray(4))).status).toBe(200);
  expect(
    (await call("/api/v1/files/binary/complete", { contentHash })).status,
  ).toBe(200);
  const response = await call("/api/v1/files/register", request, {
      "Idempotency-Key": commandId,
    }),
    receipt = await response.json();
  expect(response.status, JSON.stringify(receipt)).toBe(200);
  expect(receipt).toMatchObject({
    commandId,
    deviceId,
    result: { id, version: 1, originalName: "原始.bin", contentHash, size: 5 },
    effects: [{ collection: "files", id, version: 1 }],
  });
  expect(
    await (
      await call("/api/v1/files/register", request, {
        "Idempotency-Key": commandId,
      })
    ).json(),
  ).toEqual(receipt);
  expect(
    await (
      await call(
        `/api/v1/sync/receipt?commandId=${commandId}&deviceId=${deviceId}`,
      )
    ).json(),
  ).toEqual(receipt);
  for (const [version, deleted] of [
    [1, false],
    [2, true],
    [3, false],
  ] as const) {
    const key = randomUUID(),
      change = {
        id,
        version,
        ...(version === 1 ? { name: "Display.txt" } : { deleted }),
        syncCommand: {
          commandId: key,
          deviceId,
          effects: [
            { collection: "files", id, op: "UPSERT", baseVersion: version },
          ],
        },
      };
    const changed = await call(
      version === 1 ? "/api/v1/files/rename" : "/api/v1/files/delete",
      change,
      { "Idempotency-Key": key },
    );
    expect(changed.status).toBe(200);
    expect((await changed.json()).result).toMatchObject({
      id,
      version: version + 1,
      name: "Display.txt",
      originalName: "原始.bin",
      contentHash,
    });
    if (deleted)
      expect((await call(`/api/v1/files/bytes?id=${id}`)).status).toBe(404);
  }
  const download = await call(`/api/v1/files/bytes?id=${id}`);
  expect(download.status).toBe(200);
  expect(download.headers.get("content-type")).toBe("application/octet-stream");
  expect(new Uint8Array(await download.arrayBuffer())).toEqual(
    new Uint8Array(bytes),
  );
  const bootstrap = await (await call("/api/bootstrap")).json();
  expect(bootstrap.workspace.files).toHaveLength(1);
  expect(bootstrap.workspace.files[0]).toMatchObject({
    id,
    version: 4,
    contentHash,
    originalName: "原始.bin",
  });
  expect(bootstrap.workspace.files[0]).not.toHaveProperty("base64");
  const policyKey = randomUUID(),
    policyChange = {
      id,
      version: 4,
      aiPolicy: {
        classification: "PRIVATE",
        processingBoundary: "LOCAL_ONLY",
        aiAccess: "ASK",
      },
      syncCommand: {
        commandId: policyKey,
        deviceId,
        effects: [{ collection: "files", id, op: "UPSERT", baseVersion: 4 }],
      },
    };
  const policyResponse = await call("/api/v1/files/policy", policyChange, {
    "Idempotency-Key": policyKey,
  });
  const policyReceipt = await policyResponse.json();
  expect(policyResponse.status, JSON.stringify(policyReceipt)).toBe(200);
  expect(policyReceipt.result).toMatchObject({
    id,
    version: 5,
    aiPolicy: policyChange.aiPolicy,
    contentHash,
    originalName: "原始.bin",
  });
  const fileBearer = await (
    await call("/api/tokens/create", {
      name: "File policy boundary",
      scope: "read-write",
    })
  ).json();
  expect(
    (
      await call(
        "/api/v1/files/policy",
        {},
        { Authorization: "Bearer " + fileBearer.secret, Cookie: "" },
      )
    ).status,
  ).toBe(403);
  expect(
    (await call("/api/v1/files/policy", {}, { "X-CSRF-Token": "wrong" }))
      .status,
  ).toBe(403);
  expect((await call("/api/v1/files/policy", {}, { Cookie: "" })).status).toBe(
    401,
  );
  expect(
    await (
      await call("/api/v1/files/policy", policyChange, {
        "Idempotency-Key": policyKey,
      })
    ).json(),
  ).toEqual(policyReceipt);
  expect(
    (
      await call(
        "/api/v1/files/policy",
        {
          ...policyChange,
          aiPolicy: { ...policyChange.aiPolicy, aiAccess: "ALLOW" },
        },
        { "Idempotency-Key": policyKey },
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await call("/api/v1/files/policy", {
        id,
        version: 4,
        aiPolicy: policyChange.aiPolicy,
      })
    ).status,
  ).toBe(409);
  expect(
    new Uint8Array(
      await (await call(`/api/v1/files/bytes?id=${id}`)).arrayBuffer(),
    ),
  ).toEqual(new Uint8Array(bytes));
  expect((await upload(0, Buffer.alloc(262145))).status).toBe(400);
});
it("original PLAN replay preserves stable publication IDs and complete owned knowledge effects", async () => {
  await login();
  const deviceId = randomUUID(),
    planId = randomUUID(),
    projectId = randomUUID(),
    spaceId = randomUUID(),
    documentId = randomUUID(),
    materialId = randomUUID();
  const manifest = {
    version: 1,
    projects: [{ tempId: "p", title: "Reviewed project", lifecycle: "ACTIVE" }],
    spaces: [{ tempId: "s", title: "Knowledge", descriptionMd: "Context" }],
    documents: [
      {
        tempId: "d",
        title: "Original document",
        bodyMd: "第一行\n第二行\n[[Wiki]]",
        spaceTempId: "s",
        projectTempId: "p",
        ownership: "OWNED",
      },
    ],
  };
  const previewId = randomUUID(),
    previewRequest = {
      projectId: null,
      manifest,
      stableId: planId,
      deviceId,
      baseRevision: JSON.stringify({ categories: [], items: [], edges: [] }),
      documentRevision: JSON.stringify({ library: [], materials: [] }),
      syncCommand: {
        commandId: previewId,
        deviceId,
        effects: [
          { collection: "workflows", id: planId, op: "UPSERT", baseVersion: 0 },
        ],
      },
    };
  const previewResponse = await call("/api/v1/plans/preview", previewRequest, {
    "Idempotency-Key": previewId,
  });
  const preview = await previewResponse.json();
  expect(previewResponse.status, JSON.stringify(preview)).toBe(200);
  expect(preview.result).toMatchObject({
    id: planId,
    version: 1,
    payload: { published: false },
  });
  const effects = [
    { collection: "items", id: projectId, op: "UPSERT", baseVersion: 0 },
    { collection: "library", id: spaceId, op: "UPSERT", baseVersion: 0 },
    { collection: "library", id: documentId, op: "UPSERT", baseVersion: 0 },
    {
      collection: "projectMaterials",
      id: materialId,
      op: "UPSERT",
      baseVersion: 0,
    },
    {
      collection: "projectMaterials",
      id: materialId,
      op: "UPSERT",
      baseVersion: 1,
    },
    { collection: "workflows", id: planId, op: "UPSERT", baseVersion: 1 },
  ];
  const failedId = randomUUID();
  expect(
    (
      await call(
        "/api/v1/plans/publish",
        {
          id: planId,
          version: 1,
          syncCommand: {
            commandId: failedId,
            deviceId,
            effects: effects.filter(
              (e) =>
                !(e.collection === "projectMaterials" && e.baseVersion === 1),
            ),
          },
        },
        { "Idempotency-Key": failedId },
      )
    ).status,
  ).toBe(409);
  expect(
    (await call(`/api/sync/receipt?commandId=${failedId}&deviceId=${deviceId}`))
      .status,
  ).toBe(404);
  const before = await (await call("/api/snapshot")).json();
  expect(before.items).toEqual([]);
  expect(before.library).toEqual([]);
  const commandId = randomUUID(),
    request = {
      id: planId,
      version: 1,
      syncCommand: { commandId, deviceId, effects },
    };
  const response = await call("/api/v1/plans/publish", request, {
    "Idempotency-Key": commandId,
  });
  const receipt = await response.json();
  expect(response.status, JSON.stringify(receipt)).toBe(200);
  expect(receipt.result).toMatchObject({
    id: planId,
    version: 2,
    payload: {
      published: true,
      result: { p: projectId, s: spaceId, d: documentId },
    },
  });
  expect(receipt.effects).toHaveLength(5);
  expect(
    receipt.effects.find((e: { id: string }) => e.id === documentId).value,
  ).toMatchObject({
    id: documentId,
    bodyMd: manifest.documents[0]!.bodyMd,
    provenance: "HUMAN",
  });
  expect(
    receipt.effects.find((e: { id: string }) => e.id === materialId),
  ).toMatchObject({
    version: 2,
    value: {
      id: materialId,
      targetId: documentId,
      projectId,
      ownership: "OWNED",
    },
  });
  expect(
    await (
      await call("/api/v1/plans/publish", request, {
        "Idempotency-Key": commandId,
      })
    ).json(),
  ).toEqual(receipt);
});
it("versioned PLAN preview preserves preview semantics and requires separate publication", async () => {
  await login();
  const response = await call("/api/v1/plans/preview", {
    projectId: null,
    manifest: {
      version: 1,
      tasks: [
        {
          tempId: "task",
          title: "Reviewed plan",
          descriptionMd: "原文\n第二行",
          dependsOn: [],
        },
      ],
    },
  });
  const preview = await response.json();
  expect(response.status, JSON.stringify(preview)).toBe(200);
  expect(preview.payload).toMatchObject({
    kind: "PLAN",
    policy: "manifest-v1",
    published: false,
    result: {},
  });
  expect((await (await call("/api/snapshot")).json()).items).toEqual([]);
  const published = await call("/api/v1/plans/publish", {
    id: preview.id,
    version: preview.version,
  });
  expect(published.status).toBe(200);
  const result = await published.json();
  expect(result.payload.published).toBe(true);
  const snapshot = await (await call("/api/snapshot")).json();
  expect(snapshot.items).toHaveLength(1);
  expect(snapshot.items[0]).toMatchObject({
    id: result.payload.result.task,
    title: "Reviewed plan",
    descriptionMd: "原文\n第二行",
  });
});
it("Note promotion replay rolls back missing relation effects and preserves original body and IDs", async () => {
  await login();
  const space = await (
    await call("/api/library/save", {
      id: null,
      version: 0,
      input: { kind: "SPACE", spaceId: null, title: "Promotion", bodyMd: "" },
    })
  ).json();
  const note = await (
    await call("/api/note/save", {
      id: null,
      version: 0,
      input: {
        kind: "NOTE",
        day: null,
        title: "Original capture",
        bodyMd: "第一行\n第二行\n[[Reference]]",
      },
    })
  ).json();
  const documentId = randomUUID(),
    linkId = randomUUID(),
    deviceId = randomUUID();
  const effects = [
    { collection: "library", id: documentId, op: "UPSERT", baseVersion: 0 },
    { collection: "links", id: linkId, op: "UPSERT", baseVersion: 0 },
    { collection: "notes", id: note.id, op: "UPSERT", baseVersion: 1 },
  ];
  const body = {
    id: note.id,
    version: 1,
    spaceId: space.id,
    parentDocumentId: null,
    archiveSourceNote: true,
    stableDocumentId: documentId,
    stableLinkId: linkId,
    deviceId,
  };
  const failedId = randomUUID();
  expect(
    (
      await call(
        "/api/v1/note/promote",
        {
          ...body,
          syncCommand: {
            commandId: failedId,
            deviceId,
            effects: effects.filter((e) => e.collection !== "notes"),
          },
        },
        { "Idempotency-Key": failedId },
      )
    ).status,
  ).toBe(409);
  expect(
    (await call(`/api/sync/receipt?commandId=${failedId}&deviceId=${deviceId}`))
      .status,
  ).toBe(404);
  const before = await (await call("/api/snapshot")).json();
  expect(before.library.some((e: { id: string }) => e.id === documentId)).toBe(
    false,
  );
  expect(before.links).toEqual([]);
  expect(before.notes.find((e: { id: string }) => e.id === note.id)).toEqual(
    note,
  );
  const commandId = randomUUID(),
    complete = { ...body, syncCommand: { commandId, deviceId, effects } };
  const response = await call("/api/v1/note/promote", complete, {
    "Idempotency-Key": commandId,
  });
  const receipt = await response.json();
  expect(response.status, JSON.stringify(receipt)).toBe(200);
  expect(receipt.result).toMatchObject({
    id: documentId,
    version: 1,
    title: note.title,
    bodyMd: note.bodyMd,
    provenance: note.provenance,
  });
  expect(receipt.effects).toHaveLength(3);
  expect(
    receipt.effects.find(
      (e: { collection: string }) => e.collection === "links",
    ).value,
  ).toMatchObject({
    id: linkId,
    from: { kind: "NOTE", id: note.id },
    to: { kind: "DOCUMENT", id: documentId },
  });
  expect(
    receipt.effects.find(
      (e: { collection: string }) => e.collection === "notes",
    ).value,
  ).toMatchObject({
    id: note.id,
    version: 2,
    bodyMd: note.bodyMd,
    deletedAt: expect.any(String),
  });
  expect(
    await (
      await call("/api/v1/note/promote", complete, {
        "Idempotency-Key": commandId,
      })
    ).json(),
  ).toEqual(receipt);
});
it("Linked knowledge original replay preserves identity and rolls back incomplete declarations", async () => {
  await login();
  const a = await (await call("/api/work/create", { title: "Link A" })).json(),
    b = await (await call("/api/work/create", { title: "Link B" })).json();
  const linkId = randomUUID(),
    deviceId = randomUUID(),
    rejectedId = randomUUID();
  const effect = {
    collection: "links",
    id: linkId,
    op: "UPSERT",
    baseVersion: 0,
  };
  const body = {
    from: { kind: "WORK", id: a.id },
    to: { kind: "WORK", id: b.id },
    relation: "REFERENCES",
    stableId: linkId,
    deviceId,
    syncCommand: {
      commandId: rejectedId,
      deviceId,
      effects: [effect, { ...effect, id: randomUUID() }],
    },
  };
  expect(
    (await call("/api/v1/link/create", body, { "Idempotency-Key": rejectedId }))
      .status,
  ).toBe(409);
  expect(
    (
      await call(
        `/api/sync/receipt?commandId=${rejectedId}&deviceId=${deviceId}`,
      )
    ).status,
  ).toBe(404);
  expect((await (await call("/api/snapshot")).json()).links).toEqual([]);
  const commandId = randomUUID(),
    complete = {
      ...body,
      syncCommand: { commandId, deviceId, effects: [effect] },
    };
  const response = await call("/api/v1/link/create", complete, {
      "Idempotency-Key": commandId,
    }),
    receipt = await response.json();
  expect(response.status, JSON.stringify(receipt)).toBe(200);
  expect(receipt.result).toMatchObject({
    id: linkId,
    version: 1,
    from: body.from,
    to: body.to,
  });
  expect(receipt.effects).toEqual([
    {
      collection: "links",
      id: linkId,
      op: "UPSERT",
      version: 1,
      value: receipt.result,
    },
  ]);
  expect(
    await (
      await call("/api/v1/link/create", complete, {
        "Idempotency-Key": commandId,
      })
    ).json(),
  ).toEqual(receipt);
  const deleteId = randomUUID(),
    deleted = await call(
      "/api/v1/link/delete",
      {
        id: linkId,
        version: 1,
        syncCommand: {
          commandId: deleteId,
          deviceId,
          effects: [{ ...effect, baseVersion: 1 }],
        },
      },
      { "Idempotency-Key": deleteId },
    );
  expect(deleted.status).toBe(200);
  const deletedReceipt = await deleted.json();
  expect(deletedReceipt.result).toMatchObject({
    id: linkId,
    version: 2,
    deletedAt: expect.any(String),
  });
  const delta = await (await call("/api/sync?after=0")).json();
  expect(delta.changes.collections.links.upserts).toContainEqual(
    deletedReceipt.result,
  );
  expect(delta.changes.collections.links.removed).not.toContain(linkId);
});
it("Recurrence lifecycle replay preserves generated task IDs, skip semantics and complete backfill version chains", async () => {
  await login();
  const deviceId = randomUUID(),
    today = new Date().toISOString().slice(0, 10),
    yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const create = async (startDate: string) =>
    (
      await call("/api/recurrences/save", {
        version: 0,
        deleted: false,
        rule: {
          title: "Lifecycle original",
          descriptionMd: "原文\n[[Target]]",
          startDate,
          timezone: "UTC",
          frequency: "DAILY",
          interval: 1,
        },
      })
    ).json();
  const effect = (collection: string, id: string, baseVersion: number) => ({
    collection,
    id,
    op: "UPSERT",
    baseVersion,
  });
  const replay = async (
    path: string,
    input: Record<string, unknown>,
    effects: ReturnType<typeof effect>[],
  ) => {
    const commandId = randomUUID(),
      body = { ...input, syncCommand: { commandId, deviceId, effects } };
    const response = await call(path, body, { "Idempotency-Key": commandId }),
      receipt = await response.json();
    expect(response.status, JSON.stringify(receipt)).toBe(200);
    expect(
      await (await call(path, body, { "Idempotency-Key": commandId })).json(),
    ).toEqual(receipt);
    return receipt;
  };
  const definition = await create(today),
    taskId = randomUUID(),
    occurrenceId = `occurrence:${definition.id}:${today}`;
  const generated = await replay(
    "/api/v1/recurrences/generate",
    { id: definition.id, version: 1, from: today, to: today },
    [effect("items", taskId, 0), effect("workflows", occurrenceId, 0)],
  );
  expect(
    generated.effects.find(
      (entry: { collection: string }) => entry.collection === "items",
    ).value,
  ).toMatchObject({
    id: taskId,
    version: 1,
    descriptionMd: "原文\n[[Target]]",
  });
  const skipped = await replay(
    "/api/v1/recurrences/skip",
    { id: occurrenceId, version: 1 },
    [effect("items", taskId, 1), effect("workflows", occurrenceId, 1)],
  );
  expect(skipped.result.payload).toMatchObject({ status: "SKIPPED", taskId });
  expect(
    skipped.effects.find(
      (entry: { collection: string }) => entry.collection === "items",
    ).value,
  ).toMatchObject({ version: 2, status: "CANCELED" });
  const missedDefinition = await create(yesterday),
    missedId = `occurrence:${missedDefinition.id}:${yesterday}`;
  const missed = await replay(
    "/api/v1/recurrences/generate",
    { id: missedDefinition.id, version: 1, from: yesterday, to: yesterday },
    [effect("workflows", missedId, 0)],
  );
  expect(missed.result[0].payload).toMatchObject({
    status: "MISSED",
    taskId: null,
  });
  const backfillId = randomUUID(),
    rejectedId = randomUUID(),
    completedAt = `${yesterday}T12:00:00.000Z`;
  const partial = {
    id: missedId,
    version: 1,
    completedAt,
    syncCommand: {
      commandId: rejectedId,
      deviceId,
      effects: [
        effect("items", backfillId, 0),
        effect("workflows", missedId, 1),
      ],
    },
  };
  expect(
    (
      await call("/api/v1/recurrences/backfill", partial, {
        "Idempotency-Key": rejectedId,
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await call(
        `/api/sync/receipt?commandId=${rejectedId}&deviceId=${deviceId}`,
      )
    ).status,
  ).toBe(404);
  const snapshot = await (await call("/api/snapshot")).json();
  expect(
    snapshot.items.some((entry: { id: string }) => entry.id === backfillId),
  ).toBe(false);
  expect(
    snapshot.workflows.find((entry: { id: string }) => entry.id === missedId),
  ).toMatchObject({ version: 1, payload: { status: "MISSED" } });
  const beforeBackfill = Date.now();
  const backfilled = await replay(
    "/api/v1/recurrences/backfill",
    { id: missedId, version: 1, completedAt },
    [
      effect("items", backfillId, 0),
      effect("items", backfillId, 1),
      effect("workflows", missedId, 1),
    ],
  );
  expect(backfilled.effects).toHaveLength(2);
  expect(
    backfilled.effects.find(
      (entry: { collection: string }) => entry.collection === "items",
    ).value,
  ).toMatchObject({ id: backfillId, version: 2, status: "DONE" });
  const taskCompletedAt = Date.parse(
    backfilled.effects.find(
      (entry: { collection: string }) => entry.collection === "items",
    ).value.completedAt,
  );
  expect(taskCompletedAt).toBeGreaterThanOrEqual(beforeBackfill);
  expect(taskCompletedAt).toBeLessThanOrEqual(Date.now());
  expect(
    backfilled.effects.find(
      (entry: { collection: string }) => entry.collection === "workflows",
    ).value,
  ).toMatchObject({
    version: 2,
    payload: { status: "BACKFILLED", taskId: backfillId, completedAt },
  });
});
it("Recurrence original save commits stable identity and rejects incomplete effects without a receipt", async () => {
  await login();
  const stableId = randomUUID(),
    deviceId = randomUUID(),
    rejectedId = randomUUID();
  const effect = {
    collection: "workflows",
    id: stableId,
    op: "UPSERT",
    baseVersion: 0,
  };
  const body = {
    stableId,
    deviceId,
    version: 0,
    deleted: false,
    rule: {
      title: "Original series",
      descriptionMd: "原文\r\n[[Target]]",
      startDate: "2026-10-14",
      timezone: "UTC",
      frequency: "DAILY",
      interval: 1,
      state: "PAUSED",
    },
    syncCommand: {
      commandId: rejectedId,
      deviceId,
      effects: [effect, { ...effect, id: randomUUID() }],
    },
  };
  expect(
    (
      await call("/api/v1/recurrences/save", body, {
        "Idempotency-Key": rejectedId,
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await call(
        `/api/sync/receipt?commandId=${rejectedId}&deviceId=${deviceId}`,
      )
    ).status,
  ).toBe(404);
  expect((await (await call("/api/snapshot")).json()).workflows).toEqual([]);
  const commandId = randomUUID(),
    complete = {
      ...body,
      syncCommand: { commandId, deviceId, effects: [effect] },
    };
  const response = await call("/api/v1/recurrences/save", complete, {
    "Idempotency-Key": commandId,
  });
  const receipt = await response.json();
  expect(response.status, JSON.stringify(receipt)).toBe(200);
  expect(receipt.result).toMatchObject({
    id: stableId,
    version: 1,
    payload: body.rule,
  });
  expect(receipt.effects).toEqual([
    {
      collection: "workflows",
      id: stableId,
      op: "UPSERT",
      version: 1,
      value: receipt.result,
    },
  ]);
  expect(
    await (
      await call("/api/v1/recurrences/save", complete, {
        "Idempotency-Key": commandId,
      })
    ).json(),
  ).toEqual(receipt);
});
it("Project knowledge original replay preserves both IDs and rolls back incomplete library declarations", async () => {
  await login();
  const project = await (
    await call("/api/work/create", { title: "Replay project", type: "PROJECT" })
  ).json();
  const deviceId = randomUUID(),
    materialId = randomUUID(),
    targetId = randomUUID(),
    rejectedId = randomUUID();
  const materialEffect = {
    collection: "projectMaterials",
    id: materialId,
    op: "UPSERT",
    baseVersion: 0,
  };
  const body = {
    projectId: project.id,
    title: "Original space",
    stableMaterialId: materialId,
    stableTargetId: targetId,
    deviceId,
    syncCommand: { commandId: rejectedId, deviceId, effects: [materialEffect] },
  };
  expect(
    (
      await call("/api/v1/projects/space/create", body, {
        "Idempotency-Key": rejectedId,
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await call(
        `/api/sync/receipt?commandId=${rejectedId}&deviceId=${deviceId}`,
      )
    ).status,
  ).toBe(404);
  const before = await (await call("/api/snapshot")).json();
  expect(before.projectMaterials).toEqual([]);
  expect(before.library).toEqual([]);
  const commandId = randomUUID();
  const complete = {
    ...body,
    syncCommand: {
      commandId,
      deviceId,
      effects: [
        materialEffect,
        { collection: "library", id: targetId, op: "UPSERT", baseVersion: 0 },
      ],
    },
  };
  const response = await call("/api/v1/projects/space/create", complete, {
    "Idempotency-Key": commandId,
  });
  const receipt = await response.json();
  expect(response.status, JSON.stringify(receipt)).toBe(200);
  expect(receipt.result).toMatchObject({
    id: materialId,
    spaceId: targetId,
    version: 1,
  });
  expect(receipt.effects).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        collection: "projectMaterials",
        id: materialId,
        version: 1,
      }),
      expect.objectContaining({
        collection: "library",
        id: targetId,
        version: 1,
      }),
    ]),
  );
  expect(
    await (
      await call("/api/v1/projects/space/create", complete, {
        "Idempotency-Key": commandId,
      })
    ).json(),
  ).toEqual(receipt);
  const snapshot = await (await call("/api/snapshot")).json();
  expect(snapshot.projectMaterials).toHaveLength(1);
  expect(snapshot.library).toHaveLength(1);
});
it("Organization original replay commits complete batches and rolls back partial declarations without receipts", async () => {
  await login();
  const a = await (
    await call("/api/work/create", { title: "Organization A" })
  ).json();
  const b = await (
    await call("/api/work/create", { title: "Organization B" })
  ).json();
  const deviceId = randomUUID();
  const entries = [a, b].map((item) => ({
    id: item.id,
    version: 1,
    organizationVersion: 0,
  }));
  const commandId = randomUUID();
  const effects = entries.map((entry) => ({
    collection: "organization",
    id: `WORK:${entry.id}`,
    op: "UPSERT",
    baseVersion: 0,
  }));
  const body = {
    kind: "WORK",
    action: "archive",
    entries,
    syncCommand: { commandId, deviceId, effects },
  };
  const headers = { "Idempotency-Key": commandId };
  const response = await call("/api/v1/organize", body, headers);
  const receipt = await response.json();
  expect(response.status, JSON.stringify(receipt)).toBe(200);
  expect(receipt.effects).toHaveLength(2);
  expect(receipt.effects[0]).toMatchObject({
    id: `WORK:${a.id}`,
    version: 1,
    value: { id: a.id, kind: "WORK", archived: true },
  });
  expect(await (await call("/api/v1/organize", body, headers)).json()).toEqual(
    receipt,
  );
  const invalidId = randomUUID();
  expect(
    (
      await call(
        "/api/v1/organize",
        {
          kind: "WORK",
          action: "unarchive",
          entries: entries.map((entry) => ({
            ...entry,
            organizationVersion: 1,
          })),
          syncCommand: {
            commandId: invalidId,
            deviceId,
            effects: [{ ...effects[0], baseVersion: 1 }],
          },
        },
        { "Idempotency-Key": invalidId },
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await call(
        `/api/sync/receipt?commandId=${invalidId}&deviceId=${deviceId}`,
      )
    ).status,
  ).toBe(404);
  const snapshot = await (await call("/api/snapshot")).json();
  expect(snapshot.organization).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: a.id, archived: true, version: 1 }),
      expect.objectContaining({ id: b.id, archived: true, version: 1 }),
    ]),
  );
  expect(snapshot.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: a.id, version: 1 }),
      expect.objectContaining({ id: b.id, version: 1 }),
    ]),
  );
});
it("Category original replay preserves stable IDs and complete reorder receipts with partial-effect rollback", async () => {
  await login();
  const deviceId = randomUUID(),
    aId = randomUUID(),
    bId = randomUUID();
  for (const [id, name] of [
    [aId, "Category A"],
    [bId, "Category B"],
  ]) {
    const commandId = randomUUID();
    const body = {
        version: 0,
        name,
        deleted: false,
        stableId: id,
        deviceId,
        syncCommand: {
          commandId,
          deviceId,
          effects: [
            { collection: "categories", id, op: "UPSERT", baseVersion: 0 },
          ],
        },
      },
      headers = { "Idempotency-Key": commandId };
    const response = await call("/api/v1/categories/save", body, headers),
      receipt = await response.json();
    expect(response.status, JSON.stringify(receipt)).toBe(200);
    expect(receipt.result).toMatchObject({ id, name, version: 1 });
    expect(
      await (await call("/api/v1/categories/save", body, headers)).json(),
    ).toEqual(receipt);
  }
  const commandId = randomUUID(),
    ordered = [
      { id: bId, version: 1 },
      { id: aId, version: 1 },
    ];
  const body = {
      ordered,
      syncCommand: {
        commandId,
        deviceId,
        effects: ordered.map((member) => ({
          collection: "categories",
          id: member.id,
          op: "UPSERT",
          baseVersion: member.version,
        })),
      },
    },
    headers = { "Idempotency-Key": commandId };
  const response = await call("/api/v1/categories/reorder", body, headers),
    receipt = await response.json();
  expect(response.status, JSON.stringify(receipt)).toBe(200);
  expect(
    receipt.result.map(
      (value: { id: string; position: number; version: number }) => [
        value.id,
        value.position,
        value.version,
      ],
    ),
  ).toEqual([
    [bId, 1024, 2],
    [aId, 2048, 2],
  ]);
  expect(receipt.effects).toHaveLength(2);
  expect(
    await (
      await call(
        `/api/v1/sync/receipt?commandId=${commandId}&deviceId=${deviceId}`,
      )
    ).json(),
  ).toEqual(receipt);
  const partialId = randomUUID();
  expect(
    (
      await call(
        "/api/v1/categories/reorder",
        {
          ordered: [
            { id: aId, version: 2 },
            { id: bId, version: 2 },
          ],
          syncCommand: {
            commandId: partialId,
            deviceId,
            effects: [
              {
                collection: "categories",
                id: aId,
                op: "UPSERT",
                baseVersion: 2,
              },
            ],
          },
        },
        { "Idempotency-Key": partialId },
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await call(
        `/api/v1/sync/receipt?commandId=${partialId}&deviceId=${deviceId}`,
      )
    ).status,
  ).toBe(404);
  const snapshot = await (await call("/api/snapshot")).json();
  expect(
    snapshot.categories
      .map((value: { id: string; position: number; version: number }) => [
        value.id,
        value.position,
        value.version,
      ])
      .sort(),
  ).toEqual(
    [
      [bId, 1024, 2],
      [aId, 2048, 2],
    ].sort(),
  );
});
it("Manual order replay keeps original placement receipt and rejects stale aggregate scope versions", async () => {
  await login();
  const a = await create("Order A"),
    b = await create("Order B"),
    commandId = randomUUID(),
    deviceId = randomUUID();
  const input = {
    scope: { kind: "WORKSPACE_TASKS" },
    version: 0,
    entityId: b.id,
    anchorId: a.id,
    placement: "BEFORE",
  };
  const body = {
      ...input,
      syncCommand: {
        commandId,
        deviceId,
        effects: [
          {
            collection: "manualOrders",
            id: "WORKSPACE_TASKS",
            op: "UPSERT",
            baseVersion: 0,
          },
        ],
      },
    },
    headers = { "Idempotency-Key": commandId };
  const response = await call("/api/v1/manual-orders/move", body, headers),
    receipt = await response.json();
  expect(response.status, JSON.stringify(receipt)).toBe(200);
  expect(
    receipt.result.entries.map((entry: { entityId: string }) => entry.entityId),
  ).toEqual([b.id, a.id]);
  expect(receipt.effects).toEqual([
    {
      collection: "manualOrders",
      id: "WORKSPACE_TASKS",
      op: "UPSERT",
      version: 1,
      value: receipt.result,
    },
  ]);
  expect(
    await (await call("/api/v1/manual-orders/move", body, headers)).json(),
  ).toEqual(receipt);
  expect(
    (
      await call("/api/manual-orders/move", {
        ...input,
        version: 1,
        entityId: a.id,
        anchorId: b.id,
      })
    ).status,
  ).toBe(200);
  const staleId = randomUUID();
  expect(
    (
      await call(
        "/api/v1/manual-orders/move",
        {
          ...input,
          version: 1,
          syncCommand: {
            commandId: staleId,
            deviceId,
            effects: [
              {
                collection: "manualOrders",
                id: "WORKSPACE_TASKS",
                op: "UPSERT",
                baseVersion: 1,
              },
            ],
          },
        },
        { "Idempotency-Key": staleId },
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await call(
        `/api/v1/sync/receipt?commandId=${staleId}&deviceId=${deviceId}`,
      )
    ).status,
  ).toBe(404);
  expect(
    await (
      await call(
        `/api/v1/sync/receipt?commandId=${commandId}&deviceId=${deviceId}`,
      )
    ).json(),
  ).toEqual(receipt);
  const snapshot = await (await call("/api/snapshot")).json();
  expect(snapshot.manualOrders[0].version).toBe(2);
  expect(
    snapshot.manualOrders[0].entries.map(
      (entry: { entityId: string }) => entry.entityId,
    ),
  ).toEqual([a.id, b.id]);
});
it("Navigation replay rejects foreign principal effects and preserves its original account-bound receipt", async () => {
  await login();
  const session = await (await call("/api/session")).json();
  const snapshot = await (await call("/api/snapshot")).json();
  const commandId = randomUUID(),
    deviceId = randomUUID(),
    preference = snapshot.navigationPreference;
  const body = {
    ...preference,
    syncCommand: {
      commandId,
      deviceId,
      effects: [
        {
          collection: "navigationPreference",
          id: session.context.principalId,
          op: "UPSERT",
          baseVersion: preference.version,
        },
      ],
    },
  };
  const headers = { "Idempotency-Key": commandId };
  const response = await call(
    "/api/v1/work/navigation-preference",
    body,
    headers,
  );
  const receipt = await response.json();
  expect(response.status, JSON.stringify(receipt)).toBe(200);
  expect(receipt.effects).toEqual([
    {
      collection: "navigationPreference",
      id: session.context.principalId,
      op: "UPSERT",
      version: preference.version + 1,
      value: receipt.result,
    },
  ]);
  expect(
    await (
      await call("/api/v1/work/navigation-preference", body, headers)
    ).json(),
  ).toEqual(receipt);
  expect(
    await (
      await call(
        `/api/v1/sync/receipt?commandId=${commandId}&deviceId=${deviceId}`,
      )
    ).json(),
  ).toEqual(receipt);
  const foreignId = randomUUID();
  expect(
    (
      await call(
        "/api/v1/work/navigation-preference",
        {
          ...receipt.result,
          syncCommand: {
            commandId: foreignId,
            deviceId,
            effects: [
              {
                collection: "navigationPreference",
                id: "foreign-account",
                op: "UPSERT",
                baseVersion: receipt.result.version,
              },
            ],
          },
        },
        { "Idempotency-Key": foreignId },
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await call(
        `/api/v1/sync/receipt?commandId=${foreignId}&deviceId=${deviceId}`,
      )
    ).status,
  ).toBe(404);
  expect(
    (await (await call("/api/snapshot")).json()).navigationPreference,
  ).toEqual(receipt.result);
});
it("Calendar original replay preserves singleton shape and exact cached receipt after a remote edit", async () => {
  await login();
  const commandId = randomUUID(),
    deviceId = randomUUID();
  const body = {
    version: 0,
    timezone: "Asia/Shanghai",
    syncCommand: {
      commandId,
      deviceId,
      effects: [
        {
          collection: "calendarSettings",
          id: "workspace",
          op: "UPSERT",
          baseVersion: 0,
        },
      ],
    },
  };
  const headers = { "Idempotency-Key": commandId };
  const response = await call("/api/v1/work/calendar-settings", body, headers);
  const receipt = await response.json();
  expect(response.status, JSON.stringify(receipt)).toBe(200);
  expect(receipt).toEqual({
    commandId,
    deviceId,
    result: { version: 1, timezone: "Asia/Shanghai" },
    effects: [
      {
        collection: "calendarSettings",
        id: "workspace",
        op: "UPSERT",
        version: 1,
        value: { version: 1, timezone: "Asia/Shanghai" },
      },
    ],
  });
  expect(
    (await call("/api/work/calendar-settings", { version: 1, timezone: "UTC" }))
      .status,
  ).toBe(200);
  expect(
    await (await call("/api/v1/work/calendar-settings", body, headers)).json(),
  ).toEqual(receipt);
  expect(
    await (
      await call(
        `/api/v1/sync/receipt?commandId=${commandId}&deviceId=${deviceId}`,
      )
    ).json(),
  ).toEqual(receipt);
  const staleId = randomUUID();
  expect(
    (
      await call(
        "/api/v1/work/calendar-settings",
        {
          version: 1,
          timezone: "Asia/Tokyo",
          syncCommand: {
            commandId: staleId,
            deviceId,
            effects: [
              {
                collection: "calendarSettings",
                id: "workspace",
                op: "UPSERT",
                baseVersion: 1,
              },
            ],
          },
        },
        { "Idempotency-Key": staleId },
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await call(
        `/api/v1/sync/receipt?commandId=${staleId}&deviceId=${deviceId}`,
      )
    ).status,
  ).toBe(404);
  const snapshot = await (await call("/api/snapshot")).json();
  expect(snapshot.calendarSettings).toEqual({ version: 2, timezone: "UTC" });
});
it("Reminder original replay has stable identity, durable receipt, duplicate safety and stale-version rejection", async () => {
  await login();
  const stableId = randomUUID(),
    deviceId = randomUUID(),
    commandId = randomUUID();
  const input = {
    title: "Offline reminder",
    bodyMd: "第一行\n第二行",
    day: "2026-10-14",
    time: "10:30",
    timezone: "Asia/Shanghai",
    notifyMode: "MINUTES_BEFORE",
    notifyOffsetMinutes: 15,
    linkedProjectId: null,
    linkedTaskId: null,
    state: "ACTIVE",
  };
  const body = {
    id: null,
    version: 0,
    stableId,
    deviceId,
    input,
    deleted: false,
    syncCommand: {
      commandId,
      deviceId,
      effects: [
        { collection: "reminders", id: stableId, op: "UPSERT", baseVersion: 0 },
      ],
    },
  };
  const headers = { "Idempotency-Key": commandId };
  const response = await call("/api/v1/reminders/save", body, headers);
  const receipt = await response.json();
  expect(response.status, JSON.stringify(receipt)).toBe(200);
  expect(receipt.result).toMatchObject({ id: stableId, version: 1, ...input });
  expect(receipt.effects).toEqual([
    {
      collection: "reminders",
      id: stableId,
      op: "UPSERT",
      version: 1,
      value: receipt.result,
    },
  ]);
  expect(
    await (await call("/api/v1/reminders/save", body, headers)).json(),
  ).toEqual(receipt);
  expect(
    await (
      await call(
        `/api/v1/sync/receipt?commandId=${commandId}&deviceId=${deviceId}`,
      )
    ).json(),
  ).toEqual(receipt);
  expect(
    (
      await call(
        `/api/v1/sync/receipt?commandId=${commandId}&deviceId=${randomUUID()}`,
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await call("/api/reminders/save", {
        id: stableId,
        version: 1,
        input: { ...input, state: "DONE" },
      })
    ).status,
  ).toBe(200);
  const staleId = randomUUID();
  expect(
    (
      await call(
        "/api/v1/reminders/save",
        {
          id: stableId,
          version: 1,
          input,
          syncCommand: {
            commandId: staleId,
            deviceId,
            effects: [
              {
                collection: "reminders",
                id: stableId,
                op: "UPSERT",
                baseVersion: 1,
              },
            ],
          },
        },
        { "Idempotency-Key": staleId },
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await call(
        `/api/v1/sync/receipt?commandId=${staleId}&deviceId=${deviceId}`,
      )
    ).status,
  ).toBe(404);
  expect(
    await (await call("/api/v1/reminders/save", body, headers)).json(),
  ).toEqual(receipt);
  const snapshot = await (await call("/api/snapshot")).json();
  expect(
    snapshot.reminders.find((value: { id: string }) => value.id === stableId),
  ).toMatchObject({ version: 2, state: "DONE" });
});
it("knowledge replay retains stable Note and Document IDs, canonical receipts and stale-version safety", async () => {
  await login();
  const deviceId = randomUUID();
  const spaceResponse = await call("/api/library/save", {
    id: null,
    version: 0,
    input: {
      kind: "SPACE",
      spaceId: null,
      title: "Knowledge scope",
      bodyMd: "",
    },
  });
  expect(spaceResponse.status).toBe(200);
  const space = await spaceResponse.json();
  for (const kind of ["note", "library"] as const) {
    const stableId = randomUUID(),
      commandId = randomUUID();
    const input =
      kind === "note"
        ? {
            title: "Offline note",
            kind: "NOTE",
            day: null,
            bodyMd: "第一行\n第二行\n",
          }
        : {
            title: "Offline document",
            kind: "DOCUMENT",
            spaceId: space.id,
            bodyMd: "第一行\n第二行\n",
          };
    const collection = kind === "note" ? "notes" : "library";
    const body = {
      id: null,
      version: 0,
      stableId,
      deviceId,
      input,
      syncCommand: {
        commandId,
        deviceId,
        effects: [{ collection, id: stableId, op: "UPSERT", baseVersion: 0 }],
      },
    };
    const headers = { "Idempotency-Key": commandId };
    const response = await call(`/api/v1/${kind}/save`, body, headers);
    const receipt = await response.json();
    expect(response.status, JSON.stringify(receipt)).toBe(200);
    expect(receipt.result).toMatchObject({
      id: stableId,
      version: 1,
      bodyMd: input.bodyMd,
      provenance: "HUMAN",
    });
    expect(receipt.effects).toEqual([
      expect.objectContaining({
        collection,
        id: stableId,
        version: 1,
        value: expect.objectContaining({ bodyMd: input.bodyMd }),
      }),
    ]);
    expect(
      await (await call(`/api/v1/${kind}/save`, body, headers)).json(),
    ).toEqual(receipt);
    expect(
      await (
        await call(
          `/api/v1/sync/receipt?commandId=${commandId}&deviceId=${deviceId}`,
        )
      ).json(),
    ).toEqual(receipt);
    const remote = await call(`/api/${kind}/save`, {
      id: stableId,
      version: 1,
      input: { ...input, title: "Remote edited" },
    });
    expect(remote.status).toBe(200);
    const staleCommandId = randomUUID();
    const stale = await call(
      `/api/v1/${kind}/save`,
      {
        id: stableId,
        version: 1,
        input: { ...input, title: "Must not overwrite" },
        syncCommand: {
          commandId: staleCommandId,
          deviceId,
          effects: [{ collection, id: stableId, op: "UPSERT", baseVersion: 1 }],
        },
      },
      { "Idempotency-Key": staleCommandId },
    );
    expect(stale.status).toBe(409);
    expect(
      (
        await call(
          `/api/v1/sync/receipt?commandId=${staleCommandId}&deviceId=${deviceId}`,
        )
      ).status,
    ).toBe(404);
    expect(
      await (await call(`/api/v1/${kind}/save`, body, headers)).json(),
    ).toEqual(receipt);
    const snapshot = await (await call("/api/snapshot")).json();
    expect(
      snapshot[collection].find(
        (value: { id: string }) => value.id === stableId,
      ),
    ).toMatchObject({
      version: 2,
      title: "Remote edited",
      bodyMd: input.bodyMd,
    });
    const extraCommandId = randomUUID();
    const extra = await call(
      `/api/v1/${kind}/save`,
      {
        id: stableId,
        version: 2,
        input: { ...input, title: "Rolled back" },
        syncCommand: {
          commandId: extraCommandId,
          deviceId,
          effects: [
            { collection, id: stableId, op: "UPSERT", baseVersion: 2 },
            { collection, id: randomUUID(), op: "UPSERT", baseVersion: 0 },
          ],
        },
      },
      { "Idempotency-Key": extraCommandId },
    );
    expect(extra.status).toBe(409);
    expect(
      (
        await call(
          `/api/v1/sync/receipt?commandId=${extraCommandId}&deviceId=${deviceId}`,
        )
      ).status,
    ).toBe(404);
    const afterRollback = await (await call("/api/snapshot")).json();
    expect(
      afterRollback[collection].find(
        (value: { id: string }) => value.id === stableId,
      ),
    ).toMatchObject({ version: 2, title: "Remote edited" });
    expect(
      (
        await call(
          `/api/v1/${kind}/save`,
          { ...body, deviceId: randomUUID() },
          { "Idempotency-Key": randomUUID() },
        )
      ).status,
    ).toBe(409);
  }
});

it("guarded deletion receipt supplies a null versioned tombstone and replays exact canonical data", async () => {
  await login();
  const a = await create("A"),
    b = await create("B");
  const edge = await (
    await call("/api/edge/create", { fromId: a.id, toId: b.id })
  ).json();
  const commandId = randomUUID(),
    deviceId = randomUUID();
  const body = {
    id: edge.id,
    syncCommand: {
      commandId,
      deviceId,
      effects: [
        { collection: "edges", id: edge.id, op: "DELETE", baseVersion: 1 },
      ],
    },
  };
  const headers = { "Idempotency-Key": commandId };
  const response = await call("/api/v1/edge/delete", body, headers);
  expect(response.status).toBe(200);
  const receipt = await response.json();
  expect(receipt).toEqual({
    commandId,
    deviceId,
    result: null,
    effects: [
      {
        collection: "edges",
        id: edge.id,
        op: "DELETE",
        version: 2,
        value: null,
      },
    ],
  });
  expect((await (await call("/api/snapshot")).json()).edges).toHaveLength(0);
  const events = await host.db.inspectEvents(a.workspaceId);
  const repeated = await call("/api/v1/edge/delete", body, headers);
  expect(repeated.status).toBe(200);
  expect(await repeated.json()).toEqual(receipt);
  expect(await host.db.inspectEvents(a.workspaceId)).toEqual(events);
});

it("cached canonical replay receipts never replace original accepted values with newer remote edits", async () => {
  await login();
  const task = await create("Before");
  const commandId = randomUUID(),
    deviceId = randomUUID();
  const body = {
    id: task.id,
    version: task.version,
    input: { title: "Accepted" },
    syncCommand: {
      commandId,
      deviceId,
      effects: [
        {
          collection: "items",
          id: task.id,
          op: "UPSERT",
          baseVersion: task.version,
        },
      ],
    },
  };
  const headers = { "Idempotency-Key": commandId };
  const first = await call("/api/v1/work/update", body, headers);
  expect(first.status).toBe(200);
  const receipt = await first.json();
  expect(receipt.effects[0]).toMatchObject({
    version: 2,
    value: { title: "Accepted", version: 2 },
  });
  expect(
    (
      await call("/api/work/update", {
        id: task.id,
        version: 2,
        input: { title: "Newer remote" },
      })
    ).status,
  ).toBe(200);
  const events = await host.db.inspectEvents(task.workspaceId);
  const repeated = await call("/api/v1/work/update", body, headers);
  expect(repeated.status).toBe(200);
  expect(await repeated.json()).toEqual(receipt);
  expect(await host.db.inspectEvents(task.workspaceId)).toEqual(events);
  expect(
    (await (await call("/api/snapshot")).json()).items.find(
      (item: { id: string }) => item.id === task.id,
    ),
  ).toMatchObject({ title: "Newer remote", version: 3 });
});

it("logical replay refuses malformed, foreign, tool and unsupported envelopes atomically", async () => {
  await login();
  const task = await create("Task");
  const commandId = randomUUID();
  const envelope = {
    commandId,
    deviceId: randomUUID(),
    effects: [
      {
        collection: "items",
        id: task.id,
        op: "UPSERT",
        baseVersion: task.version,
      },
    ],
  };
  const body = {
    id: task.id,
    version: task.version,
    input: { title: "Changed" },
    syncCommand: envelope,
  };
  const headers = { "Idempotency-Key": commandId };
  const token = await (
    await call("/api/tokens/create", { name: "Write", scope: "write" })
  ).json();
  const baseline = await (await call("/api/snapshot")).json();
  const events = await host.db.inspectEvents(task.workspaceId);
  for (const syncCommand of [
    { ...envelope, workspaceId: "foreign" },
    { ...envelope, principalId: "foreign" },
    { ...envelope, deviceId: "invalid" },
    { ...envelope, effects: [] },
    {
      ...envelope,
      effects: [{ ...envelope.effects[0], payload: { title: "Injected" } }],
    },
    { ...envelope, effects: [{ ...envelope.effects[0], baseVersion: -1 }] },
  ])
    expect(
      (await call("/api/v1/work/update", { ...body, syncCommand }, headers))
        .status,
    ).toBe(400);
  expect(
    (
      await call("/api/v1/work/update", body, {
        ...headers,
        "X-CSRF-Token": "invalid",
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await call("/api/v1/work/update", body, {
        ...headers,
        Cookie: "",
        Authorization: "Bearer " + token.secret,
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await call(
        "/api/v1/work/update",
        { ...body, syncCommand: { ...envelope, commandId: randomUUID() } },
        headers,
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await call(
        "/api/v1/work/purge",
        { id: task.id, version: task.version, syncCommand: envelope },
        headers,
      )
    ).status,
  ).toBe(400);
  // The declared extra write never occurs: final validation must roll back the title and audit.
  expect(
    (
      await call(
        "/api/v1/work/update",
        {
          ...body,
          syncCommand: {
            ...envelope,
            effects: [
              ...envelope.effects,
              { ...envelope.effects[0], baseVersion: task.version + 1 },
            ],
          },
        },
        headers,
      )
    ).status,
  ).toBe(409);
  expect(await (await call("/api/snapshot")).json()).toEqual(baseline);
  expect(await host.db.inspectEvents(task.workspaceId)).toEqual(events);
});

it("authenticated logical project replay rejects unexpected remote cascades and commits one receipt", async () => {
  await login();
  const project = await (
    await call("/api/work/create", {
      title: "Project",
      type: "PROJECT",
      lifecycle: "ACTIVE",
    })
  ).json();
  const task = await (
    await call("/api/work/create", {
      title: "Original",
      projectIds: [project.id],
    })
  ).json();
  const extra = await (
    await call("/api/work/create", {
      title: "Remote addition",
      projectIds: [project.id],
    })
  ).json();
  const commandId = randomUUID();
  const body = {
    id: project.id,
    version: project.version,
    input: {
      projectLifecycle: "COMPLETED",
      completionResolution: { action: "INBOX" },
    },
    syncCommand: {
      commandId,
      deviceId: randomUUID(),
      effects: [project, task].map((item) => ({
        collection: "items",
        id: item.id,
        op: "UPSERT",
        baseVersion: item.version,
      })),
    },
  };
  const headers = { "Idempotency-Key": commandId };
  const baseline = await (await call("/api/snapshot")).json();
  const events = await host.db.inspectEvents(project.workspaceId);
  expect((await call("/api/v1/work/update", body, headers)).status).toBe(409);
  expect(await (await call("/api/snapshot")).json()).toEqual(baseline);
  expect(await host.db.inspectEvents(project.workspaceId)).toEqual(events);
  // Remove the unexpected remote membership through the ordinary authorized service.
  expect(
    (
      await call("/api/work/update", {
        id: extra.id,
        version: extra.version,
        input: { projectIds: [] },
      })
    ).status,
  ).toBe(200);
  const accepted = await call("/api/v1/work/update", body, headers);
  expect(accepted.status).toBe(200);
  const result = await accepted.json();
  expect(result.commandId).toBe(commandId);
  expect(result.deviceId).toBe(body.syncCommand.deviceId);
  expect(result.result.lifecycle).toBe("COMPLETED");
  expect(result.effects).toHaveLength(2);
  expect(result.effects).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        collection: "items",
        id: project.id,
        op: "UPSERT",
        version: project.version + 1,
        value: expect.objectContaining({
          lifecycle: "COMPLETED",
          workspaceId: project.workspaceId,
        }),
      }),
      expect.objectContaining({
        collection: "items",
        id: task.id,
        op: "UPSERT",
        version: task.version + 1,
        value: expect.objectContaining({
          projectIds: [],
          workspaceId: project.workspaceId,
        }),
      }),
    ]),
  );
  const acceptedEvents = await host.db.inspectEvents(project.workspaceId);
  const duplicate = await call("/api/v1/work/update", body, headers);
  expect(duplicate.status).toBe(200);
  expect(await duplicate.json()).toEqual(result);
  expect(await host.db.inspectEvents(project.workspaceId)).toEqual(
    acceptedEvents,
  );
  expect(
    (
      await call(
        "/api/v1/work/update",
        {
          ...body,
          syncCommand: { ...body.syncCommand, deviceId: randomUUID() },
        },
        headers,
      )
    ).status,
  ).toBe(409);
  expect(await host.db.inspectEvents(project.workspaceId)).toEqual(
    acceptedEvents,
  );
});

it("logical Work creation preserves stable prerequisite edge IDs and server audit ownership", async () => {
  await login();
  const prerequisite = await create("Prerequisite");
  const commandId = randomUUID(),
    stableId = randomUUID(),
    edgeId = randomUUID(),
    deviceId = randomUUID();
  const body = {
    title: "Offline dependent",
    prerequisiteIds: [prerequisite.id],
    stableId,
    deviceId,
    syncCommand: {
      commandId,
      deviceId,
      effects: [
        { collection: "items", id: stableId, op: "UPSERT", baseVersion: 0 },
        { collection: "edges", id: edgeId, op: "UPSERT", baseVersion: 0 },
      ],
    },
  };
  const response = await call("/api/v1/work/create", body, {
    "Idempotency-Key": commandId,
  });
  expect(response.status).toBe(200);
  const receipt = await response.json();
  expect(receipt).toMatchObject({
    commandId,
    deviceId,
    result: { id: stableId, createdBy: prerequisite.createdBy, version: 1 },
  });
  expect(receipt.effects).toHaveLength(2);
  expect(receipt.effects).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        collection: "items",
        id: stableId,
        version: 1,
        value: expect.objectContaining({
          id: stableId,
          createdBy: prerequisite.createdBy,
        }),
      }),
      expect.objectContaining({
        collection: "edges",
        id: edgeId,
        version: 1,
        value: expect.objectContaining({
          id: edgeId,
          fromId: prerequisite.id,
          toId: stableId,
        }),
      }),
    ]),
  );
  const snapshot = await (await call("/api/snapshot")).json();
  expect(snapshot.edges).toEqual([
    expect.objectContaining({
      id: edgeId,
      fromId: prerequisite.id,
      toId: stableId,
    }),
  ]);
  const events = await host.db.inspectEvents(prerequisite.workspaceId);
  expect(
    events.activity.every(
      (event) =>
        event.id !== commandId && event.id !== stableId && event.id !== edgeId,
    ),
  ).toBe(true);
});

it("stable offline edge preserves identity and device receipt without duplicate events", async () => {
  await login();
  const a = await create("A");
  const b = await create("B");
  const input = {
    fromId: a.id,
    toId: b.id,
    type: "BLOCKS",
    stableId: randomUUID(),
    deviceId: randomUUID(),
  };
  const headers = { "Idempotency-Key": randomUUID() };
  const response = await call("/api/v1/edge/create", input, headers);
  expect(response.status).toBe(200);
  const edge = await response.json();
  expect(edge).toMatchObject({
    id: input.stableId,
    workspaceId: a.workspaceId,
    fromId: a.id,
    toId: b.id,
  });
  const events = await host.db.inspectEvents(a.workspaceId);
  const repeated = await call("/api/v1/edge/create", input, headers);
  expect(repeated.status).toBe(200);
  expect(await repeated.json()).toEqual(edge);
  expect(await host.db.inspectEvents(a.workspaceId)).toEqual(events);
  expect(
    (
      await call(
        "/api/v1/edge/create",
        { ...input, deviceId: randomUUID() },
        headers,
      )
    ).status,
  ).toBe(409);
  const cycle = await call("/api/v1/edge/create", {
    ...input,
    fromId: b.id,
    toId: a.id,
    stableId: randomUUID(),
  });
  expect(cycle.status).toBe(409);
  expect(await host.db.inspectEvents(a.workspaceId)).toEqual(events);
});

it("stable edge replay requires paired UUIDs and human session CSRF", async () => {
  await login();
  const a = await create("A");
  const b = await create("B");
  const input = {
    fromId: a.id,
    toId: b.id,
    stableId: randomUUID(),
    deviceId: randomUUID(),
  };
  for (const invalid of [
    { fromId: a.id, toId: b.id, stableId: input.stableId },
    { fromId: a.id, toId: b.id, deviceId: input.deviceId },
    { ...input, stableId: "invalid" },
    { ...input, deviceId: "invalid" },
    { ...input, workspaceId: "foreign" },
  ])
    expect((await call("/api/v1/edge/create", invalid)).status).toBe(400);
  expect(
    (await call("/api/v1/edge/create", input, { "X-CSRF-Token": "invalid" }))
      .status,
  ).toBe(403);
  const credential = await (
    await call("/api/tokens/create", {
      name: "Write capability",
      scope: "write",
    })
  ).json();
  expect(
    (
      await call("/api/v1/edge/create", input, {
        Cookie: "",
        Authorization: "Bearer " + credential.secret,
      })
    ).status,
  ).toBe(403);
  expect((await (await call("/api/snapshot")).json()).edges).toHaveLength(0);
});

it("reviewed workspace mutation rejects stale targets and safely retries an accepted import step", async () => {
  await login();
  const initial = await (await call("/api/sync?after=0")).json();
  const input = {
    title: "Reviewed",
    stableId: randomUUID(),
    deviceId: randomUUID(),
  };
  const headers = {
    "Idempotency-Key": randomUUID(),
    "X-Workspace-Precondition": JSON.stringify({
      epoch: initial.epoch,
      cursor: initial.cursor,
    }),
  };
  const first = await call("/api/v1/work/create", input, headers);
  expect(first.status).toBe(200);
  const accepted = await first.json();
  expect(accepted.workspaceRevision.epoch).toBe(initial.epoch);
  expect(accepted.workspaceRevision.cursor).toBeGreaterThan(initial.cursor);
  const later = await create("Later remote change");
  expect(
    await (await call("/api/v1/work/create", input, headers)).json(),
  ).toEqual(accepted);
  expect(
    (
      await call(
        "/api/v1/work/create",
        { ...input, stableId: randomUUID() },
        {
          ...headers,
          "Idempotency-Key": randomUUID(),
        },
      )
    ).status,
  ).toBe(409);
  for (const invalid of [
    "not-json",
    "[]",
    '{"epoch":"x","cursor":-1}',
    '{"epoch":"x","cursor":0,"extra":true}',
  ]) {
    expect(
      (
        await call("/api/v1/work/create", input, {
          "X-Workspace-Precondition": invalid,
        })
      ).status,
    ).toBe(400);
  }
  const snapshot = await (await call("/api/snapshot")).json();
  expect(snapshot.items.map((item: { id: string }) => item.id)).toEqual([
    accepted.result.id,
    later.id,
  ]);
});

it("durable import checkpoints resume original formal Host receipts after a lost successful response", async () => {
  await login();
  const baseline = await create("Existing remote task");
  const head = await (await call("/api/sync?after=0")).json();
  const actor = {
    workspaceId: "preserved-local-source",
    principalId: "local-owner",
  };
  const steps = ["Imported parent", "Imported child"].map((title) => ({
    id: randomUUID(),
    path: "/api/work/create",
    payload: { title, stableId: randomUUID(), deviceId: randomUUID() },
  }));
  const journal = createWorkspaceImportJournal(
    actor,
    {
      id: randomUUID(),
      sourceWorkspaceId: actor.workspaceId,
      sourcePrincipalId: actor.principalId,
      sourceRevision: 7,
      targetWorkspaceId: baseline.workspaceId,
      targetPrincipalId: baseline.createdBy,
      targetOrigin: base,
      targetEpoch: head.epoch,
      targetRevision: head.cursor,
      createdAt: "2026-10-15T00:00:00Z",
      sha256: "a".repeat(64),
      bytes: new Blob(["ORIVANE1 retained originals"]),
    },
    randomUUID(),
    steps,
  );
  const name = randomUUID(),
    factory = new IDBFactory();
  let store = await IndexedDbWorkspaceImports.open(name, factory),
    loseResponse = true;
  const calls: string[] = [];
  const ports = () => ({
    store,
    assertScope: async () => {},
    verifyBackup: async () => {},
    apply: async (
      step: import("@arclattice/application").WorkspaceImportStep,
      current: typeof journal,
    ) => {
      calls.push(step.id);
      const reply = await call(step.path, step.payload, {
        "Idempotency-Key": step.id,
        "X-Workspace-Id": current.targetWorkspaceId,
        "X-Workspace-Precondition": JSON.stringify(current.revision),
      });
      expect(reply.status).toBe(200);
      const value = await reply.json();
      if (loseResponse) {
        loseResponse = false;
        throw new Error("NETWORK_INTERRUPTED");
      }
      return value;
    },
  });
  try {
    await store.create(journal);
    await expect(
      continueWorkspaceImport(actor, journal.id, ports()),
    ).rejects.toThrow("NETWORK_INTERRUPTED");
    expect((await store.get(journal.id))!.accepted).toHaveLength(0);
    store.close();
    store = await IndexedDbWorkspaceImports.open(name, factory);
    const completed = await continueWorkspaceImport(actor, journal.id, ports());
    expect(completed.accepted).toHaveLength(2);
    expect(calls).toEqual([steps[0]!.id, steps[0]!.id, steps[1]!.id]);
    const snapshot = await (await call("/api/snapshot")).json();
    expect(
      snapshot.items.map((item: { id: string }) => item.id).sort(),
    ).toEqual(
      [baseline.id, ...steps.map((step) => step.payload.stableId)].sort(),
    );
  } finally {
    store.close();
  }
});

it("formal workspace import plans preserve project membership, Markdown, aliases, reminders and final task state", async () => {
  await login();
  const baseline = await create("Existing");
  let head = await (await call("/api/sync?after=0")).json();
  const p = randomUUID(),
    t = randomUUID(),
    s = randomUUID(),
    d = randomUUID(),
    r = randomUUID();
  const linkId = randomUUID();
  const materialId = randomUUID();
  const ownedSpaceId = randomUUID(),
    ownedMaterialId = randomUUID();
  const ownedDocumentId = randomUUID(),
    ownedDocumentMaterialId = randomUUID();
  const linkedDocumentMaterialId = randomUUID();
  const data = [
    {
      collection: "projectMaterials",
      id: linkedDocumentMaterialId,
      value: {
        projectId: p,
        kind: "DOCUMENT",
        ownership: "LINKED",
        targetId: d,
      },
    },
    {
      collection: "library",
      id: ownedDocumentId,
      value: {
        kind: "DOCUMENT",
        title: "Owned imported document",
        bodyMd: "Owned document source\n第二行",
        aliases: ["Owned document alias"],
        spaceId: ownedSpaceId,
        parentDocumentId: null,
        provenance: "HUMAN",
      },
    },
    {
      collection: "projectMaterials",
      id: ownedDocumentMaterialId,
      value: {
        projectId: p,
        kind: "DOCUMENT",
        ownership: "OWNED",
        targetId: ownedDocumentId,
      },
    },
    {
      collection: "library",
      id: ownedSpaceId,
      value: {
        kind: "SPACE",
        title: "Owned imported space",
        bodyMd: "Preserved owned description\n原文",
        aliases: [],
        spaceId: null,
        aiPolicy: {
          classification: "PRIVATE",
          processingBoundary: "LOCAL_ONLY",
          aiAccess: "DENY",
        },
      },
    },
    {
      collection: "projectMaterials",
      id: ownedMaterialId,
      value: {
        projectId: p,
        kind: "SPACE",
        ownership: "OWNED",
        targetId: ownedSpaceId,
        role: "PRIMARY",
        inheritToChildren: true,
      },
    },
    {
      collection: "projectMaterials",
      id: materialId,
      value: {
        projectId: p,
        kind: "SPACE",
        ownership: "LINKED",
        targetId: s,
        title: "Imported space",
        role: "REFERENCE",
        inheritToChildren: true,
      },
    },
    {
      collection: "links",
      id: linkId,
      value: {
        from: { kind: "WORK", id: t },
        to: { kind: "DOCUMENT", id: d },
        relation: "REFERENCES",
      },
    },
    {
      collection: "manualOrders",
      id: "WORKSPACE_TASKS",
      value: {
        scope: { kind: "WORKSPACE_TASKS" },
        entries: [{ entityId: t, position: 1024 }],
      },
    },
    {
      collection: "organization",
      id: "WORK:" + t,
      value: { kind: "WORK", id: t, archived: true, folder: "" },
    },
    {
      collection: "items",
      id: t,
      value: {
        title: "Imported completed",
        type: "TASK",
        projectIds: [p],
        status: "DONE",
        activationState: "ACTIVE",
        activationPolicy: "MANUAL",
      },
    },
    {
      collection: "items",
      id: p,
      value: {
        title: "Imported project",
        type: "PROJECT",
        activationState: "INACTIVE",
        activationPolicy: "MANUAL",
        lifecycle: "ACTIVE",
        parentProjectId: null,
      },
    },
    {
      collection: "library",
      id: d,
      value: {
        title: "Imported document",
        kind: "DOCUMENT",
        spaceId: s,
        parentDocumentId: null,
        aliases: ["别名"],
        bodyMd: "第一行\n第二行\n[[Related]]",
      },
    },
    {
      collection: "library",
      id: s,
      value: {
        title: "Imported space",
        kind: "SPACE",
        spaceId: null,
        bodyMd: "Description",
      },
    },
    {
      collection: "reminders",
      id: r,
      value: {
        title: "Imported reminder",
        bodyMd: "Reminder body",
        day: "2026-10-16",
        time: null,
        timezone: "Asia/Shanghai",
        notifyMode: "NONE",
        notifyOffsetMinutes: null,
        linkedProjectId: p,
        linkedTaskId: t,
        state: "ACTIVE",
      },
    },
  ];
  const steps = planWorkspaceImportSteps(
    data.map((entry) => ({
      collection: entry.collection,
      targetId: entry.id,
      sourceId: randomUUID(),
      sourceVersion: 4,
      value: entry.value,
    })),
    {
      deviceId: randomUUID(),
      sourcePrincipalId: "source-owner",
      targetPrincipalId: baseline.createdBy,
    },
    { next: randomUUID },
  );
  for (const step of steps) {
    const response = await call(step.path, step.payload, {
      "Idempotency-Key": step.id,
      "X-Workspace-Precondition": JSON.stringify({
        epoch: head.epoch,
        cursor: head.cursor,
      }),
    });
    const reply = await response.json();
    expect(response.status, JSON.stringify(reply)).toBe(200);
    head = reply.workspaceRevision;
  }
  const snapshot = await (await call("/api/snapshot")).json();
  expect(
    snapshot.items.find((item: { id: string }) => item.id === t),
  ).toMatchObject({ status: "DONE", projectIds: [p], version: 2 });
  expect(
    snapshot.items.find((item: { id: string }) => item.id === p),
  ).toMatchObject({ lifecycle: "ACTIVE" });
  expect(snapshot.reminders).toContainEqual(
    expect.objectContaining({ id: r, linkedProjectId: p, linkedTaskId: t }),
  );
  expect(snapshot.projectMaterials).toContainEqual(
    expect.objectContaining({
      id: materialId,
      projectId: p,
      kind: "SPACE",
      ownership: "LINKED",
      targetId: s,
      role: "REFERENCE",
      inheritToChildren: true,
    }),
  );
  expect(snapshot.links).toContainEqual(
    expect.objectContaining({
      id: linkId,
      from: { kind: "WORK", id: t },
      to: { kind: "DOCUMENT", id: d },
      relation: "REFERENCES",
    }),
  );
  expect(snapshot.manualOrders).toContainEqual(
    expect.objectContaining({
      id: "WORKSPACE_TASKS",
      version: 1,
      entries: [
        expect.objectContaining({ entityId: baseline.id }),
        expect.objectContaining({ entityId: t }),
      ],
    }),
  );
  expect(snapshot.organization).toContainEqual(
    expect.objectContaining({
      kind: "WORK",
      id: t,
      archived: true,
      version: 1,
    }),
  );
  const library = await (await call("/api/library")).json();
  expect(snapshot.projectMaterials).toContainEqual(
    expect.objectContaining({
      id: linkedDocumentMaterialId,
      projectId: p,
      kind: "DOCUMENT",
      ownership: "LINKED",
      targetId: d,
    }),
  );
  expect(snapshot.projectMaterials).toContainEqual(
    expect.objectContaining({
      id: ownedDocumentMaterialId,
      projectId: p,
      kind: "DOCUMENT",
      ownership: "OWNED",
      targetId: ownedDocumentId,
    }),
  );
  expect(library).toContainEqual(
    expect.objectContaining({
      id: ownedDocumentId,
      bodyMd: "Owned document source\n第二行",
      aliases: ["Owned document alias"],
      spaceId: ownedSpaceId,
      version: 2,
    }),
  );
  expect(snapshot.projectMaterials).toContainEqual(
    expect.objectContaining({
      id: ownedMaterialId,
      projectId: p,
      kind: "SPACE",
      ownership: "OWNED",
      targetId: ownedSpaceId,
      role: "PRIMARY",
      inheritToChildren: true,
    }),
  );
  expect(library).toContainEqual(
    expect.objectContaining({
      id: ownedSpaceId,
      bodyMd: "Preserved owned description\n原文",
      aliases: [],
      aiPolicy: {
        classification: "PRIVATE",
        processingBoundary: "LOCAL_ONLY",
        aiAccess: "DENY",
      },
      version: 2,
    }),
  );
  expect(library).toContainEqual(
    expect.objectContaining({
      id: d,
      spaceId: s,
      aliases: ["别名"],
      bodyMd: "第一行\n第二行\n[[Related]]",
    }),
  );
});

it("workspace File import resumes original binary chunks into only the explicitly chosen owned destination", async () => {
  await login();
  const baseline = await create("Keep default workspace");
  const targetId = randomUUID();
  expect(
    (
      await call("/api/v1/workspaces/create", {
        id: targetId,
        name: "File destination",
      })
    ).status,
  ).toBe(200);
  const scope = { "X-Workspace-Id": targetId };
  let head = await (await call("/api/sync?after=0", undefined, scope)).json();
  const bytes = randomBytes(600001),
    contentHash = createHash("sha256").update(bytes).digest("hex"),
    fileId = randomUUID();
  const steps = planWorkspaceImportSteps(
    [
      {
        collection: "files",
        sourceId: "original-local-file",
        sourceVersion: 4,
        targetId: fileId,
        value: {
          originalName: "原始文件.bin",
          name: "Display name",
          contentHash,
          mime: "application/octet-stream",
          size: bytes.length,
          spaceId: null,
          parentDocumentId: null,
        },
      },
    ],
    {
      sourcePrincipalId: "local-owner",
      targetPrincipalId: baseline.createdBy,
      deviceId: randomUUID(),
    },
    { next: randomUUID },
  );
  const source = {
    workspaceId: "original-local-source",
    principalId: "local-owner",
  };
  const digest = async (blob: Blob) =>
    createHash("sha256")
      .update(Buffer.from(await blob.arrayBuffer()))
      .digest("hex");
  const sourceBlobs = {
    digest,
    get: async (workspaceId: string, hash: string) => {
      expect(workspaceId).toBe(source.workspaceId);
      expect(hash).toBe(contentHash);
      return new Blob([bytes]);
    },
    put: async () => {
      throw new Error("SOURCE_MUST_NOT_CHANGE");
    },
  };
  const sent: number[] = [];
  let interrupted = false;
  const transport = {
    begin: async (_binding: unknown, input: unknown) =>
      (await call("/api/v1/files/binary/begin", input, scope)).json(),
    putChunk: async (
      _binding: unknown,
      hash: string,
      index: number,
      chunkHash: string,
      chunk: Blob,
    ) => {
      const response = await call(
        `/api/v1/files/binary/chunk?hash=${hash}&index=${index}`,
        {},
        {
          ...scope,
          "Content-Type": "application/octet-stream",
          "X-File-Chunk-Hash": chunkHash,
        },
        Buffer.from(await chunk.arrayBuffer()),
      );
      expect(response.status).toBe(200);
      sent.push(index);
      if (!interrupted) {
        interrupted = true;
        throw new Error("NETWORK_INTERRUPTED");
      }
      return response.json();
    },
    complete: async (_binding: unknown, hash: string) =>
      (
        await call(
          "/api/v1/files/binary/complete",
          { contentHash: hash },
          scope,
        )
      ).json(),
  };
  const binding = async () => ({
    workspaceId: source.workspaceId,
    remoteWorkspaceId: targetId,
    remotePrincipalId: baseline.createdBy,
    serverOrigin: base,
    epoch: head.epoch,
    cursor: head.cursor,
    version: 1,
  });
  const binary = steps[0]!.binary!;
  await expect(
    syncVerifiedLocalFileBinary(
      source,
      binary,
      sourceBlobs,
      transport,
      binding,
    ),
  ).rejects.toThrow("NETWORK_INTERRUPTED");
  await syncVerifiedLocalFileBinary(
    source,
    binary,
    sourceBlobs,
    transport,
    binding,
  );
  expect(sent).toEqual([0, 1, 2]);
  for (const step of steps) {
    const headers = {
      ...scope,
      "Idempotency-Key": step.id,
      "X-Workspace-Precondition": JSON.stringify({
        epoch: head.epoch,
        cursor: head.cursor,
      }),
    };
    const response = await call(step.path, step.payload, headers);
    const reply = await response.json();
    expect(response.status, JSON.stringify(reply)).toBe(200);
    expect(reply.workspaceRevision.epoch).toBe(head.epoch);
    expect(reply.workspaceRevision.cursor).toBeGreaterThan(head.cursor);
    const digest = createHash("sha256")
      .update(step.path + "\n" + JSON.stringify(step.payload))
      .digest("hex");
    const guard = JSON.parse(headers["X-Workspace-Precondition"]);
    const proof = JSON.stringify([digest, guard.epoch, guard.cursor]);
    const receipt = await call(
      "/api/workspace-import/receipt?commandId=" +
        step.id +
        "&proof=" +
        encodeURIComponent(proof),
      undefined,
      scope,
    );
    expect(receipt.status).toBe(200);
    expect(await receipt.json()).toEqual(reply);
    expect(
      (
        await call(
          "/api/workspace-import/receipt?commandId=" +
            step.id +
            "&proof=" +
            encodeURIComponent(
              JSON.stringify(["b".repeat(64), guard.epoch, guard.cursor]),
            ),
          undefined,
          scope,
        )
      ).status,
    ).toBe(404);
    const repeated = await call(step.path, step.payload, headers);
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toEqual(reply);
    const staleId = randomUUID();
    const stalePayload =
      step.path === "/api/files/register"
        ? {
            ...(step.payload as Record<string, unknown>),
            syncCommand: {
              ...(step.payload as { syncCommand: Record<string, unknown> })
                .syncCommand,
              commandId: staleId,
            },
          }
        : step.payload;
    const stale = await call(step.path, stalePayload, {
      ...headers,
      "Idempotency-Key": staleId,
    });
    expect(stale.status).toBe(409);
    const malformed = await call(step.path, step.payload, {
      ...headers,
      "Idempotency-Key": randomUUID(),
      "X-Workspace-Precondition": "{",
    });
    expect(malformed.status).toBe(400);
    head = reply.workspaceRevision;
  }
  const target = await (await call("/api/bootstrap", undefined, scope)).json();
  expect(target.workspace.files).toEqual([
    expect.objectContaining({
      id: fileId,
      originalName: "原始文件.bin",
      name: "Display name",
      contentHash,
      version: 2,
    }),
  ]);
  expect(
    Buffer.from(
      await (
        await call(`/api/v1/files/bytes?id=${fileId}`, undefined, scope)
      ).arrayBuffer(),
    ),
  ).toEqual(bytes);
  const original = await (await call("/api/bootstrap")).json();
  expect(original.workspace.files).toEqual([]);
  expect(
    original.workspace.items.map((item: { id: string }) => item.id),
  ).toEqual([baseline.id]);
});

it("stable offline Work creation preserves UUID, server attribution and durable device idempotency", async () => {
  await login();
  const baseline = await create("Baseline");
  const input = {
    title: "Offline",
    descriptionMd: "原文\n第二行",
    stableId: randomUUID(),
    deviceId: randomUUID(),
  };
  const headers = { "Idempotency-Key": randomUUID() };
  const response = await call("/api/v1/work/create", input, headers);
  expect(response.status).toBe(200);
  const first = await response.json();
  expect(first).toMatchObject({
    id: input.stableId,
    workspaceId: baseline.workspaceId,
    createdBy: baseline.createdBy,
    updatedBy: baseline.updatedBy,
    version: 1,
    descriptionMd: input.descriptionMd,
  });
  const events = await host.db.inspectEvents(first.workspaceId);
  const repeated = await call("/api/v1/work/create", input, headers);
  expect(repeated.status).toBe(200);
  expect(await repeated.json()).toEqual(first);
  expect(await host.db.inspectEvents(first.workspaceId)).toEqual(events);
  expect(
    (
      await call(
        "/api/v1/work/create",
        { ...input, deviceId: randomUUID() },
        headers,
      )
    ).status,
  ).toBe(409);
  expect((await call("/api/v1/work/create", input)).status).toBe(409);
  expect(await host.db.inspectEvents(first.workspaceId)).toEqual(events);
});

it("stable Work replay fields require paired valid IDs, human session and existing CSRF protection", async () => {
  await login();
  const input = {
    title: "Offline",
    stableId: randomUUID(),
    deviceId: randomUUID(),
  };
  for (const invalid of [
    { title: "Missing device", stableId: input.stableId },
    { title: "Missing stable ID", deviceId: input.deviceId },
    { ...input, stableId: "invalid" },
    { ...input, deviceId: "invalid" },
    { ...input, workspaceId: "foreign" },
    { ...input, createdBy: "foreign" },
  ])
    expect((await call("/api/v1/work/create", invalid)).status).toBe(400);
  expect(
    (await call("/api/v1/work/create", input, { "X-CSRF-Token": "invalid" }))
      .status,
  ).toBe(403);
  const credential = await (
    await call("/api/tokens/create", {
      name: "Write capability",
      scope: "write",
    })
  ).json();
  expect(
    (
      await call("/api/v1/work/create", input, {
        Cookie: "",
        Authorization: "Bearer " + credential.secret,
      })
    ).status,
  ).toBe(403);
  expect((await (await call("/api/snapshot")).json()).items).toHaveLength(0);
});
it("navigation movement validates group boundaries and persists CAS without duplicate changes", async () => {
  await login();
  const initial = await (await call("/api/snapshot")).json();
  const input = {
    version: initial.navigationPreference.version,
    movingId: "calendar",
    anchorId: "tasks",
    placement: "BEFORE",
  };
  const response = await call("/api/v1/work/navigation-move", input);
  expect(response.status).toBe(200);
  const next = await response.json();
  expect(next.version).toBe(input.version + 1);
  expect(next.desktop.order.slice(0, 6)).toEqual([
    "overview",
    "calendar",
    "tasks",
    "projects",
    "focus",
    "notes",
  ]);
  expect((await call("/api/work/navigation-move", input)).status).toBe(409);
  const cursor = await (await call("/api/sync")).json();
  expect(
    (
      await call("/api/work/navigation-move", {
        ...input,
        version: next.version,
      })
    ).status,
  ).toBe(200);
  const unchanged = await (
    await call(`/api/sync?after=${cursor.cursor}&epoch=${cursor.epoch}`)
  ).json();
  expect(unchanged.snapshot).toBeNull();
  expect(unchanged.cursor).toBe(cursor.cursor);
  expect(unchanged.records).toEqual([]);
  expect(
    (
      await call("/api/work/navigation-move", {
        ...input,
        version: next.version,
        anchorId: "notes",
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await call("/api/work/navigation-move", {
        ...input,
        version: next.version,
        movingId: "unknown",
      })
    ).status,
  ).toBe(400);
  const saved = await (await call("/api/snapshot")).json();
  expect(saved.navigationPreference).toEqual(next);
});
it("manual order API keeps scope CAS and durable incremental sync while rejecting invalid intents", async () => {
  await login();
  const a = await (await call("/api/work/create", { title: "A" })).json();
  const b = await (await call("/api/work/create", { title: "B" })).json();
  const initial = await (await call("/api/sync")).json();
  expect(initial.snapshot.manualOrders).toEqual([]);
  const input = {
    scope: { kind: "WORKSPACE_TASKS" },
    version: 0,
    entityId: b.id,
    anchorId: a.id,
    placement: "BEFORE",
  };
  const response = await call("/api/v1/manual-orders/move", input);
  expect(response.status).toBe(200);
  const state = await response.json();
  expect(
    state.entries.map((entry: { entityId: string }) => entry.entityId),
  ).toEqual([b.id, a.id]);
  const delta = await (
    await call(`/api/sync?after=${initial.cursor}&epoch=${initial.epoch}`)
  ).json();
  expect(delta.snapshot).toBeNull();
  expect(delta.changes.collections.manualOrders.upserts).toEqual([state]);
  expect((await call("/api/manual-orders/move", input)).status).toBe(409);
  expect(
    (
      await call("/api/manual-orders/move", {
        ...input,
        version: 1,
        placement: "MOVE_STATUS",
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await call("/api/manual-orders/move", {
        ...input,
        version: 1,
        position: 3,
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await call("/api/manual-orders/move", {
        ...input,
        version: 1,
        entityId: "missing",
      })
    ).status,
  ).toBe(400);
});
it("clean Wiki link identities survive an actual host restart without a full rebuild", async () => {
  await login();
  const space = await (
    await call("/api/library/save", {
      id: null,
      version: 0,
      input: {
        kind: "SPACE",
        spaceId: null,
        title: "Warm workspace",
        bodyMd: "",
      },
    })
  ).json();
  await call("/api/library/save", {
    id: null,
    version: 0,
    input: {
      kind: "DOCUMENT",
      spaceId: space.id,
      title: "Warm source",
      bodyMd: "[[Future target]]",
    },
  });
  const before = new DatabaseSync(join(directory, "work.sqlite"), {
    readOnly: true,
  });
  let links: Record<string, unknown>[];
  try {
    links = before
      .prepare("SELECT * FROM document_wiki_link ORDER BY id")
      .all();
    expect(links).toHaveLength(1);
    expect(
      before
        .prepare("SELECT dirty FROM wiki_index_state WHERE workspace_id=?")
        .get(space.workspaceId)?.dirty,
    ).toBe(0);
  } finally {
    before.close();
  }
  await host.close();
  await start();
  const after = new DatabaseSync(join(directory, "work.sqlite"), {
    readOnly: true,
  });
  try {
    expect(
      after.prepare("SELECT * FROM document_wiki_link ORDER BY id").all(),
    ).toEqual(links);
  } finally {
    after.close();
  }
});
it("workspace bootstrap carries versioned metadata without note or document bodies", async () => {
  await login();
  const space = await (
    await call("/api/library/save", {
      id: null,
      version: 0,
      input: {
        kind: "SPACE",
        spaceId: null,
        title: "Bootstrap space",
        bodyMd: "Space private body",
      },
    })
  ).json();
  const document = await (
    await call("/api/library/save", {
      id: null,
      version: 0,
      input: {
        kind: "DOCUMENT",
        spaceId: space.id,
        title: "Bootstrap document",
        bodyMd: "Document body never in manifest".repeat(2000),
      },
    })
  ).json();
  const response = await call("/api/bootstrap");
  expect(response.status).toBe(200);
  const manifest = await response.json();
  expect(manifest).toMatchObject({
    schemaVersion: 1,
    epoch: expect.any(String),
    cursor: expect.any(Number),
  });
  expect(
    manifest.library.find((entry: { id: string }) => entry.id === document.id),
  ).toMatchObject({ version: document.version, bodyState: "UNLOADED" });
  for (const entry of [...manifest.notes, ...manifest.library])
    expect(entry).not.toHaveProperty("bodyMd");
  expect(JSON.stringify(manifest)).not.toContain(
    "Document body never in manifest",
  );
  expect(manifest.workspace).not.toHaveProperty("library");
  expect(manifest.workspace).not.toHaveProperty("notes");
  expect(manifest.workspace.items).toEqual([]);
  const hydrated = await call(
    "/api/document/body?kind=LIBRARY&id=" + document.id,
  );
  expect(hydrated.status).toBe(200);
  expect(await hydrated.json()).toEqual(document);
  expect(
    (await call("/api/document/body?kind=LIBRARY&id=missing")).status,
  ).toBe(404);
  expect(
    (await call("/api/document/body?kind=INVALID&id=" + document.id)).status,
  ).toBe(400);
  await call("/api/library/delete", {
    id: space.id,
    version: space.version,
    deleted: true,
  });
  expect(
    (await call("/api/document/body?kind=LIBRARY&id=" + document.id)).status,
  ).toBe(404);
  const snapshot = await (await call("/api/snapshot")).json();
  expect(
    snapshot.library.find((entry: { id: string }) => entry.id === document.id)
      .bodyMd,
  ).toBe(document.bodyMd);
});
it("knowledge search returns scoped metadata from body matches and excludes deleted documents", async () => {
  await login();
  const spaces = [];
  for (const title of ["Search source", "Other source"]) {
    spaces.push(
      await (
        await call("/api/library/save", {
          id: null,
          version: 0,
          input: { kind: "SPACE", spaceId: null, title, bodyMd: "" },
        })
      ).json(),
    );
  }
  const documents = [];
  for (const [index, title] of [
    "Visible result",
    "Deleted result",
    "Other result",
  ].entries()) {
    documents.push(
      await (
        await call("/api/library/save", {
          id: null,
          version: 0,
          input: {
            kind: "DOCUMENT",
            spaceId: spaces[index === 2 ? 1 : 0].id,
            title,
            bodyMd: "Body-only needlephrase",
          },
        })
      ).json(),
    );
  }
  await call("/api/library/delete", {
    id: documents[1].id,
    version: documents[1].version,
    deleted: true,
  });
  const path =
    "/api/library/search?" +
    new URLSearchParams({ q: "needlephrase", spaceId: spaces[0].id });
  const response = await call(path);
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({
    id: documents[0].id,
    title: "Visible result",
    spaceId: spaces[0].id,
  });
  expect(Object.keys(result[0]).sort()).toEqual([
    "id",
    "score",
    "spaceId",
    "title",
  ]);
  const workspaceResults = await (
    await call("/api/library/search?q=needlephrase")
  ).json();
  expect(
    workspaceResults.map((entry: { id: string }) => entry.id).sort(),
  ).toEqual([documents[0].id, documents[2].id].sort());
  expect(
    workspaceResults.every((entry: object) => !Object.hasOwn(entry, "bodyMd")),
  ).toBe(true);
  expect(
    (await call("/api/library/search?q=needlephrase&spaceId=missing")).status,
  ).toBe(404);
  const tokenResponse = await call("/api/tokens/create", {
    name: "Search write-only",
    scope: "write",
  });
  expect(tokenResponse.status).toBe(201);
  const writeOnly = await tokenResponse.json();
  expect(
    (
      await call(path, undefined, {
        Authorization: "Bearer " + writeOnly.secret,
      })
    ).status,
  ).toBe(403);
});
async function seedOwner() {
  const existing = await host.db.accounts((store) => store.find("owner"));
  if (existing) return existing;
  const verifier = await passwordHash(ownerPassword);
  return host.db.accounts((store) => store.register("owner", verifier, true));
}
const origin = "http://127.0.0.1:4317";
it("workspace invalidation SSE exposes only a cursor and delivers committed mutations", async () => {
  await login();
  expect(
    (await call("/api/workspace/events", undefined, { Cookie: "" })).status,
  ).toBe(401);
  const request = httpRequest(base + "/api/workspace/events", {
    headers: { Host: "127.0.0.1:4317", Cookie: cookie },
  });
  request.setTimeout(5000, () => request.destroy(new Error("SSE_TIMEOUT")));
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    request.once("response", resolve);
    request.once("error", reject);
    request.end();
  });
  expect(response.headers["content-type"]).toBe("text/event-stream");
  const reader = response.iterator({ destroyOnReturn: false }),
    decoder = new TextDecoder();
  try {
    const first = decoder.decode((await reader.next()).value);
    expect(first).toMatch(/data: \{"cursor":"[a-f0-9]{32}:\d+"\}/);
    await call("/api/work/create", { title: "Private cursor-only mutation" });
    const changed = decoder.decode((await reader.next()).value);
    expect(changed).not.toBe(first);
    expect(changed).toMatch(/data: \{"cursor":"[a-f0-9]{32}:\d+"\}/);
    expect(changed).not.toContain("Private");
    expect(changed).not.toContain("workspaceId");
  } finally {
    request.destroy();
    response.destroy();
  }
});
it("model catalog mutations use private CAS, validate live bindings and never return encrypted credentials", async () => {
  await host.close();
  await start(
    undefined,
    undefined,
    openPersonalVault(join(directory, "catalog-api-vault")),
  );
  await login();
  expect((await call("/api/ai/configuration")).status).toBe(200);
  const input = {
    connections: [
      {
        id: "provider",
        name: "Provider",
        kind: "OPENAI",
        endpoint: "https://provider.example/v1/",
        credentialRef: "provider",
        credentialConfigured: false,
      },
    ],
    models: [
      {
        id: "model",
        connectionId: "provider",
        modelId: "model",
        capabilities: {
          tools: true,
          jsonSchema: true,
          vision: false,
          streaming: false,
          embedding: false,
        },
      },
    ],
    profiles: [
      {
        id: "profile",
        name: "Default",
        primaryModelId: "model",
        fallbackModelIds: [],
        requestLimit: { kind: "UNLIMITED" },
        budget: {
          currency: "USD",
          dailyMicros: 5_000_000,
          inputMicrosPerMillion: 1,
          outputMicrosPerMillion: 1,
        },
      },
    ],
    bindings: [{ scope: "PERSONAL", entityId: null, profileId: "profile" }],
    credentials: [
      { connectionId: "provider", key: "test-only-configuration-secret" },
    ],
  };
  const response = await call("/api/ai/configuration/save", {
    version: 0,
    input,
  });
  expect(response.status).toBe(200);
  const saved = await response.json();
  expect(saved.version).toBe(1);
  expect(saved.connections[0].credentialConfigured).toBe(true);
  expect(saved.profiles[0].requestLimit).toEqual({ kind: "UNLIMITED" });
  expect(JSON.stringify(saved)).not.toContain("test-only-configuration-secret");
  expect(
    (await call("/api/ai/configuration/save", { version: 0, input })).status,
  ).toBe(409);
  for (const bindings of [
    [{ scope: "PROJECT", entityId: "foreign", profileId: "profile" }],
    [{ scope: "SPACE", entityId: "foreign", profileId: "profile" }],
  ])
    expect(
      (
        await call("/api/ai/configuration/save", {
          version: 1,
          input: { ...input, bindings, credentials: [] },
        })
      ).status,
    ).toBe(404);
  expect(
    (
      await call("/api/ai/configuration/save", {
        version: 1,
        input: {
          ...input,
          profiles: [
            {
              ...input.profiles[0],
              budget: { ...input.profiles[0]!.budget, key: "untrusted" },
            },
          ],
        },
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await call("/api/ai/configuration/save", {
        version: 1,
        input: {
          ...input,
          connections: [
            {
              ...input.connections[0],
              endpoint: "http://127.0.0.1:11434/",
              kind: "OLLAMA",
            },
          ],
        },
      })
    ).status,
  ).toBe(400);
  const token = await (
    await call("/api/tokens/create", {
      name: "Catalog isolation",
      scope: "read-write",
    })
  ).json();
  expect(
    (
      await call("/api/ai/configuration", undefined, {
        Cookie: "",
        Authorization: `Bearer ${token.secret}`,
      })
    ).status,
  ).toBe(403);
  expect(
    (await call("/api/ai/connections/models", { connectionId: "missing" }))
      .status,
  ).toBe(404);
});
it("connection test and discovery expose safe structured diagnostics with host authorization", async () => {
  await host.close();
  const vault = openPersonalVault(join(directory, "probe-vault"));
  const adapter = {
    provider: "test",
    model: "test",
    capabilities: {
      tools: false,
      jsonSchema: false,
      vision: false,
      streaming: false,
      embedding: false,
    },
    complete: async () => "OK",
    async *stream() {
      yield { type: "completed" as const };
    },
    respond: async () => ({ text: "OK", toolCalls: [] }),
    listModels: async () => {
      throw providerFailure("ENDPOINT_NOT_FOUND", 404, "CUSTOM_OPENAI");
    },
  };
  vault.connectionAdapter = () => adapter;
  vault.testConnection = async () => ({
    connected: true,
    discovery: "UNSUPPORTED",
  });
  await start(undefined, undefined, vault);
  await login();
  const tested = await call("/api/ai/connections/test", {
    connectionId: "test",
  });
  expect(tested.status).toBe(200);
  expect(await tested.json()).toEqual({
    connected: true,
    discovery: "UNSUPPORTED",
  });
  const discovered = await call("/api/ai/connections/models", {
    connectionId: "test",
  });
  expect(discovered.status).toBe(502);
  expect(await discovered.json()).toMatchObject({
    error: "PROVIDER_REQUEST_FAILED",
    providerError: {
      category: "UNSUPPORTED_DISCOVERY",
      provider: "CUSTOM_OPENAI",
      status: 404,
      retryable: false,
    },
  });
  for (const [status, category] of [
    [401, "AUTH_INVALID"],
    [403, "PERMISSION_DENIED"],
    [405, "METHOD_NOT_ALLOWED"],
    [429, "RATE_LIMITED"],
    [503, "UPSTREAM_UNAVAILABLE"],
  ] as const) {
    vault.testConnection = async () => {
      throw providerFailure(category, status, "CUSTOM_OPENAI");
    };
    const result = await call("/api/ai/connections/test", {
      connectionId: "test",
    });
    expect(result.status).toBe(502);
    const body = await result.json();
    expect(body.providerError).toMatchObject({ category, status });
    expect(JSON.stringify(body)).not.toContain("Authorization");
  }
});
it("Atlas resolves inherited model routing before building independent retrieval context", async () => {
  await host.close();
  const vault = openPersonalVault(join(directory, "routing-vault"));
  await start(undefined, undefined, vault);
  await login();
  const account = await host.db.accounts((store) => store.find("owner"));
  const actor = {
    workspaceId: account!.workspaceId,
    principalId: account!.principalId,
  };
  const project = await (
    await call("/api/work/create", {
      title: "Routing project",
      type: "PROJECT",
    })
  ).json();
  const space = await (
    await call("/api/library/save", {
      id: null,
      version: 0,
      input: {
        kind: "SPACE",
        spaceId: null,
        title: "Routing space",
        bodyMd: "",
      },
    })
  ).json();
  for (const scope of ["personal", `WORK:${project.id}`, `SPACE:${space.id}`]) {
    vault.save(actor, 0, {
      scope,
      endpoint: "https://models.example/v1",
      protocol: "chat",
      model: scope.startsWith("WORK")
        ? "project"
        : scope.startsWith("SPACE")
          ? "space"
          : "personal",
      key: "test-only-key",
      maxRunsPerDay: 100,
    });
  }
  vault.save(actor, 0, {
    scope: "personal",
    profileId: "explicit",
    endpoint: "https://models.example/v1",
    protocol: "chat",
    model: "explicit",
    key: "test-only-key",
    maxRunsPerDay: 100,
  });
  for (const [retrievalContext, modelRouting, expected] of [
    [{}, {}, "personal"],
    [{ projectId: project.id }, {}, "project"],
    [{ projectId: project.id, currentSpaceId: space.id }, {}, "space"],
    [
      { projectId: project.id, currentSpaceId: space.id },
      { explicitProfileId: "explicit" },
      "explicit",
    ],
  ] as const) {
    const response = await call("/api/ai/propose", {
      prompt: "Which model is selected?",
      sources: [],
      scope: "personal",
      profileId: "default",
      retrievalContext,
      modelRouting,
    });
    expect(response.status).toBe(200);
    const run = await response.json();
    expect(run.route.model).toBe(expected);
    expect(run.status).toBe("WAITING_APPROVAL");
    expect(
      (
        await call("/api/ai/decide", {
          id: run.id,
          version: run.version,
          approve: false,
        })
      ).status,
    ).toBe(200);
  }
  expect(
    (
      await call("/api/ai/propose", {
        prompt: "Missing override",
        modelRouting: { explicitProfileId: "missing" },
      })
    ).status,
  ).toBe(404);
});
it("workspace calendar settings require a human session, version and atomic receipt", async () => {
  await login();
  const input = { version: 0, timezone: "Asia/Shanghai" };
  const headers = { "Idempotency-Key": randomUUID() };
  expect(
    (
      await call("/api/work/calendar-settings", input, {
        "X-CSRF-Token": "wrong",
      })
    ).status,
  ).toBe(403);
  const saved = await call("/api/v1/work/calendar-settings", input, headers);
  expect(saved.status).toBe(200);
  expect(await saved.json()).toEqual({ version: 1, timezone: "Asia/Shanghai" });
  expect(
    (await call("/api/v1/work/calendar-settings", input, headers)).status,
  ).toBe(200);
  expect((await call("/api/work/calendar-settings", input)).status).toBe(409);
  expect(
    (
      await call("/api/work/calendar-settings", {
        version: 1,
        timezone: "bad-zone",
      })
    ).status,
  ).toBe(400);
  expect((await (await call("/api/snapshot")).json()).calendarTimezone).toBe(
    "Asia/Shanghai",
  );
  const tokenResponse = await call("/api/tokens/create", {
    name: "Calendar test",
    scope: "read-write",
  });
  expect(tokenResponse.status).toBe(201);
  const token = await tokenResponse.json();
  expect(
    (
      await call(
        "/api/work/calendar-settings",
        { version: 1, timezone: "UTC" },
        { Authorization: "Bearer " + token.secret, Cookie: "" },
      )
    ).status,
  ).toBe(403);
  const events = await (await call("/api/activity")).json();
  expect(
    events.filter(
      (event: { type: string }) => event.type === "WORKSPACE_SETTINGS_UPDATED",
    ),
  ).toHaveLength(1);
});
it("project space listing validates inheritance and preserves binding roles", async () => {
  await login();
  const parent = await (
    await call("/api/work/create", { title: "Parent", type: "PROJECT" })
  ).json();
  const child = await (
    await call("/api/work/create", {
      title: "Child",
      type: "PROJECT",
      parentProjectId: parent.id,
    })
  ).json();
  const created = await call("/api/projects/space/create", {
    projectId: parent.id,
    title: "Inherited wiki",
    inheritToChildren: true,
  });
  expect(created.status).toBe(200);
  const binding = await created.json();
  expect(binding.role).toBe("PRIMARY");
  const input = { projectId: child.id, includeInherited: true };
  const inherited = await call("/api/v1/projects/spaces", input);
  expect(inherited.status).toBe(200);
  expect(await inherited.json()).toEqual([
    expect.objectContaining({
      spaceId: binding.spaceId,
      inheritToChildren: true,
    }),
  ]);
  expect(
    await (await call("/api/projects/spaces", { projectId: child.id })).json(),
  ).toEqual([]);
  expect(
    (await call("/api/projects/spaces", { ...input, includeInherited: "yes" }))
      .status,
  ).toBe(400);
  expect(
    (await call("/api/projects/spaces", { ...input, unknown: true })).status,
  ).toBe(400);
  expect(
    (
      await call("/api/projects/space/create", {
        projectId: parent.id,
        title: "Invalid",
        inheritToChildren: "yes",
      })
    ).status,
  ).toBe(400);
});
it("dispatches shared capabilities through authorization, human approval and application persistence", async () => {
  await login();
  const project = await (
    await call("/api/work/create", {
      title: "Capability project",
      type: "PROJECT",
    })
  ).json();
  const input = {
    name: "create_task",
    input: { title: "Capability task", projectIds: [project.id] },
  };
  expect((await call("/api/ai/capability", input)).status).toBe(403);
  const headers = { "Idempotency-Key": randomUUID() };
  const saved = await call(
    "/api/ai/capability",
    { ...input, approved: true },
    headers,
  );
  expect(saved.status).toBe(200);
  const task = await saved.json();
  const replay = await (
    await call("/api/ai/capability", { ...input, approved: true }, headers)
  ).json();
  expect(replay.id).toBe(task.id);
  const list = await (
    await call("/api/ai/capability", {
      name: "list_project_tasks",
      input: { projectId: project.id },
    })
  ).json();
  expect(list.map((entry: { id: string }) => entry.id)).toContain(task.id);
  const rpc = (name: string, args: unknown) => ({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });
  const read = await call("/api/mcp", rpc("get_project", { id: project.id }));
  expect(read.status).toBe(200);
  expect(JSON.parse((await read.json()).result.content[0].text).id).toBe(
    project.id,
  );
  expect((await call("/api/mcp", rpc("create_task", input.input))).status).toBe(
    403,
  );
  const snapshot = await (await call("/api/snapshot")).json();
  expect(
    snapshot.items.filter(
      (entry: { title: string }) => entry.title === "Capability task",
    ),
  ).toHaveLength(1);
});
it("shared task update and document move capabilities enforce review, CAS and preserve Markdown", async () => {
  await login();
  const project = await (
    await call("/api/work/create", {
      type: "PROJECT",
      title: "Capability destination",
    })
  ).json();
  let task = await (
    await call("/api/work/create", { title: "Editable capability task" })
  ).json();
  const changes = [
    {
      name: "update_task",
      title: "Revised title",
      descriptionMd: "# Exact Markdown\n😀",
    },
    { name: "reschedule_task", startDate: "2026-10-03", dueDate: "2026-10-05" },
    { name: "set_task_priority", priority: "HIGH" },
    { name: "move_task_to_project", projectIds: [project.id] },
    { name: "complete_task" },
  ];
  for (const { name, ...change } of changes) {
    const request = {
      name,
      input: { id: task.id, version: task.version, ...change },
    };
    expect((await call("/api/ai/capability", request)).status).toBe(403);
    const response = await call("/api/ai/capability", {
      ...request,
      approved: true,
    });
    expect(response.status).toBe(200);
    const previous = task;
    task = await response.json();
    expect(task.version).toBe(previous.version + 1);
    expect(
      (await call("/api/ai/capability", { ...request, approved: true })).status,
    ).toBe(409);
  }
  expect(task).toMatchObject({
    title: "Revised title",
    descriptionMd: "# Exact Markdown\n😀",
    priority: "HIGH",
    status: "DONE",
    projectIds: [project.id],
    startDate: "2026-10-03",
    dueDate: "2026-10-05",
  });
  const aiPolicy = {
    classification: "PRIVATE",
    processingBoundary: "ANY",
    aiAccess: "ALLOW",
  };
  const spaces = [];
  for (const title of ["Source", "Destination"])
    spaces.push(
      await (
        await call("/api/library/save", {
          id: null,
          version: 0,
          input: { kind: "SPACE", spaceId: null, title, bodyMd: "", aiPolicy },
        })
      ).json(),
    );
  const markdown = "# Preserve source\r\n[[Wiki]] 😀";
  const created = await call("/api/ai/capability", {
    name: "create_document",
    input: { spaceId: spaces[0].id, title: "Agent document", bodyMd: markdown },
    approved: true,
  });
  expect(created.status).toBe(200);
  let document = await created.json();
  expect(document.aiPolicy.aiAccess).toBe("DENY");
  const policyResponse = await call("/api/library/save", {
    id: document.id,
    version: document.version,
    input: {
      kind: document.kind,
      spaceId: document.spaceId,
      title: document.title,
      bodyMd: document.bodyMd,
      aiPolicy,
    },
  });
  expect(policyResponse.status).toBe(200);
  document = await policyResponse.json();
  const moved = await call("/api/ai/capability", {
    name: "move_document",
    input: {
      id: document.id,
      version: document.version,
      spaceId: spaces[1].id,
    },
    approved: true,
  });
  expect(moved.status).toBe(200);
  expect(await moved.json()).toMatchObject({
    id: document.id,
    bodyMd: markdown,
    spaceId: spaces[1].id,
    version: document.version + 1,
  });
});
it("persists administrator endpoint trust and never reactivates revoked trust on receipt replay", async () => {
  await host.close();
  const vault = openPersonalVault(join(directory, "trust-vault"));
  await start(undefined, undefined, vault);
  await login();
  const input = {
    version: 0,
    entries: [
      {
        id: "local",
        title: "Local model",
        provider: "VLLM",
        origin: "http://127.0.0.1:11434/v1/",
        enabled: true,
      },
    ],
  };
  const headers = { "Idempotency-Key": randomUUID() };
  expect(
    (await call("/api/ai/trusted-endpoints/save", input, headers)).status,
  ).toBe(200);
  const trust = await (await call("/api/ai/trusted-endpoints")).json();
  expect(trust.version).toBe(1);
  const account = await host.db.accounts((store) => store.find("owner"));
  const actor = {
    workspaceId: account!.workspaceId,
    principalId: account!.principalId,
  };
  const model = {
    scope: "personal" as const,
    endpoint: input.entries[0]!.origin,
    protocol: "chat" as const,
    model: "local",
    key: "test-only",
    maxRunsPerDay: 1,
  };
  expect(() => vault.save(actor, 0, model)).not.toThrow();
  await host.close();
  const reopened = openPersonalVault(join(directory, "trust-vault"));
  await start(undefined, undefined, reopened);
  await login();
  expect(
    (await (await call("/api/ai/trusted-endpoints")).json()).entries,
  ).toHaveLength(1);
  expect(
    (await call("/api/ai/trusted-endpoints/save", { version: 1, entries: [] }))
      .status,
  ).toBe(200);
  expect(
    (await call("/api/ai/trusted-endpoints/save", input, headers)).status,
  ).toBe(200);
  expect(
    (await (await call("/api/ai/trusted-endpoints")).json()).entries,
  ).toEqual([]);
  expect(() => reopened.save(actor, 1, model)).toThrow();
  const token = await (
    await call("/api/tokens/create", {
      name: "Trust test",
      scope: "read-write",
    })
  ).json();
  expect(
    (
      await call("/api/ai/trusted-endpoints", undefined, {
        Cookie: "",
        Authorization: "Bearer " + token.secret,
      })
    ).status,
  ).toBe(403);
});
it("records capability calls and proposals inside the authorized persisted conversation", async () => {
  await login();
  const conversation = await (
    await call("/api/ai/sessions/create", { title: "Tools" })
  ).json();
  const result = await call("/api/ai/capability", {
    name: "create_task",
    input: { title: "Session task" },
    approved: true,
    sessionId: conversation.id,
    sessionVersion: conversation.version,
  });
  expect(result.status).toBe(200);
  const session = await latestConversation();
  expect(
    session.messages.map((message: { kind: string }) => message.kind),
  ).toEqual(["TOOL_CALL", "TOOL_RESULT"]);
  expect(session.messages[1].text).toContain("Session task");
  expect(
    (
      await call("/api/ai/capability", {
        name: "create_task",
        input: { title: "Stale task" },
        approved: true,
        sessionId: conversation.id,
        sessionVersion: conversation.version,
      })
    ).status,
  ).toBe(409);
  expect((await (await call("/api/snapshot")).json()).items).toHaveLength(1);
  const policy = {
    classification: "PRIVATE",
    processingBoundary: "ANY",
    aiAccess: "ALLOW",
  };
  const space = await (
    await call("/api/library/save", {
      id: null,
      version: 0,
      input: {
        kind: "SPACE",
        spaceId: null,
        title: "Capability wiki",
        bodyMd: "",
        aiPolicy: policy,
      },
    })
  ).json();
  const document = await (
    await call("/api/library/save", {
      id: null,
      version: 0,
      input: {
        kind: "DOCUMENT",
        spaceId: space.id,
        title: "Capability document",
        bodyMd: "Original",
        aiPolicy: policy,
      },
    })
  ).json();
  const other = await (
    await call("/api/library/save", {
      id: null,
      version: 0,
      input: {
        kind: "DOCUMENT",
        spaceId: space.id,
        title: "Other document",
        bodyMd: "",
        aiPolicy: policy,
      },
    })
  ).json();
  expect(
    (
      await call("/api/ai/capability", {
        name: "read_document",
        input: { id: document.id },
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await call("/api/ai/capability", {
        name: "link_documents",
        input: { fromId: document.id, toId: other.id },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await call("/api/ai/capability", {
        name: "link_documents",
        input: { fromId: document.id, toId: other.id },
        approved: true,
      })
    ).status,
  ).toBe(200);
  const proposal = await call("/api/ai/capability", {
    name: "propose_document_edit",
    input: { id: document.id, markdown: "Proposed" },
    approved: true,
    sessionId: session.id,
    sessionVersion: session.version,
  });
  expect(proposal.status).toBe(200);
  expect((await latestConversation()).messages.at(-1).kind).toBe("PROPOSAL");
  expect(
    (await (await call("/api/library")).json()).find(
      (entry: { id: string }) => entry.id === document.id,
    ).bodyMd,
  ).toBe("Original");
  const rpc = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "read_document", arguments: { id: document.id } },
  };
  expect((await call("/api/mcp", rpc)).status).toBe(200);
  await call("/api/library/save", {
    id: space.id,
    version: space.version,
    input: {
      kind: "SPACE",
      spaceId: null,
      title: space.title,
      bodyMd: "",
      aiPolicy: { ...policy, aiAccess: "DENY" },
    },
  });
  expect((await call("/api/mcp", rpc)).status).toBe(403);
});
it("project documents and files use atomic receipts, soft deletion and authenticated downloads", async () => {
  await login();
  const project = await (
    await call("/api/work/create", { title: "Materials", type: "PROJECT" })
  ).json();
  const space = await (
    await call("/api/projects/space/create", {
      projectId: project.id,
      title: "Explicit wiki",
    })
  ).json();
  const headers = { "Idempotency-Key": randomUUID() };
  const input = {
    projectId: project.id,
    spaceId: space.spaceId,
    title: "Owned document",
    bodyMd: "# Exact\r\n- [ ] not a task",
  };
  const document = await (
    await call("/api/projects/document", input, headers)
  ).json();
  expect(
    await (await call("/api/projects/document", input, headers)).json(),
  ).toEqual(document);
  const fileResponse = await call("/api/projects/upload", {
    projectId: project.id,
    name: "sample.txt",
    mime: "text/plain",
    base64: "aGVsbG8=",
  });
  expect(fileResponse.status).toBe(200);
  const file = await fileResponse.json();
  const snapshot = await (await call("/api/snapshot")).json();
  expect(snapshot.projectMaterials).toHaveLength(3);
  expect(snapshot.items).toHaveLength(1);
  expect(
    snapshot.library.find((entry: { id: string }) => entry.id === document.id)
      .bodyMd,
  ).toBe(input.bodyMd);
  expect(
    (await (await call("/api/projects/file?id=" + file.id)).json()).base64,
  ).toBe("aGVsbG8=");
  const rawLegacyPath = `/api/v1/files/bytes?id=${file.id}&legacyProjectMaterial=1&version=1`;
  const rawLegacy = await call(rawLegacyPath);
  expect(rawLegacy.status).toBe(200);
  expect(rawLegacy.headers.get("content-type")).toBe(
    "application/octet-stream",
  );
  expect(Buffer.from(await rawLegacy.arrayBuffer())).toEqual(
    Buffer.from("hello"),
  );
  expect(
    (
      await call(
        `/api/v1/files/bytes?id=${file.id}&legacyProjectMaterial=1&version=2`,
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await call(
        `/api/v1/files/bytes?id=${file.id}&legacyProjectMaterial=2&version=1`,
      )
    ).status,
  ).toBe(400);
  const migrationToken = await (
    await call("/api/tokens/create", {
      name: "No legacy migration",
      scope: "read-write",
    })
  ).json();
  expect(
    (
      await call(rawLegacyPath, undefined, {
        Authorization: "Bearer " + migrationToken.secret,
        Cookie: "",
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await call("/api/projects/delete", {
        id: file.id,
        version: 8,
        deleted: true,
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await call("/api/projects/delete", {
        id: file.id,
        version: 1,
        deleted: true,
      })
    ).status,
  ).toBe(200);
  expect((await call("/api/projects/file?id=" + file.id)).status).toBe(404);
  expect((await call(rawLegacyPath)).status).toBe(404);
  expect(
    (
      await call("/api/projects/delete", {
        id: file.id,
        version: 2,
        deleted: false,
      })
    ).status,
  ).toBe(200);
  expect(
    (await call("/api/projects/file?id=" + file.id, undefined, { Cookie: "" }))
      .status,
  ).toBe(401);
});
it("MCP exposes constrained tools and writes only after normal authorization and idempotency", async () => {
  await login();
  const rpc = (method: string, params?: unknown) => ({
    jsonrpc: "2.0",
    id: 1,
    method,
    params,
  });
  const initialized = await (await call("/api/mcp", rpc("initialize"))).json();
  expect(initialized.result.protocolVersion).toBe("2025-03-26");
  const list = await (await call("/api/mcp", rpc("tools/list"))).json();
  expect(
    list.result.tools.map((entry: { name: string }) => entry.name),
  ).toEqual([
    "workspace_snapshot",
    "plan_preview",
    "project_document_create",
    "read_file_chunks",
    "search_documents",
    "read_document",
    "get_project",
    "list_project_tasks",
    "create_task",
    "propose_document_edit",
    "link_documents",
    "update_task",
    "complete_task",
    "reschedule_task",
    "set_task_priority",
    "move_task_to_project",
    "preview_plan",
    "publish_plan",
    "create_document",
    "move_document",
  ]);
  const project = await (
    await call("/api/work/create", { title: "MCP project", type: "PROJECT" })
  ).json();
  const space = await (
    await call("/api/projects/space/create", {
      projectId: project.id,
      title: "Explicit wiki",
    })
  ).json();
  const input = rpc("tools/call", {
    name: "project_document_create",
    arguments: {
      projectId: project.id,
      spaceId: space.spaceId,
      title: "AI draft",
      bodyMd: "raw text",
    },
  });
  expect(
    (await call("/api/mcp", input, { "Idempotency-Key": "" })).status,
  ).toBe(400);
  expect((await call("/api/mcp", input, { "X-CSRF-Token": "" })).status).toBe(
    403,
  );
  const headers = { "Idempotency-Key": randomUUID() };
  const created = await (await call("/api/mcp", input, headers)).json();
  expect(await (await call("/api/mcp", input, headers)).json()).toEqual(
    created,
  );
  expect(JSON.parse(created.result.content[0].text).provenance).toBe(
    "EXTERNAL_AI",
  );
  const unknown = await (
    await call("/api/mcp", rpc("tools/call", { name: "shell", arguments: {} }))
  ).json();
  expect(unknown.error.code).toBe(-32602);
});
it("background recurrence starts after restart without login and ignores disabled creators", async () => {
  const account = await seedOwner();
  const disabled = await host.db.accounts((store) => {
    const member = store.register(
      "disabled-worker",
      store.find("owner")!.verifier,
      false,
    );
    return store.status(member.id, member.version, "DISABLED");
  });
  const day = new Date().toISOString().slice(0, 10);
  for (const actor of [account, disabled])
    await host.db.request(actor, null, (uow) =>
      new WorkflowService(
        uow,
        { require: async () => {} },
        { now: () => new Date().toISOString() },
        { next: randomUUID },
      ).saveRecurrence(actor, {
        version: 0,
        deleted: false,
        rule: {
          title: "Background " + actor.id,
          descriptionMd: "",
          projectIds: [],
          startDate: day,
          timezone: "UTC",
          frequency: "DAILY",
          interval: 1,
        },
      }),
    );
  await host.close();
  cookie = "";
  csrf = "";
  await start();
  const tasks = (actor: typeof account) =>
    host.db.request(actor, null, (uow) =>
      uow.run(actor.workspaceId, (tx) => tx.list()),
    );
  await vi.waitFor(async () => expect(await tasks(account)).toHaveLength(1));
  expect(await tasks(disabled)).toHaveLength(0);
  await host.close();
  await start();
  await vi.waitFor(async () => expect(await tasks(account)).toHaveLength(1));
});
describe("atomic workbench organization", () => {
  it("archives projects atomically without cascading writes and preserves independent child archive", async () => {
    await login();
    const project = await (
      await call("/api/work/create", { title: "Root", type: "PROJECT" })
    ).json();
    const child = await (
      await call("/api/work/create", {
        title: "Child",
        type: "PROJECT",
        parentProjectId: project.id,
      })
    ).json();
    const task = await (
      await call("/api/work/create", {
        title: "Task",
        projectIds: [child.id],
        descriptionMd: "- [ ] Preserve Markdown",
      })
    ).json();
    const before = await (await call("/api/snapshot")).json();
    const entries = [project, child].map((item) => ({
      id: item.id,
      version: 1,
      organizationVersion: 0,
    }));
    const payload = { kind: "WORK", action: "archive", entries };
    const headers = { "Idempotency-Key": randomUUID() };
    expect((await call("/api/v1/organize", payload, headers)).status).toBe(200);
    expect((await call("/api/v1/organize", payload, headers)).status).toBe(200);
    let snapshot = await (await call("/api/snapshot")).json();
    expect(snapshot.items).toEqual(before.items);
    expect(snapshot.organization).toHaveLength(2);
    expect(
      snapshot.organization.every((m: { version: number }) => m.version === 1),
    ).toBe(true);
    expect(
      snapshot.organization.some((m: { id: string }) => m.id === task.id),
    ).toBe(false);
    expect(
      (
        await call("/api/organize", {
          ...payload,
          action: "unarchive",
          entries: [{ ...entries[0], organizationVersion: 1 }, entries[1]],
        })
      ).status,
    ).toBe(409);
    expect((await (await call("/api/snapshot")).json()).organization).toEqual(
      snapshot.organization,
    );
    expect(
      (
        await call("/api/organize", {
          ...payload,
          action: "unarchive",
          entries: [{ ...entries[0], organizationVersion: 1 }],
        })
      ).status,
    ).toBe(200);
    snapshot = await (await call("/api/snapshot")).json();
    expect(
      snapshot.organization.find((m: { id: string }) => m.id === project.id),
    ).toMatchObject({ archived: false, version: 2 });
    expect(
      snapshot.organization.find((m: { id: string }) => m.id === child.id),
    ).toMatchObject({ archived: true, version: 1 });
    expect(snapshot.items).toEqual(before.items);
  });
  it("archives independently of status, replays once, detects conflicts and restores soft deletion", async () => {
    await login();
    const task = await create("Archive me");
    const input = {
      kind: "WORK",
      action: "archive",
      entries: [{ id: task.id, version: 1, organizationVersion: 0 }],
    };
    const headers = { "Idempotency-Key": randomUUID() };
    expect((await call("/api/v1/organize", input, headers)).status).toBe(200);
    expect((await call("/api/v1/organize", input, headers)).status).toBe(200);
    let snapshot = await (await call("/api/snapshot")).json();
    expect(snapshot.items[0].status).toBe("TODO");
    expect(snapshot.organization).toHaveLength(1);
    expect(snapshot.organization[0]).toMatchObject({
      archived: true,
      version: 1,
    });
    expect((await call("/api/organize", input)).status).toBe(409);
    expect(
      (
        await call("/api/organize", {
          ...input,
          action: "unarchive",
          entries: [{ id: task.id, version: 1, organizationVersion: 1 }],
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call("/api/organize", {
          ...input,
          action: "delete",
          entries: [{ id: task.id, version: 1, organizationVersion: 2 }],
        })
      ).status,
    ).toBe(200);
    snapshot = await (await call("/api/snapshot")).json();
    expect(snapshot.items[0].deletedAt).toBeTruthy();
    expect(snapshot.items[0].version).toBe(2);
    expect(
      (
        await call("/api/work/delete", {
          id: task.id,
          version: 2,
          deleted: false,
        })
      ).status,
    ).toBe(200);
    const raw = new DatabaseSync(join(directory, "work.sqlite"), {
      readOnly: true,
    });
    try {
      expect(
        raw.prepare("SELECT count(*) n FROM organization_activity").get()?.n,
      ).toBe(2);
      expect(
        raw.prepare("SELECT count(*) n FROM organization_outbox").get()?.n,
      ).toBe(2);
    } finally {
      raw.close();
    }
  });
  it("moves notes and journals without changing text/day; conflict rolls back every item", async () => {
    await login();
    const first = await note("Keep $E=mc^2$\r\nunchanged");
    const journal = await (
      await call("/api/note/save", {
        id: null,
        version: 0,
        input: {
          title: "Journal",
          bodyMd: "日记正文",
          kind: "JOURNAL",
          day: "2026-09-14",
        },
      })
    ).json();
    const entries = [first, journal].map((n) => ({
      id: n.id,
      version: n.version,
      organizationVersion: 0,
    }));
    const input = {
      kind: "NOTE",
      action: "move",
      folder: "  量子场论  ",
      entries,
    };
    expect(
      (
        await call("/api/organize", {
          ...input,
          entries: [entries[0], { ...entries[1], version: 99 }],
        })
      ).status,
    ).toBe(409);
    expect(
      (await (await call("/api/snapshot")).json()).organization,
    ).toHaveLength(0);
    expect((await call("/api/organize", input)).status).toBe(200);
    const moved = await (await call("/api/snapshot")).json();
    expect(moved.notes.find((n: { id: string }) => n.id === first.id)).toEqual(
      first,
    );
    expect(
      moved.notes.find((n: { id: string }) => n.id === journal.id),
    ).toEqual(journal);
    expect(
      moved.organization.every(
        (m: { folder: string }) => m.folder === "量子场论",
      ),
    ).toBe(true);
    const selected = entries.map((e) => ({ ...e, organizationVersion: 1 }));
    expect(
      (
        await call("/api/organize", {
          kind: "NOTE",
          action: "delete",
          entries: [selected[0], { ...selected[1], version: 9 }],
        })
      ).status,
    ).toBe(409);
    expect(
      (await (await call("/api/snapshot")).json()).notes.every(
        (n: { deletedAt: unknown }) => !n.deletedAt,
      ),
    ).toBe(true);
    expect(
      (
        await call("/api/organize", {
          kind: "NOTE",
          action: "delete",
          entries: selected,
        })
      ).status,
    ).toBe(200);
    expect(
      (await (await call("/api/snapshot")).json()).notes.every(
        (n: { deletedAt: unknown }) => !!n.deletedAt,
      ),
    ).toBe(true);
  });
  it("rejects unknown/duplicate/oversized/foreign entries and missing auth", async () => {
    expect((await call("/api/organize", {})).status).toBe(401);
    await login();
    const n = await note();
    const e = { id: n.id, version: 1, organizationVersion: 0 };
    for (const entries of [
      [],
      [e, e],
      Array.from({ length: 101 }, (_, i) => ({ ...e, id: String(i) })),
      [null],
    ])
      expect(
        (
          await call("/api/organize", {
            kind: "NOTE",
            action: "delete",
            entries,
          })
        ).status,
      ).toBe(400);
    expect(
      (
        await call("/api/organize", {
          kind: "NOTE",
          action: "delete",
          entries: [{ ...e, id: "other-workspace" }],
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call("/api/organize", {
          kind: "NOTE",
          action: "archive",
          entries: [e],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("/api/organize", {
          kind: "NOTE",
          action: "move",
          folder: "x".repeat(81),
          entries: [e],
        })
      ).status,
    ).toBe(400);
  });
});
async function start(
  database = join(directory, "work.sqlite"),
  model?: ModelPort,
  vault?: PersonalModelVault,
  fileParser?: FileParser,
) {
  host = await createHost({
    database,
    secret,
    origin,
    webRoot: directory,
    model: model ?? null,
    ...(vault ? { vault } : {}),
    ...(fileParser ? { fileParser } : {}),
  });
  await new Promise<void>((done) => host.server.listen(0, "127.0.0.1", done));
  base = "http://127.0.0.1:" + (host.server.address() as AddressInfo).port;
}
async function call(
  path: string,
  value?: unknown,
  headers: Record<string, string> = {},
  rawBody?: Buffer,
) {
  return new Promise<Response>((resolve, reject) => {
    const req = httpRequest(
      base + path,
      {
        method: value === undefined ? "GET" : "POST",
        headers: {
          Host: "127.0.0.1:4317",
          Origin: origin,
          Cookie: cookie ?? "",
          "X-CSRF-Token": csrf ?? "",
          "Content-Type": "application/json",
          "Idempotency-Key": randomUUID(),
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const responseHeaders = new Headers();
          for (const [key, value] of Object.entries(res.headers)) {
            if (value !== undefined)
              responseHeaders.set(
                key,
                Array.isArray(value) ? value.join(",") : value,
              );
          }
          resolve(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode ?? 500,
              headers: responseHeaders,
            }),
          );
        });
      },
    );
    req.on("error", reject);
    req.end(
      rawBody ?? (value === undefined ? undefined : JSON.stringify(value)),
    );
  });
}
async function login() {
  await seedOwner();
  const response = await call("/api/session", {
    username: "owner",
    password: ownerPassword,
  });
  expect(response.status).toBe(200);
  cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
  csrf = (await response.json()).csrf;
}
async function create(title = "A") {
  const response = await call("/api/work/create", { title });
  expect(response.status).toBe(200);
  return response.json();
}
async function note(bodyMd = "原文\r\n# Thought", allowAi = false) {
  const response = await call("/api/note/save", {
    id: null,
    version: 0,
    input: {
      title: "Thought",
      bodyMd,
      kind: "NOTE",
      day: null,
      ...(allowAi
        ? {
            aiPolicy: {
              classification: "PRIVATE",
              processingBoundary: "ANY",
              aiAccess: "ASK",
            },
          }
        : {}),
    },
  });
  expect(response.status).toBe(200);
  return response.json();
}
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "arclattice-host-"));
  secret = randomBytes(32).toString("hex");
  cookie = "";
  csrf = "";
  writeFileSync(
    join(directory, "index.html"),
    "<!doctype html><title>test</title>",
  );
  await start();
});
afterEach(async () => {
  await host.close();
  if (
    !resolve(directory).startsWith(resolve(tmpdir()) + sep + "arclattice-host-")
  )
    throw new Error("Unsafe cleanup");
  rmSync(directory, { recursive: true, maxRetries: 5, retryDelay: 100 });
});

describe("private HTTP host", () => {
  it("permanent and dated API tokens preserve defaults, revoke normally, and reject invalid durations", async () => {
    await claim();
    await signIn();
    expect(
      (
        await call("/api/tokens/create", {
          name: "Invalid grants",
          scope: "write",
          grants: ["unknown:scope"],
        })
      ).status,
    ).toBe(400);
    for (const days of [undefined, 30, 90, 365, null]) {
      const result = await call("/api/tokens/create", {
        name: "duration",
        scope: "read-write",
        ...(days !== undefined ? { days } : {}),
      });
      expect(result.status).toBe(201);
      const token = await result.json();
      if (days === null) expect(token.expiresAt).toBeNull();
      else
        expect(
          Math.round((Date.parse(token.expiresAt) - Date.now()) / 86400000),
        ).toBe(days ?? 30);
      const headers = { Authorization: "Bearer " + token.secret };
      expect((await call("/api/snapshot", undefined, headers)).status).toBe(
        200,
      );
      await call("/api/tokens/revoke", { id: token.id });
      expect((await call("/api/snapshot", undefined, headers)).status).toBe(
        401,
      );
    }
    for (const days of [0, -1, 7, "365", 365.5])
      expect(
        (
          await call("/api/tokens/create", {
            name: "bad",
            scope: "write",
            days,
          })
        ).status,
      ).toBe(400);
  }, 15000);
  it("draft reauthentication rejects a different identity before changing the session cookie", async () => {
    const owner = await claim();
    await registerUser();
    await signIn();
    const rejected = await call("/api/session", {
      username: "reader",
      password,
      expectedContext: {
        workspaceId: owner.workspaceId,
        principalId: owner.principalId,
      },
    });
    expect(rejected.status).toBe(403);
    expect(rejected.headers.get("set-cookie")).toBeNull();
    expect(
      (await (await call("/api/session")).json()).context.principalId,
    ).toBe(owner.principalId);
    expect(
      (
        await call("/api/session", {
          username: "owner",
          password,
          expectedContext: {
            workspaceId: owner.workspaceId,
            principalId: owner.principalId,
          },
        })
      ).status,
    ).toBe(200);
  }, 15000);
  it("named route selection persists approval identity and deletion never falls back", async () => {
    await host.close();
    const vault = openPersonalVault(join(directory, "named-vault"));
    const sent = vi.fn(async () => "named output");
    await start(undefined, undefined, {
      ...vault,
      resolve(actor, scope, profileId) {
        const actual = vault.resolve(actor, scope, profileId);
        return actual ? { route: actual.route, complete: sent } : null;
      },
    });
    await claim();
    const input = {
      scope: "personal",
      endpoint: "https://provider.example/v1",
      protocol: "chat",
      model: "default-model",
      key: "TEST-ONLY-NAMED-KEY",
      maxRunsPerDay: 10,
    };
    for (const profileId of ["default", "research"])
      expect(
        (
          await call("/api/ai/providers/save", {
            version: 0,
            input: { ...input, profileId, model: profileId },
          })
        ).status,
      ).toBe(200);
    const state = await (await call("/api/ai?profileId=research")).json();
    expect(state.routes).toHaveLength(2);
    expect(state.route.profileId).toBe("research");
    expect(JSON.stringify(state)).not.toContain(input.key);
    expect(
      (await (await call("/api/ai?profileId=missing")).json()).route,
    ).toBeNull();
    expect(
      (await call("/api/ai/propose", { prompt: "test", profileId: "missing" }))
        .status,
    ).toBe(409);
    const run = await (
      await call("/api/ai/propose", { prompt: "test", profileId: "research" })
    ).json();
    expect(run.route.profileId).toBe("research");
    expect(
      (
        await call("/api/ai/decide", {
          id: run.id,
          version: run.version,
          approve: true,
        })
      ).status,
    ).toBe(200);
    await vi.waitFor(async () => {
      const current = await (await call("/api/ai")).json();
      expect(
        current.runs.find((r: { id: string }) => r.id === run.id).status,
      ).toBe("SUCCEEDED");
    });
    expect(sent).toHaveBeenCalledTimes(1);
    const stale = await (
      await call("/api/ai/propose", { prompt: "stale", profileId: "research" })
    ).json();
    expect(
      (
        await call("/api/ai/providers/remove", {
          scope: "personal",
          version: 1,
          profileId: "research",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call("/api/ai/decide", {
          id: stale.id,
          version: stale.version,
          approve: true,
        })
      ).status,
    ).toBe(409);
    expect(sent).toHaveBeenCalledTimes(1);
    expect((await (await call("/api/ai")).json()).route.model).toBe("default");
  }, 15000);
  it("personal providers and reviewed AI edits are isolated, version-bound and atomic", async () => {
    await host.close();
    const vault = openPersonalVault(join(directory, "vault"));
    const complete = vi.fn(async () => "");
    await start(undefined, undefined, {
      ...vault,
      resolve(actor, scope, profileId) {
        const actual = vault.resolve(actor, scope, profileId);
        return actual ? { route: actual.route, complete } : null;
      },
    });
    const admin = await claim();
    await registerUser();
    await signIn();
    const privateKey = "ISOLATED-TEST-KEY";
    const input = {
      scope: "personal",
      endpoint: "https://provider.example/v1",
      protocol: "chat",
      model: "test-model",
      key: privateKey,
      maxRunsPerDay: 10,
    };
    expect(
      (await call("/api/ai/providers/save", { version: 0, input })).status,
    ).toBe(200);
    expect(await (await call("/api/ai/providers")).text()).not.toContain(
      privateKey,
    );
    const parent = await space();
    const parentScope = "SPACE:" + parent.id;
    expect(
      (
        await call("/api/ai/providers/save", {
          version: 0,
          input: { ...input, scope: parentScope },
        })
      ).status,
    ).toBe(200);
    const ownerNote = await note();
    await signIn("reader");
    expect(await (await call("/api/ai/providers")).json()).toEqual([]);
    expect(
      (
        await call("/api/ai/providers/save", {
          version: 0,
          input: { ...input, scope: parentScope },
        })
      ).status,
    ).toBe(404);
    expect(
      (await call("/api/ai/providers/save", { version: 0, input })).status,
    ).toBe(200);
    const denied = await note("private");
    expect(
      (
        await call("/api/ai/propose", {
          prompt: "blocked",
          sources: [{ kind: "NOTE", id: denied.id, version: denied.version }],
        })
      ).status,
    ).toBe(403);
    expect(complete).not.toHaveBeenCalled();
    const own = await note("one", true),
      second = await note("two", true);
    expect(
      (
        await call("/api/ai/propose", {
          prompt: "read foreign",
          sources: [{ kind: "NOTE", id: ownerNote.id, version: 1 }],
        })
      ).status,
    ).toBe(404);
    const sources = [own, second].map((n) => ({
      kind: "NOTE",
      id: n.id,
      version: n.version,
    }));
    const edits = sources.map((n, i) => ({
      ...n,
      title: "AI " + i,
      bodyMd: "updated " + i,
    }));
    complete.mockResolvedValue(JSON.stringify({ edits }));
    const proposal = await (
      await call("/api/ai/propose", { prompt: "review", sources })
    ).json();
    expect(proposal.createdBy).not.toBe(admin.principalId);
    expect(proposal.context).toHaveLength(2);
    expect(complete).not.toHaveBeenCalled();
    expect(
      (
        await call("/api/ai/decide", {
          id: proposal.id,
          version: 1,
          approve: true,
        })
      ).status,
    ).toBe(200);
    let run: { id: string; version: number; status: string; updatedBy: string };
    await vi.waitFor(async () => {
      run = (await (await call("/api/ai")).json()).runs[0];
      expect(run.status).toBe("SUCCEEDED");
    });
    expect(run!.updatedBy).toBe(proposal.createdBy);
    const replay = await call("/api/ai/events/stream?id=" + run!.id);
    expect(replay.headers.get("content-type")).toBe("text/event-stream");
    expect(await replay.text()).toContain('"done":true');
    const eventPage = await (
      await call("/api/ai/events?id=" + run!.id + "&after=0")
    ).json();
    expect(eventPage).toMatchObject({
      done: true,
      cursor: eventPage.events.length,
    });
    expect(eventPage).toEqual({ events: [], cursor: 0, done: true });
    const unchangedEvents = await (
      await call("/api/ai/events?id=" + run!.id + "&after=" + eventPage.cursor)
    ).json();
    expect(unchangedEvents).toEqual({
      events: [],
      cursor: eventPage.cursor,
      done: true,
    });
    expect(
      (await call("/api/ai/events?id=" + run!.id + "&after=-1")).status,
    ).toBe(400);
    expect(
      (
        await call("/api/ai/events/stream?id=" + run!.id, undefined, {
          Cookie: "",
        })
      ).status,
    ).toBe(401);
    expect(
      (await (await call("/api/snapshot")).json()).notes.find(
        (n: { id: string }) => n.id === own.id,
      ).bodyMd,
    ).toBe("one");
    await call("/api/note/save", {
      id: second.id,
      version: 1,
      input: {
        kind: "NOTE",
        day: null,
        title: second.title,
        bodyMd: "concurrent human edit",
      },
    });
    const apply = { id: run!.id, version: run!.version, indices: [0, 1] };
    expect((await call("/api/ai/apply", apply)).status).toBe(409);
    expect(
      (await (await call("/api/snapshot")).json()).notes.find(
        (n: { id: string }) => n.id === own.id,
      ).bodyMd,
    ).toBe("one");
    const key = { "Idempotency-Key": randomUUID() };
    const selected = { ...apply, indices: [0] };
    const applied = await call("/api/ai/apply", selected, key);
    expect(applied.status).toBe(200);
    expect((await applied.json())[0].provenance).toBe("EXTERNAL_AI");
    expect((await call("/api/ai/apply", selected, key)).status).toBe(200);
    expect((await call("/api/ai/apply", selected)).status).toBe(409);
    const bearer = await tokenFor("read-write");
    for (const path of [
      "/api/ai/providers/save",
      "/api/ai/propose",
      "/api/ai/apply",
    ])
      expect(
        (await call(path, {}, { Authorization: "Bearer " + bearer.secret }))
          .status,
      ).toBe(403);
    await signIn();
    expect((await call("/api/ai/apply", selected)).status).toBe(404);
    const scoped = await (
      await call("/api/ai/propose", {
        prompt: "scoped review",
        scope: parentScope,
      })
    ).json();
    expect(
      (
        await call("/api/library/delete", {
          id: parent.id,
          version: 1,
          deleted: true,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call("/api/ai/propose", {
          prompt: "deleted scope",
          scope: parentScope,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call("/api/ai/decide", {
          id: scoped.id,
          version: 1,
          approve: true,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call("/api/ai/decide", {
          id: scoped.id,
          version: 1,
          approve: false,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call("/api/ai/providers/remove", {
          scope: parentScope,
          version: 1,
        })
      ).status,
    ).toBe(200);
    const raw = new DatabaseSync(join(directory, "work.sqlite"), {
      readOnly: true,
    });
    try {
      for (const table of ["request_receipt", "audit_record", "agent_run"])
        expect(
          JSON.stringify(raw.prepare("SELECT * FROM " + table).all()),
        ).not.toContain(privateKey);
    } finally {
      raw.close();
    }
  }, 20000);
  const password = "Test-only-password-123";
  async function claim() {
    const account = await seedOwner();
    await login();
    return account;
  }
  async function signIn(username = "owner", candidate = password) {
    cookie = "";
    csrf = "";
    const response = await call("/api/session", {
      username,
      password: candidate,
    });
    expect(response.status).toBe(200);
    cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
    csrf = (await response.json()).csrf;
  }
  async function registerUser() {
    expect(
      (await call("/api/register", { username: "reader", password })).status,
    ).toBe(404);
    const verifier = await passwordHash(password);
    await host.db.accounts((store) =>
      store.register("reader", verifier, false),
    );
    const accounts = (await (await call("/api/admin")).json()).accounts;
    const user = accounts.find(
      (a: { username: string }) => a.username === "reader",
    );
    expect(user.status).toBe("PENDING");
    expect(
      (await call("/api/session", { username: "reader", password })).status,
    ).toBe(401);
    const response = await call("/api/admin/status", {
      id: user.id,
      version: user.version,
      status: "ACTIVE",
    });
    expect(response.status).toBe(200);
    return response.json();
  }
  async function tokenFor(scope = "write", grants?: readonly string[]) {
    const response = await call("/api/tokens/create", {
      name: "Local AI",
      scope,
      ...(grants ? { grants } : {}),
    });
    expect(response.status).toBe(201);
    return response.json();
  }
  async function space(title = "量子场论") {
    const response = await call("/api/library/save", {
      id: null,
      version: 0,
      input: { kind: "SPACE", spaceId: null, title, bodyMd: "# Overview" },
    });
    expect(response.status).toBe(200);
    return response.json();
  }
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXs8AAAAASUVORK5CYII=";
  it("operator-provisioned accounts are isolated; public registration and legacy claiming are disabled", async () => {
    expect(
      (await call("/api/account/claim", { username: "attacker", password }))
        .status,
    ).toBe(401);
    const admin = await claim();
    expect(admin.role).toBe("ADMIN");
    expect(admin.workspaceId).toBe(host.context.workspaceId);
    expect(
      (await call("/api/account/claim", { username: "second", password }))
        .status,
    ).toBe(403);
    const original = await note(),
      library = await space();
    const asset = await (
      await call("/api/library/upload", {
        spaceId: library.id,
        name: "x.png",
        mime: "image/png",
        base64: png,
      })
    ).json();
    const user = await registerUser();
    expect(user.workspaceId).not.toBe(admin.workspaceId);
    await signIn("reader");
    const snapshot = await (await call("/api/v1/snapshot")).json();
    expect(snapshot.notes).toEqual([]);
    expect(await (await call("/api/library")).json()).toEqual([]);
    for (const path of [
      "/api/admin",
      "/api/revisions?id=" + original.id,
      "/api/library/revisions?id=" + library.id,
      "/api/library/asset?id=" + asset.id,
    ])
      expect([403, 404]).toContain((await call(path)).status);
    expect((await call("/api/backup", {})).status).toBe(403);
    expect(
      (
        await call("/api/work/create", {
          title: "bad",
          workspaceId: admin.workspaceId,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("/api/library/save", {
          id: null,
          version: 0,
          input: {
            kind: "DOCUMENT",
            spaceId: library.id,
            title: "bad",
            bodyMd: "",
          },
        })
      ).status,
    ).toBe(404);
  }, 15000);
  it("granular credentials never fall back, cannot mint tokens, and authorize every MCP tool", async () => {
    await claim();
    await signIn();
    const readOnly = await tokenFor("read-write", ["knowledge:read"]);
    const wrongScope = await tokenFor("read-write", ["proposals:read"]);
    for (const route of Object.keys(granularRouteGrants)) {
      const rejected = await call(route, undefined, {
        Authorization: "Bearer " + wrongScope.secret,
        Cookie: "",
      });
      expect(rejected.status, route).toBe(403);
    }
    const allGrants = await tokenFor("read-write", [...apiScopes]);
    for (const route of [
      "/api/ai/propose",
      "/api/ai/decide",
      "/api/ai/apply",
      "/api/ai/harness/decide",
      "/api/memo/save",
      "/api/tokens/create",
    ]) {
      expect(
        (
          await call(
            route,
            {},
            { Authorization: "Bearer " + allGrants.secret, Cookie: "" },
          )
        ).status,
        route,
      ).toBe(403);
    }
    const headers = {
      Authorization: "Bearer " + readOnly.secret,
      Cookie: "",
      "X-CSRF-Token": "",
    };
    for (const prefix of ["/api", "/api/v1"]) {
      expect((await call(prefix + "/library", undefined, headers)).status).toBe(
        200,
      );
      for (const path of [
        "/projects/activity?id=missing",
        "/snapshot",
        "/memo?targetKind=TASK&targetId=missing",
        "/files/bytes?id=missing",
        "/ai/run?id=missing",
      ])
        expect(
          (await call(prefix + path, undefined, headers)).status,
          path,
        ).toBe(403);
      for (const path of [
        "/note/save",
        "/organize",
        "/tokens/create",
        "/ai/propose",
        "/ai/decide",
        "/ai/apply",
      ])
        expect((await call(prefix + path, {}, headers)).status, path).toBe(403);
      expect(
        (
          await call(prefix + "/library", undefined, {
            ...headers,
            "X-Workspace-Id": randomUUID(),
          })
        ).status,
      ).toBe(403);
    }
    const executeOnly = await tokenFor("read-write", ["capabilities:execute"]);
    const invoke = (secret: string, name: string, args: unknown) =>
      call(
        "/api/v1/mcp",
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args },
        },
        { ...headers, Authorization: "Bearer " + secret },
      );
    const denied = await invoke(executeOnly.secret, "create_task", {
      title: "Must not exist",
    });
    expect(JSON.stringify(await denied.json())).toContain("FORBIDDEN");
    const taskOnly = await tokenFor("read-write", ["tasks:write"]);
    expect(
      (
        await invoke(taskOnly.secret, "create_task", {
          title: "Missing execution grant",
        })
      ).status,
    ).toBe(403);
    const taskExecutor = await tokenFor("write", [
      "tasks:write",
      "capabilities:execute",
    ]);
    const created = await invoke(taskExecutor.secret, "create_task", {
      title: "Explicit tool execution",
    });
    expect(created.status).toBe(403);
    const reader = await tokenFor("write", [
      "capabilities:execute",
      "knowledge:read",
    ]);
    const permitted = await invoke(reader.secret, "search_documents", {
      query: "missing",
    });
    expect(permitted.status).toBe(200);
    expect((await permitted.json()).result).not.toHaveProperty("isError", true);
    const publicReader = await tokenFor("read-write", ["workspace:read"]);
    expect(
      (
        await call("/api/bootstrap", undefined, {
          ...headers,
          Authorization: "Bearer " + publicReader.secret,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          "/api/tokens/create",
          { name: "CSRF", scope: "write", grants: ["tasks:write"] },
          { "X-CSRF-Token": "wrong" },
        )
      ).status,
    ).toBe(403);
    await call("/api/tokens/revoke", { id: readOnly.id });
    expect((await call("/api/v1/library", undefined, headers)).status).toBe(
      401,
    );
  });
  it("granular credentials cannot enumerate another account, forge ownership or select its workspace", async () => {
    await claim();
    await signIn();
    const original = await space("Owner boundary");
    await registerUser();
    await signIn("reader");
    const token = await tokenFor("read-write", [
      "knowledge:read",
      "knowledge:write",
    ]);
    const headers = { Authorization: "Bearer " + token.secret, Cookie: "" };
    expect(
      (
        await call(
          "/api/v1/library/revisions?id=" + original.id,
          undefined,
          headers,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await call("/api/v1/library", undefined, {
          ...headers,
          "X-Workspace-Id": original.workspaceId,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          "/api/v1/library/save",
          {
            id: original.id,
            version: original.version,
            input: {
              kind: "SPACE",
              spaceId: null,
              title: "Must not overwrite",
              bodyMd: "forged",
            },
          },
          headers,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await call(
          "/api/v1/library/save",
          {
            id: null,
            version: 0,
            ownerId: original.createdBy,
            input: {
              kind: "SPACE",
              spaceId: null,
              title: "Forged identity",
              bodyMd: "",
            },
          },
          headers,
        )
      ).status,
    ).toBe(400);
    await signIn();
    expect((await (await call("/api/library")).json())[0]).toEqual(original);
  });
  it("granular grants are rechecked after authentication and before receipts when a token is revoked during body upload", async () => {
    await claim();
    await signIn();
    const token = await tokenFor("write", ["knowledge:write"]);
    const payload = JSON.stringify({
      id: null,
      version: 0,
      input: {
        kind: "SPACE",
        spaceId: null,
        title: "Revoked upload",
        bodyMd: "must not be saved",
      },
    });
    const observed = vi.spyOn(host.db, "accounts");
    let upload!: ReturnType<typeof httpRequest>;
    const result = new Promise<number>((resolveResponse, reject) => {
      upload = httpRequest(
        base + "/api/v1/library/save",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + token.secret,
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
            Host: "127.0.0.1:4317",
            "Idempotency-Key": randomUUID(),
          },
        },
        (response) => {
          response.resume();
          response.on("end", () => resolveResponse(response.statusCode!));
        },
      );
      upload.on("error", reject);
      upload.write(payload.slice(0, 1));
    });
    try {
      await vi.waitFor(async () => {
        const results = await Promise.all(
          observed.mock.results
            .filter((entry) => entry.type === "return")
            .map((entry) => entry.value),
        );
        expect(
          results.some(
            (entry) =>
              entry &&
              typeof entry === "object" &&
              "credential" in entry &&
              (entry.credential as { id?: string } | null)?.id === token.id,
          ),
        ).toBe(true);
      });
      expect((await call("/api/tokens/revoke", { id: token.id })).status).toBe(
        200,
      );
      upload.end(payload.slice(1));
      expect(await result).toBe(401);
      expect(await (await call("/api/library")).json()).toEqual([]);
    } finally {
      observed.mockRestore();
      upload.destroy();
    }
  });
  it("external AI credentials are scoped, hashed, versioned, idempotent and rechecked before replay", async () => {
    await claim();
    await signIn();
    const granular = await tokenFor("write", ["knowledge:read"]);
    const granularHeaders = {
      Authorization: "Bearer " + granular.secret,
      Cookie: "",
    };
    expect(
      (await call("/api/v1/library", undefined, granularHeaders)).status,
    ).toBe(200);
    expect(
      (
        await call(
          "/api/v1/library/save",
          {
            id: null,
            version: 0,
            input: {
              kind: "SPACE",
              spaceId: null,
              title: "Denied write",
              bodyMd: "",
            },
          },
          granularHeaders,
        )
      ).status,
    ).toBe(403);
    const token = await tokenFor();
    const headers = {
      Authorization: "Bearer " + token.secret,
      Cookie: "",
      "X-CSRF-Token": "",
      "Idempotency-Key": randomUUID(),
    };
    for (const path of [
      "/api/snapshot",
      "/api/admin",
      "/api/tokens",
      "/api/library",
    ])
      expect((await call(path, undefined, headers)).status).toBe(403);
    for (const path of [
      "/api/backup",
      "/api/ai/propose",
      "/api/tokens/create",
      "/api/account/claim",
    ])
      expect((await call(path, {}, headers)).status).toBe(403);
    const input = {
      id: null,
      version: 0,
      input: {
        kind: "SPACE",
        spaceId: null,
        title: "Local AI research",
        bodyMd: "Original Markdown",
      },
    };
    const response = await call("/api/v1/library/save", input, headers);
    expect(response.status).toBe(200);
    const entry = await response.json();
    expect(entry.provenance).toBe("EXTERNAL_AI");
    expect(entry.createdBy).toBe(token.principalId);
    expect(
      await (await call("/api/v1/library/save", input, headers)).json(),
    ).toEqual(entry);
    expect(
      (
        await call(
          "/api/v1/library/save",
          { ...input, input: { ...input.input, title: "changed" } },
          headers,
        )
      ).status,
    ).toBe(409);
    expect(await (await call("/api/library")).json()).toHaveLength(1);
    const noteResponse = await call(
      "/api/v1/note/save",
      {
        id: null,
        version: 0,
        input: { kind: "NOTE", day: null, title: "AI note", bodyMd: "整理" },
      },
      { ...headers, "Idempotency-Key": randomUUID() },
    );
    expect((await noteResponse.json()).provenance).toBe("EXTERNAL_AI");
    const raw = new DatabaseSync(join(directory, "work.sqlite"), {
      readOnly: true,
    });
    try {
      expect(
        raw.prepare("SELECT hash FROM api_credential").get()?.hash,
      ).toMatch(/^[a-f0-9]{64}$/);
      expect(
        JSON.stringify(raw.prepare("SELECT * FROM request_receipt").all()),
      ).not.toContain(token.secret);
    } finally {
      raw.close();
    }
    expect((await call("/api/tokens/revoke", { id: token.id })).status).toBe(
      200,
    );
    expect((await call("/api/v1/library/save", input, headers)).status).toBe(
      401,
    );
  }, 15000);
  it("organization isolates real workspaces and permits scoped write tokens with revocation checks", async () => {
    await claim();
    const original = await note("Owner private note");
    await registerUser();
    await signIn("reader");
    const own = await note("Reader note");
    const token = await tokenFor("write");
    const headers = {
      Authorization: "Bearer " + token.secret,
      Cookie: "",
      "X-CSRF-Token": "",
      "Idempotency-Key": randomUUID(),
    };
    const entry = (id: string) => ({ id, version: 1, organizationVersion: 0 });
    const input = {
      kind: "NOTE",
      action: "move",
      folder: "Physics",
      entries: [entry(own.id)],
    };
    expect(
      (
        await call(
          "/api/v1/organize",
          { ...input, entries: [entry(own.id), entry(original.id)] },
          headers,
        )
      ).status,
    ).toBe(404);
    expect((await (await call("/api/snapshot")).json()).organization).toEqual(
      [],
    );
    headers["Idempotency-Key"] = randomUUID();
    expect((await call("/api/v1/organize", input, headers)).status).toBe(200);
    expect((await call("/api/v1/organize", input, headers)).status).toBe(200);
    expect(
      (await (await call("/api/snapshot")).json()).organization,
    ).toMatchObject([{ id: own.id, folder: "Physics", version: 1 }]);
    expect((await call("/api/tokens/revoke", { id: token.id })).status).toBe(
      200,
    );
    expect((await call("/api/v1/organize", input, headers)).status).toBe(401);
    await signIn();
    const owner = await (await call("/api/snapshot")).json();
    expect(owner.organization).toEqual([]);
    expect(owner.notes[0]).toEqual(original);
  }, 15000);
  it("read-write credentials can update their own lectures but cannot manage credentials or read another workspace", async () => {
    await claim();
    const original = await space();
    await registerUser();
    await signIn("reader");
    const own = await space("统计物理"),
      token = await tokenFor("read-write");
    const headers = { Authorization: "Bearer " + token.secret };
    const entries = await (
      await call("/api/v1/library", undefined, headers)
    ).json();
    expect(entries.map((e: { id: string }) => e.id)).toEqual([own.id]);
    expect(
      (
        await call(
          "/api/v1/library/revisions?id=" + original.id,
          undefined,
          headers,
        )
      ).status,
    ).toBe(404);
    const value = {
      id: own.id,
      version: 1,
      input: {
        kind: "SPACE",
        spaceId: null,
        title: own.title,
        bodyMd: "# Updated by local AI",
      },
    };
    expect((await call("/api/v1/library/save", value, headers)).status).toBe(
      200,
    );
    expect((await call("/api/v1/library/save", value, headers)).status).toBe(
      409,
    );
    expect(
      (await call("/api/tokens/revoke", { id: token.id }, headers)).status,
    ).toBe(403);
  }, 15000);
  it("disable immediately invalidates sessions and tokens, including after re-enabling the account", async () => {
    await claim();
    const adminCookie = cookie,
      adminCsrf = csrf;
    const user = await registerUser();
    await signIn("reader");
    const token = await tokenFor("read-write"),
      userCookie = cookie;
    const response = await call(
      "/api/admin/status",
      { id: user.id, version: user.version, status: "DISABLED" },
      { Cookie: adminCookie, "X-CSRF-Token": adminCsrf },
    );
    expect(response.status).toBe(200);
    const disabled = await response.json();
    expect((await call("/api/snapshot")).status).toBe(401);
    expect(
      (
        await call("/api/snapshot", undefined, {
          Authorization: "Bearer " + token.secret,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await call(
          "/api/admin/status",
          { id: user.id, version: disabled.version, status: "ACTIVE" },
          { Cookie: adminCookie, "X-CSRF-Token": adminCsrf },
        )
      ).status,
    ).toBe(200);
    expect(
      (await call("/api/snapshot", undefined, { Cookie: userCookie })).status,
    ).toBe(401);
    expect(
      (
        await call("/api/snapshot", undefined, {
          Authorization: "Bearer " + token.secret,
        })
      ).status,
    ).toBe(401);
  }, 15000);
  it.each(["bearer", "cookie"])(
    "rejects a delayed %s write after revocation, without a receipt or event",
    async (mode) => {
      await claim();
      await signIn();
      const integration = await tokenFor("read-write");
      const key = randomUUID();
      let markReceived!: () => void;
      const received = new Promise<void>((resolve) => {
        markReceived = resolve;
      });
      host.server.once("request", () => setImmediate(markReceived));
      let finish!: () => void;
      const response = new Promise<number>((resolve, reject) => {
        const raw = JSON.stringify({ title: "Must never commit" });
        const req = httpRequest(
          base + "/api/work/create",
          {
            method: "POST",
            headers: {
              Host: "127.0.0.1:4317",
              Origin: origin,
              Cookie: cookie,
              "X-CSRF-Token": csrf,
              "Content-Type": "application/json",
              "Idempotency-Key": key,
              ...(mode === "bearer"
                ? { Authorization: "Bearer " + integration.secret }
                : {}),
            },
          },
          (res) => {
            res.resume();
            res.on("end", () => resolve(res.statusCode ?? 500));
          },
        );
        req.on("error", reject);
        req.write(raw.slice(0, -1));
        finish = () => req.end(raw.slice(-1));
      });
      try {
        await received;
        expect(
          (
            await call(
              mode === "bearer" ? "/api/tokens/revoke" : "/api/logout",
              mode === "bearer" ? { id: integration.id } : {},
            )
          ).status,
        ).toBe(200);
      } finally {
        finish();
      }
      expect(await response).toBe(401);
      expect(
        (await host.db.inspectEvents(host.context.workspaceId)).activity,
      ).toHaveLength(0);
      const raw = new DatabaseSync(join(directory, "work.sqlite"), {
        readOnly: true,
      });
      try {
        expect(raw.prepare("SELECT count(*) n FROM work_item").get()?.n).toBe(
          0,
        );
        expect(
          raw
            .prepare("SELECT count(*) n FROM request_receipt WHERE key=?")
            .get(key)?.n,
        ).toBe(0);
      } finally {
        raw.close();
      }
    },
    15000,
  );
  it("never replays a token secret and keeps admin status retries version-safe", async () => {
    await claim();
    await signIn();
    const headers = { "Idempotency-Key": randomUUID() };
    expect(
      (
        await call(
          "/api/tokens/create",
          { name: "one", scope: "write" },
          headers,
        )
      ).status,
    ).toBe(201);
    const replay = await call(
      "/api/tokens/create",
      { name: "one", scope: "write" },
      headers,
    );
    expect(replay.status).toBe(409);
    expect(await replay.text()).not.toContain("arc_");
    expect(await (await call("/api/tokens")).json()).toHaveLength(1);
    const user = await registerUser();
    const statusHeaders = { "Idempotency-Key": randomUUID() };
    const input = { id: user.id, version: user.version, status: "DISABLED" };
    const disabled = await (
      await call("/api/admin/status", input, statusHeaders)
    ).json();
    expect(
      await (await call("/api/admin/status", input, statusHeaders)).json(),
    ).toEqual(disabled);
    expect(
      (
        await call(
          "/api/admin/status",
          { ...input, status: "ACTIVE" },
          statusHeaders,
        )
      ).status,
    ).toBe(409);
  }, 15000);
  it("password changes verify the old password and revoke all sessions and integration tokens", async () => {
    await claim();
    await signIn();
    const token = await tokenFor("read-write");
    expect(
      (
        await call("/api/account/password", {
          current: "wrong-password",
          password: "Changed-password-123",
        })
      ).status,
    ).toBe(401);
    expect((await call("/api/snapshot")).status).toBe(200);
    expect(
      (
        await call("/api/account/password", {
          current: password,
          password: "Changed-password-123",
        })
      ).status,
    ).toBe(200);
    expect((await call("/api/snapshot")).status).toBe(401);
    expect(
      (
        await call("/api/snapshot", undefined, {
          Authorization: "Bearer " + token.secret,
        })
      ).status,
    ).toBe(401);
    expect(
      (await call("/api/session", { username: "owner", password })).status,
    ).toBe(401);
    await signIn("owner", "Changed-password-123");
  }, 15000);
  it("chunked images exceed old size and quota, remain private, and survive backup", async () => {
    const verifier = await passwordHash(password);
    await host.db.accounts((store) => store.register("owner", verifier, true));
    await signIn();
    const uploadId = randomUUID();
    const bytes = Buffer.alloc(21 * 1024 * 1024 + 3, 42);
    Buffer.from(png, "base64").copy(bytes);
    const metadata = {
      uploadId,
      spaceId: null,
      name: "large.png",
      mime: "image/png",
    };
    const url = "/api/library/asset?id=" + uploadId;
    let lastValue = {},
      lastHeaders = {};
    for (
      let offset = 0, index = 0;
      offset < bytes.length;
      offset += 262144, index++
    ) {
      const value = {
        ...metadata,
        index,
        final: offset + 262144 >= bytes.length,
        base64: bytes.subarray(offset, offset + 262144).toString("base64"),
      };
      const headers = { "Idempotency-Key": randomUUID() };
      const response = await call(
        "/api/v1/library/upload-chunk",
        value,
        headers,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        id: uploadId,
        url: value.final ? url : null,
      });
      if (index === 0) {
        expect((await call(url)).status).toBe(404);
        expect(
          (await call("/api/v1/library/upload-chunk", value, headers)).status,
        ).toBe(200);
        expect(
          (await call("/api/library/upload-chunk", { ...value, index: 2 }))
            .status,
        ).toBe(409);
        expect(
          (
            await call("/api/library/upload-chunk", {
              ...value,
              index: 1,
              name: "changed.png",
            })
          ).status,
        ).toBe(409);
      }
      lastValue = value;
      lastHeaders = headers;
    }
    expect(
      (await call("/api/v1/library/upload-chunk", lastValue, lastHeaders))
        .status,
    ).toBe(200);
    expect((await call("/api/library/upload-chunk", lastValue)).status).toBe(
      409,
    );
    expect(
      Buffer.from(await (await call(url)).arrayBuffer()).equals(bytes),
    ).toBe(true);
    expect((await call(url, undefined, { Cookie: "" })).status).toBe(401);
    for (const invalid of [
      { base64: Buffer.alloc(262145).toString("base64") },
      { base64: Buffer.alloc(12).toString("base64") },
      { mime: "image/svg+xml" },
      { index: -1 },
      { final: "yes" },
    ])
      expect(
        (
          await call("/api/library/upload-chunk", {
            ...metadata,
            uploadId: randomUUID(),
            index: 0,
            final: true,
            base64: png,
            ...invalid,
          })
        ).status,
      ).toBe(400);
    const backup = join(directory, "large-image.sqlite"),
      restoredPath = join(directory, "large-image-restored.sqlite");
    await host.db.backup(backup);
    await restoreDatabase(backup, restoredPath);
    const restored = new DatabaseSync(restoredPath, { readOnly: true });
    try {
      const rows = restored
        .prepare(
          "SELECT base64 FROM library_asset_chunk WHERE upload_id=? ORDER BY chunk_index",
        )
        .all(uploadId);
      expect(
        Buffer.concat(
          rows.map((row) => Buffer.from(String(row.base64), "base64")),
        ).equals(bytes),
      ).toBe(true);
      expect(
        restored
          .prepare(
            "SELECT count(*) n FROM connected_activity WHERE entity_id=? AND type='ASSET_UPLOADED'",
          )
          .get(uploadId)?.n,
      ).toBe(1);
      expect(restored.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      restored.close();
    }
    await host.db.accounts((store) => {
      const user = store.register("reader", verifier, false);
      store.status(user.id, user.version, "ACTIVE");
    });
    await signIn("reader");
    expect((await call(url)).status).toBe(404);
    expect(
      (
        await call("/api/library/upload-chunk", {
          ...metadata,
          index: 1,
          final: true,
          base64: png,
        })
      ).status,
    ).toBe(409);
  }, 30000);
  it("workspace images are authenticated, isolated, idempotent and included in backups", async () => {
    const verifier = await passwordHash(password);
    await host.db.accounts((store) => store.register("owner", verifier, true));
    await signIn();
    const value = {
      spaceId: null,
      name: "paste.png",
      mime: "image/png",
      base64: png,
    };
    const headers = { "Idempotency-Key": randomUUID() };
    const upload = await call("/api/library/upload", value, headers);
    expect(upload.status).toBe(200);
    const asset = await upload.json();
    expect(
      await (await call("/api/library/upload", value, headers)).json(),
    ).toEqual(asset);
    expect(
      Buffer.from(await (await call(asset.url)).arrayBuffer()).toString(
        "base64",
      ),
    ).toBe(png);
    expect((await call(asset.url, undefined, { Cookie: "" })).status).toBe(401);
    for (const invalid of [
      { mime: "image/svg+xml", base64: png },
      { mime: "image/png", base64: Buffer.alloc(16).toString("base64") },
      { mime: "image/png", base64: Buffer.alloc(500001).toString("base64") },
    ])
      expect(
        (await call("/api/library/upload", { ...value, ...invalid })).status,
      ).toBe(400);
    const parent = await space();
    const linked = await (
      await call("/api/library/upload", { ...value, spaceId: parent.id })
    ).json();
    expect((await call(linked.url)).status).toBe(200);
    expect(
      (
        await call("/api/library/delete", {
          id: parent.id,
          version: parent.version,
          deleted: true,
        })
      ).status,
    ).toBe(200);
    expect((await call(linked.url)).status).toBe(404);
    expect((await call(asset.url)).status).toBe(200);
    expect(
      (
        await call("/api/library/upload", {
          name: "x",
          mime: "image/png",
          base64: png,
        })
      ).status,
    ).toBe(400);
    const backup = join(directory, "workspace-image.sqlite");
    const restoredPath = join(directory, "workspace-image-restored.sqlite");
    await host.db.backup(backup);
    await restoreDatabase(backup, restoredPath);
    const restored = new DatabaseSync(restoredPath, { readOnly: true });
    try {
      expect(
        restored
          .prepare("SELECT space_id,base64 FROM library_asset WHERE id=?")
          .get(asset.id),
      ).toEqual({ space_id: null, base64: png });
      expect(
        restored
          .prepare(
            "SELECT count(*) n FROM connected_activity WHERE entity_id=?",
          )
          .get(asset.id)?.n,
      ).toBe(1);
    } finally {
      restored.close();
    }
    await host.db.accounts((store) => {
      const user = store.register("reader", verifier, false);
      store.status(user.id, user.version, "ACTIVE");
    });
    await signIn("reader");
    expect((await call(asset.url)).status).toBe(404);
  }, 15000);
  it("knowledge revisions, private images and account verifiers survive a consistent backup and new-file restore", async () => {
    await claim();
    const library = await space();
    const value = {
      id: null,
      version: 0,
      input: {
        kind: "DOCUMENT",
        spaceId: library.id,
        title: "第一讲",
        bodyMd: "# 原文\r\n$$ E=mc^2 $$",
      },
    };
    const entry = await (await call("/api/library/save", value)).json();
    const changed = await (
      await call("/api/library/save", {
        ...value,
        id: entry.id,
        version: 1,
        input: { ...value.input, bodyMd: "Updated" },
      })
    ).json();
    expect(changed.version).toBe(2);
    expect(
      await (await call("/api/library/revisions?id=" + entry.id)).json(),
    ).toHaveLength(2);
    const asset = await (
      await call("/api/library/upload", {
        spaceId: library.id,
        name: "figure.png",
        mime: "image/png",
        base64: png,
      })
    ).json();
    expect(
      Buffer.from(await (await call(asset.url)).arrayBuffer()).toString(
        "base64",
      ),
    ).toBe(png);
    expect((await call(asset.url, undefined, { Cookie: "" })).status).toBe(401);
    for (const invalid of [
      { mime: "image/svg+xml", base64: png },
      { mime: "image/png", base64: Buffer.alloc(16).toString("base64") },
      { mime: "image/png", base64: Buffer.alloc(500001).toString("base64") },
    ])
      expect(
        (
          await call("/api/library/upload", {
            spaceId: library.id,
            name: "bad",
            ...invalid,
          })
        ).status,
      ).toBe(400);
    await call("/api/library/delete", {
      id: library.id,
      version: 1,
      deleted: true,
    });
    expect((await call(asset.url)).status).toBe(404);
    expect(
      (
        await call("/api/library/delete", {
          id: entry.id,
          version: 2,
          deleted: true,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call("/api/library/delete", {
          id: entry.id,
          version: 3,
          deleted: false,
        })
      ).status,
    ).toBe(404);
    await call("/api/library/delete", {
      id: library.id,
      version: 2,
      deleted: false,
    });
    const backup = join(directory, "v5-backup.sqlite"),
      restored = join(directory, "v5-restored.sqlite");
    await host.db.backup(backup);
    await restoreDatabase(backup, restored);
    const raw = new DatabaseSync(restored, { readOnly: true });
    try {
      expect(raw.prepare("PRAGMA user_version").get()?.user_version).toBe(
        currentSchemaVersion,
      );
      expect(
        raw.prepare("SELECT base64 FROM library_asset").get()?.base64,
      ).toBe(png);
      expect(
        raw.prepare("SELECT verifier FROM account").get()?.verifier,
      ).not.toBe(password);
      expect(
        raw
          .prepare("SELECT count(*) n FROM library_revision WHERE id=?")
          .get(entry.id)?.n,
      ).toBe(3);
      expect(raw.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      raw.close();
    }
  }, 15000);
  const route = {
    fingerprint: "test-route",
    provider: "https://model.example",
    model: "test",
    maxInputChars: 1000,
    maxOutputTokens: 100,
    timeoutMs: 2000,
    maxRunsPerDay: 2,
  };
  it("persists and resumes an Assistant session through Host restarts and approved requests", async () => {
    await host.close();
    const complete = vi.fn(async (_prompt: string, _signal: AbortSignal) =>
      JSON.stringify({ kind: "FINAL", text: "Session answer" }),
    );
    const model = {
      route: { ...route, maxInputChars: 16000, maxRunsPerDay: 10 },
      complete,
    };
    await start(undefined, model);
    await login();
    const sessionResponse = await call("/api/ai/sessions/create", {
      title: "Session",
    });
    expect(sessionResponse.status).toBe(200);
    const session = await sessionResponse.json();
    const run = await (
      await call("/api/ai/propose", {
        prompt: "First",
        sessionId: session.id,
        sessionVersion: session.version,
      })
    ).json();
    expect(run.sessionId).toBe(session.id);
    await call("/api/ai/decide", {
      id: run.id,
      version: run.version,
      approve: true,
    });
    await vi.waitFor(async () =>
      expect((await latestConversation()).messages).toHaveLength(2),
    );
    await host.close();
    await start(undefined, model);
    await login();
    const resumed = await latestConversation();
    expect(
      resumed.messages.map((message: { text: string }) => message.text),
    ).toEqual(["First", "Session answer"]);
    const next = await (
      await call("/api/ai/propose", {
        prompt: "Continue",
        sessionId: resumed.id,
        sessionVersion: resumed.version,
      })
    ).json();
    expect(next.prompt).toContain("Session answer");
    expect(complete).toHaveBeenCalledTimes(1);
    await call("/api/ai/decide", {
      id: next.id,
      version: next.version,
      approve: true,
    });
    await vi.waitFor(() => expect(complete).toHaveBeenCalledTimes(2));
    expect(complete.mock.calls[1]?.[0]).toContain("Session answer");
    await vi.waitFor(async () =>
      expect((await latestConversation()).messages).toHaveLength(4),
    );
    const current = await latestConversation();
    const rejected = await (
      await call("/api/ai/propose", {
        prompt: "Rejected private question",
        sessionId: current.id,
        sessionVersion: current.version,
      })
    ).json();
    expect(
      (
        await call("/api/ai/decide", {
          id: rejected.id,
          version: rejected.version,
          approve: false,
        })
      ).status,
    ).toBe(200);
    const after = await latestConversation();
    expect(after.messages.at(-1).kind).toBe("ERROR");
    const retry = await (
      await call("/api/ai/propose", {
        prompt: "Safe continuation",
        sessionId: after.id,
        sessionVersion: after.version,
      })
    ).json();
    expect(retry.prompt).not.toContain("Rejected private question");
    expect(retry.prompt).toContain("Session answer");
  });
  it("Atlas harness reads, pauses for a real human write approval, resumes once and preserves tool audit", async () => {
    await host.close();
    const respond = vi
      .fn()
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [
          { id: "read-project", name: "get_project", input: { id: "pending" } },
        ],
      })
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [
          {
            id: "write-task",
            name: "create_task",
            input: { title: "Proposed task" },
          },
        ],
      })
      .mockResolvedValueOnce({ text: "Created after review", toolCalls: [] });
    const model: ModelPort = {
      route: { ...route, maxInputChars: 32000, maxRunsPerDay: 10 },
      complete: vi.fn(async () => ""),
      providerAdapter: {
        capabilities: {
          tools: true,
          jsonSchema: true,
          streaming: false,
          vision: false,
          embedding: false,
        },
        respond,
        complete: vi.fn(async () => ""),
        stream: async function* () {},
        listModels: async () => ["test"],
      },
    };
    await start(undefined, model);
    await login();
    const project = await (
      await call("/api/work/create", {
        title: "Focus project",
        type: "PROJECT",
      })
    ).json();
    respond
      .mockReset()
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [
          {
            id: "read-project",
            name: "get_project",
            input: { id: project.id },
          },
        ],
      })
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [
          {
            id: "write-task",
            name: "create_task",
            input: { title: "Proposed task" },
          },
        ],
      })
      .mockResolvedValueOnce({ text: "Created after review", toolCalls: [] });
    const session = await (
      await call("/api/ai/sessions/create", { title: "Harness" })
    ).json();
    const proposal = await (
      await call("/api/ai/propose", {
        prompt: "Read the project then create one task",
        sessionId: session.id,
        sessionVersion: session.version,
      })
    ).json();
    expect(
      (
        await call("/api/ai/decide", {
          id: proposal.id,
          version: proposal.version,
          approve: true,
        })
      ).status,
    ).toBe(200);
    let waiting: { id: string; version: number; harness: { status: string } };
    await vi.waitFor(async () => {
      waiting = (await (await call("/api/ai")).json()).runs.find(
        (run: { id: string }) => run.id === proposal.id,
      );
      expect(waiting.harness.status).toBe("WAITING_APPROVAL");
    });
    await host.close();
    await start(undefined, model);
    await login();
    expect(respond).toHaveBeenCalledTimes(2);
    waiting = (await (await call("/api/ai")).json()).runs.find(
      (run: { id: string }) => run.id === proposal.id,
    );
    expect(waiting.harness.status).toBe("WAITING_APPROVAL");
    expect(
      (await (await call("/api/snapshot")).json()).items.filter(
        (item: { type: string }) => item.type === "TASK",
      ),
    ).toHaveLength(0);
    expect(
      (
        await call("/api/ai/harness/decide", {
          id: proposal.id,
          version: waiting!.version - 1,
          callId: "write-task",
          approve: true,
        })
      ).status,
    ).toBe(409);
    const approvedInput = {
      id: proposal.id,
      version: waiting!.version,
      callId: "write-task",
      approve: true,
      input: { title: "Human revised task" },
    };
    const receipt = { "Idempotency-Key": randomUUID() };
    expect(
      (await call("/api/ai/harness/decide", approvedInput, receipt)).status,
    ).toBe(200);
    expect(
      (await call("/api/ai/harness/decide", approvedInput, receipt)).status,
    ).toBe(200);
    await vi.waitFor(async () => {
      const completed = (await (await call("/api/ai")).json()).runs.find(
        (run: { id: string }) => run.id === proposal.id,
      );
      expect(completed.status).toBe("SUCCEEDED");
    });
    const tasks = (await (await call("/api/snapshot")).json()).items.filter(
      (item: { type: string }) => item.type === "TASK",
    );
    expect(tasks.map((task: { title: string }) => task.title)).toEqual([
      "Human revised task",
    ]);
    const messages = (await latestConversation()).messages;
    expect(messages.map((message: { kind: string }) => message.kind)).toEqual([
      "USER",
      "TOOL_CALL",
      "TOOL_RESULT",
      "TOOL_CALL",
      "TOOL_RESULT",
      "ASSISTANT",
    ]);
    expect(respond).toHaveBeenCalledTimes(3);
  });
  it("retrieves permitted project knowledge into a version-bound model approval manifest", async () => {
    await host.close();
    const complete = vi.fn(async () => "Answer");
    await start(undefined, {
      route: { ...route, maxInputChars: 16000 },
      complete,
    });
    await login();
    const project = await (
      await call("/api/work/create", { type: "PROJECT", title: "Retrieval" })
    ).json();
    const binding = await (
      await call("/api/projects/space/create", {
        projectId: project.id,
        title: "Wiki",
        role: "PRIMARY",
      })
    ).json();
    const policy = {
      classification: "PRIVATE",
      processingBoundary: "ANY",
      aiAccess: "ASK",
    };
    const space = (await (await call("/api/library")).json()).find(
      (entry: { id: string }) => entry.id === binding.spaceId,
    );
    expect(space).toBeDefined();
    expect(
      (
        await call("/api/library/save", {
          id: space.id,
          version: space.version,
          input: { ...space, aiPolicy: policy },
        })
      ).status,
    ).toBe(400);
    const save = async (
      id: string | null,
      version: number,
      title: string,
      bodyMd: string,
      kind = "DOCUMENT",
      aiPolicy: unknown = policy,
    ) =>
      (
        await call("/api/library/save", {
          id,
          version,
          input: {
            kind,
            spaceId: kind === "SPACE" ? null : space.id,
            title,
            bodyMd,
            aiPolicy,
          },
        })
      ).json();
    await save(space.id, space.version, space.title, "", "SPACE");
    const document = await save(null, 0, "Storage", "storage runtime");
    await save(null, 0, "Denied storage", "private storage", "DOCUMENT", {
      classification: "PRIVATE",
      processingBoundary: "LOCAL_ONLY",
      aiAccess: "DENY",
    });
    const proposalResponse = await call("/api/ai/propose", {
      prompt: "storage",
      retrievalContext: { projectId: project.id },
    });
    expect(proposalResponse.status).toBe(200);
    const proposal = await proposalResponse.json();
    expect(proposal.context).toHaveLength(1);
    expect(proposal.context[0]).toMatchObject({
      ref: { kind: "DOCUMENT", id: document.id },
      source: "retrieved",
      permission: policy,
      version: 1,
      tokenEstimate: 4,
    });
    expect(proposal.prompt).toContain("storage runtime");
    expect(complete).not.toHaveBeenCalled();
    await save(document.id, document.version, document.title, "changed");
    expect(
      (
        await call("/api/ai/decide", {
          id: proposal.id,
          version: proposal.version,
          approve: true,
        })
      ).status,
    ).toBe(409);
    expect((await (await call("/api/ai")).json()).runs[0].status).toBe(
      "WAITING_APPROVAL",
    );
    expect(complete).not.toHaveBeenCalled();
  });
  it("syncs conditional snapshots, knowledge backlinks and soft-deleted endpoints", async () => {
    expect((await call("/api/sync")).status).toBe(401);
    await login();
    const first = await (await call("/api/sync")).json();
    expect(
      (await (await call("/api/sync?after=" + first.cursor)).json()).snapshot,
    ).toBeNull();
    const a = await note(),
      b = await create();
    const from = { kind: "NOTE", id: a.id },
      to = { kind: "WORK", id: b.id };
    const key = randomUUID();
    const link = await (
      await call(
        "/api/link/create",
        { from, to, relation: "RELATED" },
        { "Idempotency-Key": key },
      )
    ).json();
    expect(link.version).toBe(1);
    expect(
      (
        await call("/api/link/create", {
          from: to,
          to: from,
          relation: "RELATED",
        })
      ).status,
    ).toBe(409);
    expect(
      (await call("/api/link/create", { from, to: from, relation: "RELATED" }))
        .status,
    ).toBe(400);
    expect(
      (
        await call("/api/link/create", {
          from,
          to: { kind: "WORK", id: "foreign" },
          relation: "REFERENCES",
        })
      ).status,
    ).toBe(404);
    await call(
      "/api/link/create",
      { from, to, relation: "RELATED" },
      { "Idempotency-Key": key },
    );
    const changed = await (
      await call("/api/sync?after=" + first.cursor)
    ).json();
    expect(changed.cursor).not.toBe(first.cursor);
    expect(changed.snapshot).toBeNull();
    expect(changed.changes.collections.links.upserts).toHaveLength(1);
    await call("/api/note/delete", { id: a.id, version: 1, deleted: true });
    expect((await (await call("/api/snapshot")).json()).links).toEqual([]);
    const hiddenDelta = await (
      await call("/api/sync?after=" + changed.cursor)
    ).json();
    expect(hiddenDelta.changes.collections.links.removed).toEqual([link.id]);
    await call("/api/note/delete", { id: a.id, version: 2, deleted: false });
    expect((await (await call("/api/snapshot")).json()).links).toHaveLength(1);
    const restoredDelta = await (
      await call("/api/sync?after=" + hiddenDelta.cursor)
    ).json();
    expect(restoredDelta.changes.collections.links.upserts).toHaveLength(1);
    expect(
      (await call("/api/link/delete", { id: link.id, version: 99 })).status,
    ).toBe(409);
    expect(
      (await call("/api/link/delete", { id: link.id, version: 1 })).status,
    ).toBe(200);
    expect((await (await call("/api/snapshot")).json()).links).toEqual([]);
  });
  it("blocks AI with missing configuration and rejects client model/context injection", async () => {
    expect((await call("/api/ai")).status).toBe(401);
    await login();
    expect((await (await call("/api/ai")).json()).route).toBeNull();
    expect((await call("/api/ai/propose", { prompt: "hello" })).status).toBe(
      409,
    );
    expect(
      (await call("/api/ai/propose", { prompt: "hello", model: "injected" }))
        .status,
    ).toBe(400);
  });
  it("executes only approved input once, persists results and attributes the worker independently", async () => {
    await host.close();
    const complete = vi.fn(
      async (_prompt: string, _signal: AbortSignal) => "# Result",
    );
    await start(undefined, { route, complete });
    await login();
    await note("NEVER SEND THIS");
    const proposed = await (
      await call("/api/ai/propose", { prompt: "Only this" })
    ).json();
    expect(proposed.status).toBe("WAITING_APPROVAL");
    expect(complete).not.toHaveBeenCalled();
    const headers = { "Idempotency-Key": randomUUID() };
    const approval = { id: proposed.id, version: 1, approve: true };
    const responses = await Promise.all([
      call("/api/ai/decide", approval, headers),
      call("/api/ai/decide", approval, headers),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    await vi.waitFor(async () =>
      expect((await (await call("/api/ai")).json()).runs[0].status).toBe(
        "SUCCEEDED",
      ),
    );
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]?.[0]).toBe("Only this");
    const run = (await (await call("/api/ai")).json()).runs[0];
    expect(run.updatedBy).toBe("arclattice-owner");
    expect(run.output).toBe("# Result");
    expect((await call("/api/ai/decide", approval)).status).toBe(409);
    const raw = new DatabaseSync(join(directory, "work.sqlite"), {
      readOnly: true,
    });
    try {
      expect(
        raw.prepare("SELECT COUNT(*) AS n FROM connected_activity").get()?.n,
      ).toBe(4);
      expect(
        raw.prepare("SELECT COUNT(*) AS n FROM audit_record").get()?.n,
      ).toBe(2);
    } finally {
      raw.close();
    }
    await host.close();
    await start(undefined, { route, complete });
    await login();
    expect((await (await call("/api/ai")).json()).runs[0].output).toBe(
      "# Result",
    );
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it("rejects declined or stale approvals, marks failures and enforces daily limits", async () => {
    await host.close();
    const complete = vi.fn(async () => {
      throw new Error("SECRET ERROR");
    });
    await start(undefined, { route: { ...route, maxRunsPerDay: 1 }, complete });
    await login();
    const propose = async () =>
      (await call("/api/ai/propose", { prompt: "request" })).json();
    const rejected = await propose();
    expect(
      (
        await call("/api/ai/decide", {
          id: rejected.id,
          version: 1,
          approve: false,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call("/api/ai/decide", {
          id: rejected.id,
          version: 2,
          approve: true,
        })
      ).status,
    ).toBe(409);
    const run = await propose();
    expect(
      (await call("/api/ai/decide", { id: run.id, version: 2, approve: true }))
        .status,
    ).toBe(409);
    await call("/api/ai/decide", { id: run.id, version: 1, approve: true });
    await vi.waitFor(async () =>
      expect(
        (await (await call("/api/ai")).json()).runs.find(
          (r: { id: string }) => r.id === run.id,
        ).status,
      ).toBe("FAILED"),
    );
    expect(await (await call("/api/ai")).text()).not.toContain("SECRET ERROR");
    const next = await propose();
    expect(
      (await call("/api/ai/decide", { id: next.id, version: 1, approve: true }))
        .status,
    ).toBe(403);
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it("invalidates pending approval after route change and recovers abandoned runs without resending", async () => {
    await host.close();
    const complete = vi.fn(async () => "unused");
    await start(undefined, { route, complete });
    await login();
    const run = await (
      await call("/api/ai/propose", { prompt: "old config" })
    ).json();
    await host.close();
    await start(undefined, {
      route: { ...route, fingerprint: "changed" },
      complete,
    });
    await login();
    expect(
      (await call("/api/ai/decide", { id: run.id, version: 1, approve: true }))
        .status,
    ).toBe(409);
    await host.close();
    const raw = new DatabaseSync(join(directory, "work.sqlite"));
    raw
      .prepare("UPDATE agent_run SET payload=? WHERE id=?")
      .run(JSON.stringify({ ...run, status: "RUNNING" }), run.id);
    raw.close();
    await start(undefined, { route, complete });
    await login();
    expect((await (await call("/api/ai")).json()).runs[0].status).toBe(
      "INTERRUPTED",
    );
    expect(complete).not.toHaveBeenCalled();
  });
  it("bounds concurrency and interrupts timed-out requests without resending", async () => {
    await host.close();
    const complete = vi.fn(
      async (_prompt: string, signal: AbortSignal) =>
        new Promise<string>((_resolve, reject) =>
          signal.addEventListener(
            "abort",
            () => reject(new Error("cancelled")),
            { once: true },
          ),
        ),
    );
    await start(undefined, { route: { ...route, timeoutMs: 300 }, complete });
    await login();
    const a = await (await call("/api/ai/propose", { prompt: "first" })).json();
    const b = await (
      await call("/api/ai/propose", { prompt: "second" })
    ).json();
    const responses = await Promise.all(
      [a, b].map((r) =>
        call("/api/ai/decide", { id: r.id, version: 1, approve: true }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 403]);
    await vi.waitFor(async () =>
      expect(
        (await (await call("/api/ai")).json()).runs.some(
          (r: { status: string }) => r.status === "INTERRUPTED",
        ),
      ).toBe(true),
    );
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it("permits only exact HTTPS origin with secure cookies, never public HTTP", async () => {
    await expect(
      createHost({
        database: join(directory, "bad.sqlite"),
        secret,
        origin: "http://example.test",
        webRoot: directory,
      }),
    ).rejects.toThrow();
    expect(existsSync(join(directory, "bad.sqlite"))).toBe(false);
    await host.close();
    host = await createHost({
      database: join(directory, "secure.sqlite"),
      secret,
      origin: "https://example.test",
      webRoot: directory,
    });
    await new Promise<void>((done) => host.server.listen(0, "127.0.0.1", done));
    base = "http://127.0.0.1:" + (host.server.address() as AddressInfo).port;
    const headers = {
      Host: "example.test",
      Origin: "https://example.test",
    };
    await seedOwner();
    const response = await call(
      "/api/session",
      { username: "owner", password: ownerPassword },
      headers,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("; Secure");
    expect(
      (
        await call(
          "/api/session",
          { secret },
          { ...headers, Origin: "http://example.test" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          "/api/session",
          { secret },
          { ...headers, Host: "attacker.test" },
        )
      ).status,
    ).toBe(403);
  });
  it("downloads authenticated consistent backups and rejects parallel/unsafe requests", async () => {
    expect((await call("/api/backup", {})).status).toBe(401);
    await login();
    await create("Backed up");
    await note();
    expect(
      (await call("/api/backup", {}, { "X-CSRF-Token": "bad" })).status,
    ).toBe(403);
    expect((await call("/api/backup", { path: "/etc/passwd" })).status).toBe(
      400,
    );
    const responses = await Promise.all([
      call("/api/backup", {}),
      call("/api/backup", {}),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 429]);
    const response = responses.find((r) => r.status === 200);
    expect(response?.headers.get("content-type")).toBe(
      "application/vnd.sqlite3",
    );
    const target = join(directory, "download.sqlite");
    writeFileSync(target, Buffer.from(await response!.arrayBuffer()));
    const restored = join(directory, "download-restored.sqlite");
    await restoreDatabase(target, restored);
    const raw = new DatabaseSync(restored, { readOnly: true });
    try {
      expect(raw.prepare("SELECT title FROM work_item").get()?.title).toBe(
        "Backed up",
      );
      expect(raw.prepare("SELECT count(*) AS n FROM notebook").get()?.n).toBe(
        1,
      );
      expect(raw.prepare("PRAGMA user_version").get()?.user_version).toBe(
        currentSchemaVersion,
      );
    } finally {
      raw.close();
    }
  });
  it("persists planning fields and rejects invalid dates and foreign project references", async () => {
    await login();
    const project = await (
      await call("/api/work/create", { title: "Project", type: "PROJECT" })
    ).json();
    const item = await (
      await call("/api/work/create", {
        title: "Task",
        projectIds: [project.id],
        startDate: "2026-09-14",
        dueDate: "2026-09-30",
      })
    ).json();
    expect(item.projectIds).toEqual([project.id]);
    expect(item.dueDate).toBe("2026-09-30");
    for (const dueDate of ["2026-02-30", "2026-09-01", "2026-9-30"]) {
      expect(
        (
          await call("/api/work/update", {
            id: item.id,
            version: 1,
            input: { dueDate },
          })
        ).status,
      ).toBe(400);
    }
    expect(
      (
        await call("/api/work/update", {
          id: item.id,
          version: 1,
          input: { projectIds: ["foreign"] },
        })
      ).status,
    ).toBe(404);
    const updated = await (
      await call("/api/work/update", {
        id: item.id,
        version: 1,
        input: { projectIds: [], startDate: null, dueDate: null },
      })
    ).json();
    expect(updated.projectIds).toEqual([]);
    expect(updated.dueDate).toBeNull();
    expect(
      (
        await call("/api/work/delete", {
          id: project.id,
          version: 1,
          deleted: true,
        })
      ).status,
    ).toBe(200);
  });
  it("requires a real session and uses protected cookies and security headers", async () => {
    expect((await call("/api/snapshot")).status).toBe(401);
    expect((await call("/api/session", { secret: "bad" })).status).toBe(404);
    await seedOwner();
    expect(
      (await call("/api/session", { username: "owner", password: "bad" }))
        .status,
    ).toBe(401);
    const response = await call("/api/session", {
      username: "owner",
      password: ownerPassword,
    });
    expect(response.headers.get("set-cookie")).toContain(
      "HttpOnly; SameSite=Strict",
    );
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("rejects foreign hosts, cross-origin writes and missing CSRF", async () => {
    await login();
    expect(
      (await call("/api/snapshot", undefined, { Host: "attacker.test" }))
        .status,
    ).toBe(403);
    expect(
      (
        await call(
          "/api/work/create",
          { title: "x" },
          { Origin: "https://attacker.test" },
        )
      ).status,
    ).toBe(403);
    expect(
      (await call("/api/work/create", { title: "x" }, { "X-CSRF-Token": "" }))
        .status,
    ).toBe(403);
    expect(
      (await call("/api/work/create", { title: "x" }, { Origin: "" })).status,
    ).toBe(403);
  });
  it("validates idempotency, unknown keys, field types and enums", async () => {
    await login();
    expect(
      (
        await call(
          "/api/work/create",
          { title: "x" },
          { "Idempotency-Key": "" },
        )
      ).status,
    ).toBe(400);
    for (const input of [
      { title: 1 },
      { title: "x", workspaceId: "other" },
      { title: "x", priority: "INVALID" },
      { title: "x", type: "INVALID" },
    ])
      expect((await call("/api/work/create", input)).status).toBe(400);
    expect((await call("/api/snapshot")).status).toBe(200);
    expect((await (await call("/api/snapshot")).json()).items).toHaveLength(0);
  });
  it("commits identical parallel retries only once, including activity and outbox", async () => {
    await login();
    const key = randomUUID();
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        call("/api/work/create", { title: "once" }, { "Idempotency-Key": key }),
      ),
    );
    for (const response of responses) expect(response.status).toBe(200);
    const results = await Promise.all(responses.map((r) => r.json()));
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect((await (await call("/api/snapshot")).json()).items).toHaveLength(1);
    const events = await host.db.inspectEvents(host.context.workspaceId);
    expect(events.activity).toHaveLength(1);
    expect(events.outbox).toHaveLength(1);
    expect(
      (
        await call(
          "/api/work/create",
          { title: "different" },
          { "Idempotency-Key": key },
        )
      ).status,
    ).toBe(409);
  });
  it("keeps receipts, content and durable sessions after restart", async () => {
    await login();
    const key = randomUUID();
    const item = await (
      await call(
        "/api/work/create",
        { title: "persist" },
        { "Idempotency-Key": key },
      )
    ).json();
    const n = await note();
    await host.close();
    await start();
    expect((await call("/api/snapshot")).status).toBe(200);
    await login();
    const retry = await (
      await call(
        "/api/work/create",
        { title: "persist" },
        { "Idempotency-Key": key },
      )
    ).json();
    expect(retry).toEqual(item);
    const data = await (await call("/api/snapshot")).json();
    expect(data.items).toHaveLength(1);
    expect(data.notes).toEqual([n]);
  });
  it("rejects stale versions without extra events", async () => {
    await login();
    const item = await create();
    expect(
      (
        await call("/api/work/update", {
          id: item.id,
          version: 1,
          input: { title: "new" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call("/api/work/update", {
          id: item.id,
          version: 1,
          input: { title: "stale" },
        })
      ).status,
    ).toBe(409);
    expect(
      (await host.db.inspectEvents(host.context.workspaceId)).activity,
    ).toHaveLength(2);
  });
  it("prevents cycles, blocks transitions, and unlocks work after completion", async () => {
    await login();
    const a = await create("first"),
      b = await create("second");
    expect(
      (await call("/api/edge/create", { fromId: a.id, toId: b.id })).status,
    ).toBe(200);
    expect(
      (await call("/api/edge/create", { fromId: b.id, toId: a.id })).status,
    ).toBe(409);
    expect(
      (
        await call("/api/work/update", {
          id: b.id,
          version: 1,
          input: { status: "IN_PROGRESS" },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call("/api/work/update", {
          id: a.id,
          version: 1,
          input: { status: "DONE" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call("/api/work/update", {
          id: b.id,
          version: 1,
          input: { status: "IN_PROGRESS" },
        })
      ).status,
    ).toBe(200);
  });
  it("preserves raw Markdown, revisions and soft-delete recovery atomically", async () => {
    await login();
    const a = await note();
    const input = {
      title: "Revised",
      bodyMd: "<script>alert(1)</script>\n中文 😀",
      kind: "NOTE",
      day: null,
    };
    const b = await (
      await call("/api/note/save", { id: a.id, version: 1, input })
    ).json();
    expect(b.version).toBe(2);
    expect(
      (await call("/api/note/save", { id: a.id, version: 1, input })).status,
    ).toBe(409);
    const removed = await (
      await call("/api/note/delete", { id: a.id, version: 2, deleted: true })
    ).json();
    expect(removed.deletedAt).toBeTruthy();
    const restored = await (
      await call("/api/note/delete", { id: a.id, version: 3, deleted: false })
    ).json();
    expect(restored.bodyMd).toBe(input.bodyMd);
    expect(restored.deletedAt).toBeNull();
    const history = await (await call("/api/revisions?id=" + a.id)).json();
    expect(history).toHaveLength(4);
    expect(history[3]).toEqual(a);
    const raw = new DatabaseSync(join(directory, "work.sqlite"), {
      readOnly: true,
    });
    try {
      for (const table of [
        "notebook_revision",
        "notebook_activity",
        "notebook_outbox",
      ])
        expect(raw.prepare("SELECT COUNT(*) AS n FROM " + table).get()?.n).toBe(
          4,
        );
    } finally {
      raw.close();
    }
  });
  it("validates journal dates and permits only one live page per day", async () => {
    await login();
    const input = {
      title: "Today",
      bodyMd: "",
      kind: "JOURNAL",
      day: "2026-09-14",
    };
    for (const day of ["bad", "2026-02-30", "2026-99-99", null])
      expect(
        (
          await call("/api/note/save", {
            id: null,
            version: 0,
            input: { ...input, day },
          })
        ).status,
      ).toBe(400);
    const n = await (
      await call("/api/note/save", { id: null, version: 0, input })
    ).json();
    expect(n.version).toBe(1);
    expect(
      (await call("/api/note/save", { id: null, version: 0, input })).status,
    ).toBe(400);
    expect(
      (await call("/api/note/delete", { id: n.id, version: 1, deleted: true }))
        .status,
    ).toBe(200);
    expect(
      (await call("/api/note/save", { id: null, version: 0, input })).status,
    ).toBe(200);
    expect(
      (await call("/api/note/delete", { id: n.id, version: 2, deleted: false }))
        .status,
    ).toBe(400);
  });
  it("restores v2 backup with notes, receipts and events into a new database", async () => {
    await login();
    await create();
    await note();
    const snapshot = await (await call("/api/snapshot")).json();
    const backup = join(directory, "backup.sqlite");
    await host.db.backup(backup);
    const restored = join(directory, "restored.sqlite");
    await restoreDatabase(backup, restored);
    await host.close();
    await start(restored);
    await login();
    expect(await (await call("/api/snapshot")).json()).toEqual(snapshot);
    expect(
      (await host.db.inspectEvents(host.context.workspaceId)).activity,
    ).toHaveLength(1);
  });
  it("locks a session immediately and rate-limits guesses", async () => {
    await login();
    expect((await call("/api/logout", {})).status).toBe(200);
    expect((await call("/api/snapshot")).status).toBe(401);
    for (let i = 0; i < 9; i++)
      expect(
        (await call("/api/session", { username: "owner", password: "no" }))
          .status,
      ).toBe(401);
    expect(
      (
        await call("/api/session", {
          username: "owner",
          password: ownerPassword,
        })
      ).status,
    ).toBe(429);
  });
  it("serves only web assets and never database or key files", async () => {
    expect((await call("/")).status).toBe(200);
    expect((await call("/work.sqlite")).status).toBe(404);
    expect((await call("/access.key")).status).toBe(404);
    expect((await call("/../access.key")).status).toBe(404);
    expect((await call("/api/unknown", {})).status).toBe(401);
  });
  it("rejects oversized JSON payloads without exposing server internals", async () => {
    await login();
    const response = await call("/api/note/save", { body: "x".repeat(910000) });
    expect(response.status).toBe(413);
    expect(await response.text()).toBe('{"error":"VALIDATION_ERROR"}');
  });
});

it("calendar authority is exposed and invalid zones are rejected before creating a database", async () => {
  await login();
  expect((await (await call("/api/snapshot")).json()).calendarTimezone).toBe(
    "UTC",
  );
  const database = join(directory, "invalid-zone.sqlite");
  await expect(
    createHost({
      database,
      secret,
      origin,
      webRoot: directory,
      calendarTimezone: "Not/AZone",
    }),
  ).rejects.toThrow("VALIDATION_ERROR");
  expect(existsSync(database)).toBe(false);
});

it("incremental workspace sync sends only changed entities and safely resets unknown cursors", async () => {
  await login();
  const initial = await (await call("/api/sync")).json();
  expect(initial.snapshot).not.toBeNull();
  const unchanged = await (
    await call("/api/sync?after=" + initial.cursor)
  ).json();
  expect(unchanged.snapshot).toBeNull();
  expect(unchanged.changes).toEqual({ collections: {}, values: {} });
  const task = await create("Incremental task");
  const changed = await (
    await call("/api/sync?after=" + initial.cursor)
  ).json();
  expect(changed.snapshot).toBeNull();
  expect(changed.changes.collections.items.upserts).toEqual([task]);
  expect(changed.changes.collections.items.removed).toEqual([]);
  expect(changed.changes.collections.notes).toBeUndefined();
  expect(
    (await (await call("/api/sync?after=999999999")).json()).snapshot,
  ).not.toBeNull();
  expect((await call("/api/sync", undefined, { Cookie: "" })).status).toBe(401);
});

it("legacy project document mutations require explicit Space and cannot create a hidden Space", async () => {
  await login();
  const project = await (
    await call("/api/work/create", {
      type: "PROJECT",
      title: "Explicit knowledge",
    })
  ).json();
  const before = await (await call("/api/snapshot")).json();
  for (const endpoint of [
    "/api/projects/document",
    "/api/v1/projects/document",
    "/api/projects/document/create",
  ])
    expect(
      (
        await call(endpoint, {
          projectId: project.id,
          title: "Rejected",
          bodyMd: "# Original",
        })
      ).status,
    ).toBe(400);
  const after = await (await call("/api/snapshot")).json();
  expect(after.library).toEqual(before.library);
  expect(after.projectMaterials).toEqual(before.projectMaterials);
});

it("permanent purge endpoints enforce authorization isolation version idempotency and actual removal", async () => {
  await login();
  for (const kind of ["work", "note", "library"]) {
    const saved = await call(
      kind === "work" ? "/api/work/create" : "/api/" + kind + "/save",
      kind === "work"
        ? { title: "Purge " + kind }
        : {
            id: null,
            version: 0,
            input:
              kind === "note"
                ? {
                    title: "Purge note",
                    bodyMd: "Private Markdown",
                    kind: "NOTE",
                    day: null,
                  }
                : {
                    title: "Purge space",
                    bodyMd: "",
                    kind: "SPACE",
                    spaceId: null,
                  },
          },
    );
    expect(saved.status).toBe(200);
    const entry = await saved.json();
    const path = "/api/" + kind + "/purge";
    expect(
      (await call(path, { id: entry.id, version: entry.version })).status,
    ).toBe(400);
    const removed = await (
      await call("/api/" + kind + "/delete", {
        id: entry.id,
        version: entry.version,
        deleted: true,
      })
    ).json();
    expect(
      (await call(path, { id: entry.id, version: entry.version })).status,
    ).toBe(409);
    expect(
      (
        await call(
          path,
          { id: removed.id, version: removed.version },
          { "X-CSRF-Token": "wrong" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          path,
          { id: removed.id, version: removed.version },
          { Cookie: "" },
        )
      ).status,
    ).toBe(401);
    const readToken = await (
      await call("/api/tokens/create", { name: "Purge agent", scope: "write" })
    ).json();
    expect(
      (
        await call(
          path,
          { id: removed.id, version: removed.version },
          { Authorization: "Bearer " + readToken.secret, Cookie: "" },
        )
      ).status,
    ).toBe(403);
    const headers = { "Idempotency-Key": randomUUID() };
    expect(
      (await call(path, { id: removed.id, version: removed.version }, headers))
        .status,
    ).toBe(200);
    expect(
      (await call(path, { id: removed.id, version: removed.version }, headers))
        .status,
    ).toBe(200);
    const snapshot = await (await call("/api/snapshot")).json();
    expect(
      (kind === "work"
        ? snapshot.items
        : kind === "note"
          ? snapshot.notes
          : snapshot.library
      ).some((item: { id: string }) => item.id === entry.id),
    ).toBe(false);
    expect(
      (await call(path, { id: removed.id, version: removed.version })).status,
    ).toBe(404);
  }
});

it("pending Harness approval cannot survive a changed context and can be safely stopped", async () => {
  await host.close();
  const respond = vi.fn(async () => ({
    text: "",
    toolCalls: [
      {
        id: "review-write",
        name: "create_task",
        input: { title: "Forbidden stale write" },
      },
    ],
  }));
  const model: ModelPort = {
    route: {
      fingerprint: "context-test",
      provider: "https://test.invalid",
      model: "test",
      maxInputChars: 32000,
      maxOutputTokens: 100,
      timeoutMs: 5000,
      maxRunsPerDay: 10,
    },
    complete: async () => "",
    providerAdapter: {
      capabilities: {
        tools: true,
        jsonSchema: true,
        streaming: false,
        vision: false,
        embedding: false,
      },
      respond,
      complete: async () => "",
      listModels: async () => ["test"],
      stream: async function* () {},
    },
  };
  await start(undefined, model);
  await login();
  const aiPolicy = {
    classification: "PRIVATE",
    processingBoundary: "ANY",
    aiAccess: "ALLOW",
  };
  const space = await (
    await call("/api/library/save", {
      id: null,
      version: 0,
      input: {
        kind: "SPACE",
        spaceId: null,
        title: "Context",
        bodyMd: "",
        aiPolicy,
      },
    })
  ).json();
  const input = {
    kind: "DOCUMENT",
    spaceId: space.id,
    title: "Versioned source",
    bodyMd: "Original approved content",
    aiPolicy,
  };
  const document = await (
    await call("/api/library/save", { id: null, version: 0, input })
  ).json();
  const session = await (
    await call("/api/ai/sessions/create", { title: "Context review" })
  ).json();
  const run = await (
    await call("/api/ai/propose", {
      prompt: "Review one write",
      sources: [
        { kind: "DOCUMENT", id: document.id, version: document.version },
      ],
      sessionId: session.id,
      sessionVersion: session.version,
    })
  ).json();
  expect(
    (
      await call("/api/ai/decide", {
        id: run.id,
        version: run.version,
        approve: true,
      })
    ).status,
  ).toBe(200);
  let waiting: { id: string; version: number; harness: { status: string } };
  await vi.waitFor(async () => {
    waiting = (await (await call("/api/ai")).json()).runs.find(
      (entry: { id: string }) => entry.id === run.id,
    );
    expect(waiting.harness.status).toBe("WAITING_APPROVAL");
  });
  const approvalEvents = await call("/api/ai/events?id=" + run.id + "&after=0");
  expect(approvalEvents.status).toBe(200);
  expect(await approvalEvents.json()).toMatchObject({ done: true });
  expect(
    (
      await call("/api/library/save", {
        id: document.id,
        version: document.version,
        input: { ...input, bodyMd: "Changed after approval" },
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await call("/api/ai/harness/decide", {
        id: run.id,
        version: waiting!.version,
        callId: "review-write",
        approve: true,
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await call("/api/ai/harness/stop", {
        id: run.id,
        version: waiting!.version,
      })
    ).status,
  ).toBe(200);
  const snapshot = await (await call("/api/snapshot")).json();
  expect(
    snapshot.items.filter((item: { type: string }) => item.type === "TASK"),
  ).toHaveLength(0);
  expect(
    (await (await call("/api/ai")).json()).runs.find(
      (entry: { id: string }) => entry.id === run.id,
    ).status,
  ).toBe("INTERRUPTED");
  expect(respond).toHaveBeenCalledTimes(1);
});

it("real Harness persists failing read results and reaches its model step limit", async () => {
  await host.close();
  let step = 0;
  const respond = vi.fn(async () => ({
    text: "",
    toolCalls: [
      { id: `read-${step++}`, name: "get_project", input: { id: "missing" } },
    ],
  }));
  await start(undefined, {
    route: {
      fingerprint: "step-bound",
      provider: "https://test.invalid",
      model: "test",
      maxInputChars: 32000,
      maxOutputTokens: 100,
      timeoutMs: 5000,
      maxRunsPerDay: 100,
    },
    complete: async () => "",
    providerAdapter: {
      capabilities: {
        tools: true,
        jsonSchema: true,
        streaming: false,
        vision: false,
        embedding: false,
      },
      respond,
      complete: async () => "",
      listModels: async () => ["test"],
      stream: async function* () {},
    },
  });
  await login();
  const session = await (
    await call("/api/ai/sessions/create", { title: "Step limit" })
  ).json();
  const run = await (
    await call("/api/ai/propose", {
      prompt: "Run bounded reads",
      sessionId: session.id,
      sessionVersion: session.version,
    })
  ).json();
  expect(
    (
      await call("/api/ai/decide", {
        id: run.id,
        version: run.version,
        approve: true,
      })
    ).status,
  ).toBe(200);
  await vi.waitFor(async () => {
    const current = (await (await call("/api/ai")).json()).runs.find(
      (entry: { id: string }) => entry.id === run.id,
    );
    expect(current.status).toBe("FAILED");
    expect(current.harness, JSON.stringify(current)).toMatchObject({
      status: "LIMIT_REACHED",
      steps: 8,
    });
  });
  expect(respond).toHaveBeenCalledTimes(8);
});

it("first-class File links follow parent Document visibility in incremental sync", async () => {
  await login();
  const space = await (
    await call("/api/library/save", {
      id: null,
      version: 0,
      input: { kind: "SPACE", spaceId: null, title: "File Space", bodyMd: "" },
    })
  ).json();
  const document = await (
    await call("/api/library/save", {
      id: null,
      version: 0,
      input: {
        kind: "DOCUMENT",
        spaceId: space.id,
        title: "File parent",
        bodyMd: "original document",
      },
    })
  ).json();
  const project = await (
    await call("/api/work/create", { type: "PROJECT", title: "File project" })
  ).json();
  const contentHash = createHash("sha256")
    .update(Buffer.alloc(0))
    .digest("hex");
  expect(
    (
      await call("/api/v1/files/binary/begin", {
        contentHash,
        size: 0,
        mime: "text/plain",
        chunkSize: 262144,
      })
    ).status,
  ).toBe(200);
  expect(
    (await call("/api/v1/files/binary/complete", { contentHash })).status,
  ).toBe(200);
  const registered = await call("/api/v1/files/register", {
    name: "original.txt",
    mime: "text/plain",
    spaceId: space.id,
    parentDocumentId: document.id,
    contentHash,
    size: 0,
  });
  expect(registered.status).toBe(200);
  const file = await registered.json();
  const linked = await call("/api/v1/link/create", {
    from: { kind: "FILE", id: file.id },
    to: { kind: "WORK", id: project.id },
    relation: "RELATED",
  });
  expect(linked.status).toBe(200);
  const link = await linked.json();
  const bootstrap = await (await call("/api/bootstrap")).json();
  expect(bootstrap.workspace.links).toContainEqual(
    expect.objectContaining({
      id: link.id,
      from: { kind: "FILE", id: file.id },
    }),
  );
  expect(
    (
      await call("/api/library/delete", {
        id: document.id,
        version: 1,
        deleted: true,
      })
    ).status,
  ).toBe(200);
  const delta = await (
    await call(
      `/api/v1/sync?after=${bootstrap.cursor}&epoch=${encodeURIComponent(bootstrap.epoch)}&bodyMode=metadata`,
    )
  ).json();
  expect(delta.changes.collections.links.removed).toContain(link.id);
  expect(delta.changes.collections.links.upserts).not.toContainEqual(
    expect.objectContaining({ id: link.id }),
  );
  const canonical = await (
    await call(
      `/api/v1/sync?after=${bootstrap.cursor}&epoch=${encodeURIComponent(bootstrap.epoch)}&bodyMode=metadata&relationMode=canonical`,
    )
  ).json();
  expect(canonical.changes.collections.links).toBeUndefined();
  expect(
    canonical.records.every(
      (record: { collection: string }) => record.collection !== "links",
    ),
  ).toBe(true);
  const replicaBootstrap = await (
    await call("/api/bootstrap?relationMode=canonical")
  ).json();
  expect(replicaBootstrap.workspace.links).toContainEqual(
    expect.objectContaining({ id: link.id, version: link.version }),
  );
  const token = await (
    await call("/api/tokens/create", {
      name: "No canonical replica access",
      scope: "read-write",
    })
  ).json();
  const bearerHeaders = { Authorization: "Bearer " + token.secret, Cookie: "" };
  expect(
    (
      await call(
        "/api/bootstrap?relationMode=canonical",
        undefined,
        bearerHeaders,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await call(
        `/api/v1/sync?after=${bootstrap.cursor}&relationMode=canonical`,
        undefined,
        bearerHeaders,
      )
    ).status,
  ).toBe(403);
  expect((await call("/api/bootstrap?relationMode=unknown")).status).toBe(400);
  expect(
    (await call("/api/bootstrap?relationMode=canonical&relationMode=canonical"))
      .status,
  ).toBe(400);
  expect(
    (
      await call("/api/v1/link/create", {
        from: { kind: "FILE", id: file.id },
        to: { kind: "WORK", id: project.id },
        relation: "RELATED",
      })
    ).status,
  ).toBe(404);
});
it("owned remote workspace creation is authenticated, idempotent and isolated from the account default", async () => {
  expect((await call("/api/v1/workspaces")).status).toBe(401);
  await login();
  const initial = await (await call("/api/v1/workspaces")).json();
  expect(initial).toHaveLength(1);
  const input = { id: randomUUID(), name: "Second sync workspace" },
    headers = { "Idempotency-Key": randomUUID() };
  const first = await call("/api/v1/workspaces/create", input, headers);
  expect(first.status).toBe(200);
  const created = await first.json();
  expect(created).toMatchObject({
    id: input.id,
    name: input.name,
    ownerPrincipalId: "arclattice-owner",
    version: 1,
  });
  const repeated = await call("/api/v1/workspaces/create", input, headers);
  expect(repeated.status).toBe(200);
  expect(await repeated.json()).toEqual(created);
  expect(
    (
      await call(
        "/api/v1/workspaces/create",
        { ...input, name: "Different bytes" },
        headers,
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await call(
        "/api/v1/workspaces/create",
        { id: randomUUID(), name: "No CSRF" },
        { "X-CSRF-Token": "" },
      )
    ).status,
  ).toBe(403);
  expect(await (await call("/api/v1/workspaces")).json()).toHaveLength(2);
  expect((await (await call("/api/session")).json()).context.workspaceId).toBe(
    initial[0].id,
  );
  const scope = { "X-Workspace-Id": created.id };
  expect(
    (await (await call("/api/session", undefined, scope)).json()).context
      .workspaceId,
  ).toBe(created.id);
  const isolated = await call(
    "/api/work/create",
    { title: "Only in second workspace" },
    scope,
  );
  expect(isolated.status).toBe(200);
  expect((await isolated.json()).workspaceId).toBe(created.id);
  expect(
    (await (await call("/api/snapshot", undefined, scope)).json()).items,
  ).toHaveLength(1);
  expect((await (await call("/api/snapshot")).json()).items).toHaveLength(0);
  expect(
    (await call("/api/snapshot", undefined, { "X-Workspace-Id": randomUUID() }))
      .status,
  ).toBe(403);
  const tokenResponse = await call("/api/tokens/create", {
    name: "Default scope only",
    scope: "read-write",
  });
  expect(tokenResponse.status).toBe(201);
  const token = await tokenResponse.json();
  expect(
    (
      await call("/api/snapshot", undefined, {
        Authorization: "Bearer " + token.secret,
        ...scope,
      })
    ).status,
  ).toBe(403);
  const foreign = await host.db.accounts((store) =>
    store.register(
      "foreign-workspace-owner",
      store.find("owner")!.verifier,
      false,
    ),
  );
  expect(
    (
      await call("/api/snapshot", undefined, {
        "X-Workspace-Id": foreign.workspaceId,
      })
    ).status,
  ).toBe(403);
  await host.db.accounts((store) =>
    store.status(foreign.id, foreign.version, "ACTIVE"),
  );
  const foreignLogin = await call(
    "/api/session",
    {
      username: "foreign-workspace-owner",
      password: ownerPassword,
    },
    { Cookie: "" },
  );
  expect(foreignLogin.status).toBe(200);
  const foreignCookie = foreignLogin.headers.get("set-cookie")!.split(";")[0]!;
  expect(
    (
      await call("/api/snapshot", undefined, {
        Cookie: foreignCookie,
        ...scope,
      })
    ).status,
  ).toBe(403);
  expect(
    await (
      await call("/api/v1/workspaces", undefined, { Cookie: foreignCookie })
    ).json(),
  ).toHaveLength(1);
  // The original cookie remains scoped per request, even after another account signs in.
  expect(
    (await (await call("/api/snapshot", undefined, scope)).json()).items,
  ).toHaveLength(1);
  const raw = new DatabaseSync(join(directory, "work.sqlite"), {
    readOnly: true,
  });
  try {
    expect(
      raw
        .prepare(
          "SELECT count(*) n FROM connected_activity WHERE type='WORKSPACE_CREATED'",
        )
        .get()?.n,
    ).toBe(1);
    expect(
      raw
        .prepare(
          "SELECT count(*) n FROM connected_outbox WHERE type='WORKSPACE_CREATED'",
        )
        .get()?.n,
    ).toBe(1);
  } finally {
    raw.close();
  }
});

it.each(["note", "library"] as const)(
  "explicit deleted %s restore-save is atomic, versioned and human-only",
  async (kind) => {
    await login();
    const space =
      kind === "library"
        ? await (
            await call("/api/library/save", {
              id: null,
              version: 0,
              input: {
                kind: "SPACE",
                spaceId: null,
                title: "Recovery space",
                bodyMd: "",
              },
            })
          ).json()
        : null;
    const input =
      kind === "note"
        ? {
            kind: "NOTE",
            day: null,
            title: "Deleted note",
            bodyMd: "Original body",
          }
        : {
            kind: "DOCUMENT",
            spaceId: space.id,
            title: "Deleted document",
            bodyMd: "Original body",
          };
    const createdResponse = await call(`/api/${kind}/save`, {
      id: null,
      version: 0,
      input,
    });
    expect(createdResponse.status).toBe(200);
    const created = await createdResponse.json();
    expect(
      (
        await call(`/api/${kind}/delete`, {
          id: created.id,
          version: 1,
          deleted: true,
        })
      ).status,
    ).toBe(200);
    expect(
      (await call(`/api/${kind}/save`, { id: created.id, version: 2, input }))
        .status,
    ).toBe(404);
    const before = await (await call("/api/sync?after=0")).json();
    const invalid = await call(`/api/${kind}/save`, {
      id: created.id,
      version: 2,
      restoreDeleted: true,
      input: { ...input, kind: "INVALID" },
    });
    expect(invalid.status).toBe(400);
    const after = await (await call("/api/sync?after=0")).json();
    expect(after.cursor).toBe(before.cursor);
    const bodyPath = `/api/document/body?kind=${kind === "note" ? "NOTE" : "LIBRARY"}&id=${created.id}&deleted=include`;
    const stillDeleted = await (await call(bodyPath)).json();
    expect(stillDeleted).toMatchObject({ version: 2, bodyMd: "Original body" });
    expect(stillDeleted.deletedAt).not.toBeNull();
    const key = randomUUID(),
      deviceId = randomUUID();
    const payload = {
      id: created.id,
      version: 2,
      restoreDeleted: true,
      input: { ...input, bodyMd: "Recovered device body\n第二行" },
      syncCommand: {
        commandId: key,
        deviceId,
        effects: [2, 3].map((baseVersion) => ({
          collection: kind === "note" ? "notes" : "library",
          id: created.id,
          op: "UPSERT",
          baseVersion,
        })),
      },
    };
    const restoredResponse = await call(`/api/v1/${kind}/save`, payload, {
      "Idempotency-Key": key,
    });
    expect(restoredResponse.status).toBe(200);
    const restored = await restoredResponse.json();
    expect(restored.result).toMatchObject({
      id: created.id,
      version: 4,
      deletedAt: null,
      bodyMd: payload.input.bodyMd,
    });
    expect(restored.effects).toEqual([
      expect.objectContaining({
        id: created.id,
        version: 4,
        value: restored.result,
      }),
    ]);
    expect(
      await (
        await call(`/api/v1/${kind}/save`, payload, { "Idempotency-Key": key })
      ).json(),
    ).toEqual(restored);
    expect(
      (
        await call(
          `/api/v1/${kind}/save`,
          {
            ...payload,
            input: { ...payload.input, bodyMd: "Changed receipt bytes" },
          },
          { "Idempotency-Key": key },
        )
      ).status,
    ).toBe(409);
    const tokenResponse = await call("/api/tokens/create", {
      name: "Recovery must be human",
      scope: "write",
    });
    expect(tokenResponse.status).toBe(201);
    const token = await tokenResponse.json();
    expect(
      (
        await call(
          `/api/v1/${kind}/save`,
          { id: created.id, version: 4, restoreDeleted: true, input },
          {
            Authorization: "Bearer " + token.secret,
            Cookie: "",
            "X-CSRF-Token": "",
          },
        )
      ).status,
    ).toBe(403);
    expect(await (await call(bodyPath)).json()).toEqual(restored.result);
  },
);
