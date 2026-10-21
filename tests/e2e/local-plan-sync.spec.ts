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

test("original PLAN preview and publication survive IndexedDB restart with owned knowledge", async ({
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
      let db = await api.IndexedDbLocalStore.open("live-plan-sync");
      const blobs = await api.IndexedDbLocalBlobStore.open(
        "live-plan-sync-bytes",
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

      const remote = await (await fetch("/api/v1/sync?after=0")).json();
      await db.syncState.save(
        {
          workspaceId: own.workspaceId,
          remoteWorkspaceId: session.context.workspaceId,
          remotePrincipalId: session.context.principalId,
          serverOrigin: location.origin,
          epoch: remote.epoch,
          cursor: remote.cursor,
          version: 1,
        },
        null,
      ); // Explicit isolated test binding; never product auto-binding.
      let losePublicationReply = false;
      let publicationSends = 0;
      const coordinator = () =>
        new api.LocalWorkSyncCoordinator(runtime.context, {
          metadata: db.metadata,
          outbox: db.outbox,
          syncState: db.syncState,
          replica: db.replica,
          knowledgeWiki: {
            extract: (id, body) => api.indexDocument(id, body, []),
            resolve: (links) => [...links],
          },
          clock: { now: () => "2026-10-13T00:02:00Z" },
          transport: {
            lookup: async (_binding, commandId, deviceId) => {
              const response = await fetch(
                "/api/v1/sync/receipt?commandId=" +
                  commandId +
                  "&deviceId=" +
                  deviceId,
              );
              if (response.status === 404) return null;
              if (!response.ok) throw new Error("LOOKUP_" + response.status);
              return response.json();
            },
            pull: async (binding) => {
              const response = await fetch(
                "/api/v1/sync?after=" +
                  binding.cursor +
                  "&epoch=" +
                  encodeURIComponent(binding.epoch!) +
                  "&bodyMode=metadata",
              );
              if (!response.ok) throw new Error("PULL_" + response.status);
              return response.json();
            },
            send: async (_binding, request) => {
              if (request.path === "/api/v1/plans/publish") publicationSends++;
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
              if (!response.ok) throw new Error("PUSH_" + response.status);
              const receipt = await response.json();
              if (
                losePublicationReply &&
                request.path === "/api/v1/plans/publish"
              ) {
                losePublicationReply = false;
                throw new Error("TEST_PLAN_REPLY_LOST_AFTER_COMMIT");
              }
              return receipt;
            },
          },
        });
      const manifest = {
        version: 1,
        projects: [
          { tempId: "p", title: "Offline project", lifecycle: "ACTIVE" },
        ],
        spaces: [
          { tempId: "s", title: "Offline knowledge", descriptionMd: "Context" },
        ],
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
      const preview = await runtime.previewPlan(null, manifest);
      const previewPending = await db.outbox.list(own.workspaceId);
      db.close();
      db = await api.IndexedDbLocalStore.open("live-plan-sync");
      runtime = makeRuntime();
      const previewSync = await coordinator().run();
      const afterPreview = await (await fetch("/api/snapshot")).json();
      const published = await runtime.publishPlan(preview.id, preview.version);
      if (published.payload.kind !== "PLAN") throw new Error("MISSING_PLAN");
      const originalIds = published.payload.result;
      const publishPending = await db.outbox.list(own.workspaceId);
      db.close();
      db = await api.IndexedDbLocalStore.open("live-plan-sync");
      runtime = makeRuntime();
      losePublicationReply = true;
      let lostReply = false;
      try {
        await coordinator().run();
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message !== "TEST_PLAN_REPLY_LOST_AFTER_COMMIT"
        )
          throw error;
        lostReply = true;
      }
      const uncertain = await db.outbox.list(own.workspaceId);
      db.close();
      db = await api.IndexedDbLocalStore.open("live-plan-sync");
      runtime = makeRuntime();
      const publishSync = await coordinator().run();
      const snapshot = await (await fetch("/api/snapshot")).json();
      const pending = await db.outbox.list(own.workspaceId);
      const entries = await runtime.loadWorkspace();
      const document = entries.library.find(
        (entry) => entry.id === originalIds.d,
      );
      if (!document) throw new Error("MISSING_LOCAL_DOCUMENT");
      const body = await runtime.readDocumentBody(document);
      db.close();
      return JSON.stringify({
        previewId: preview.id,
        previewPending,
        previewSync,
        afterPreview,
        originalIds,
        publishPending,
        publishSync,
        lostReply,
        uncertain,
        publicationSends,
        snapshot,
        pending,
        body,
      });
    });
    const proof = JSON.parse(result);
    expect(proof.previewPending).toHaveLength(1);
    expect(proof.previewSync.accepted).toHaveLength(1);
    expect(proof.previewSync.conflicted).toEqual([]);
    expect(proof.afterPreview.items).toEqual([]);
    expect(proof.afterPreview.library).toEqual([]);
    expect(proof.publishPending).toHaveLength(6);
    expect(proof.lostReply).toBe(true);
    expect(proof.uncertain).toHaveLength(6);
    expect(
      proof.uncertain.every((m: { state: string }) => m.state === "SENDING"),
    ).toBe(true);
    expect(proof.publicationSends).toBe(1);
    // The coordinator reports command IDs; all six mutations must leave Outbox.
    expect(proof.publishSync.accepted).toEqual([
      proof.publishPending[0].commandId,
    ]);
    expect(proof.publishSync.conflicted).toEqual([]);
    expect(proof.publishSync.unresolved).toEqual([]);
    expect(proof.pending).toEqual([]);
    expect(proof.snapshot.items).toHaveLength(1);
    expect(proof.snapshot.items[0].id).toBe(proof.originalIds.p);
    expect(
      proof.snapshot.library.find(
        (entry: { id: string }) => entry.id === proof.originalIds.d,
      ),
    ).toMatchObject({ title: "Original document" });
    expect(proof.body.bodyMd).toBe("第一行\n第二行\n[[Wiki]]");
    expect(proof.snapshot.projectMaterials).toHaveLength(1);
    expect(proof.snapshot.projectMaterials[0]).toMatchObject({
      projectId: proof.originalIds.p,
      targetId: proof.originalIds.d,
      ownership: "OWNED",
      version: 2,
    });
  } finally {
    await host.close();
  }
});
