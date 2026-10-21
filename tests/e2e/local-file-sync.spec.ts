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

test("original File chunks resume and metadata receipts recover across IndexedDB restart", async ({
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
      let db = await api.IndexedDbLocalStore.open("live-file-sync");
      const blobs = await api.IndexedDbLocalBlobStore.open(
        "live-file-sync-bytes",
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
      );
      const original = new Uint8Array(700001);
      for (let i = 0; i < original.length; i++) original[i] = i % 251;
      const file = await runtime.uploadFile(
        { name: "原始.bin", mime: "application/octet-stream", spaceId: null },
        new Blob([original]),
      );
      let loseChunk = true,
        loseMetadata = true,
        chunkSends = 0,
        metadataSends = 0;
      const jsonPost = async (path: string, value: unknown, key = "") => {
        const response = await fetch(path, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrf,
            ...(key ? { "Idempotency-Key": key } : {}),
          },
          body: JSON.stringify(value),
        });
        if (response.status === 409)
          throw new api.DomainError("VERSION_CONFLICT");
        if (!response.ok) throw new Error("FILE_HTTP_" + response.status);
        return response.json();
      };
      const coordinator = () =>
        new api.LocalWorkSyncCoordinator(runtime.context, {
          metadata: db.metadata,
          outbox: db.outbox,
          syncState: db.syncState,
          replica: db.replica,
          clock: { now: () => "2026-10-13T00:02:00Z" },
          fileBinary: {
            blobs,
            transport: {
              begin: (_binding, input) =>
                jsonPost("/api/v1/files/binary/begin", input),
              putChunk: async (_binding, hash, index, chunkHash, bytes) => {
                chunkSends++;
                const response = await fetch(
                  "/api/v1/files/binary/chunk?hash=" + hash + "&index=" + index,
                  {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/octet-stream",
                      "X-CSRF-Token": session.csrf,
                      "X-File-Chunk-Hash": chunkHash,
                    },
                    body: bytes,
                  },
                );
                if (!response.ok)
                  throw new Error("CHUNK_HTTP_" + response.status);
                const receipt = await response.json();
                if (loseChunk) {
                  loseChunk = false;
                  throw new Error("TEST_CHUNK_REPLY_LOST_AFTER_COMMIT");
                }
                return receipt;
              },
              complete: (_binding, contentHash) =>
                jsonPost("/api/v1/files/binary/complete", { contentHash }),
            },
          },
          transport: {
            lookup: async (_binding, commandId, deviceId) => {
              const response = await fetch(
                "/api/v1/sync/receipt?commandId=" +
                  commandId +
                  "&deviceId=" +
                  deviceId,
              );
              if (response.status === 404) return null;
              if (!response.ok)
                throw new Error("RECEIPT_HTTP_" + response.status);
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
              if (!response.ok) throw new Error("PULL_HTTP_" + response.status);
              return response.json();
            },
            send: async (_binding, request) => {
              metadataSends++;
              const receipt = await jsonPost(
                request.path,
                request.body,
                request.idempotencyKey,
              );
              if (loseMetadata) {
                loseMetadata = false;
                throw new Error("TEST_METADATA_REPLY_LOST_AFTER_COMMIT");
              }
              return receipt;
            },
          },
        });
      for (const message of [
        "TEST_CHUNK_REPLY_LOST_AFTER_COMMIT",
        "TEST_METADATA_REPLY_LOST_AFTER_COMMIT",
      ]) {
        let rejected = false;
        try {
          await coordinator().run();
        } catch (error) {
          if (!(error instanceof Error) || error.message !== message)
            throw error;
          rejected = true;
        }
        if (!rejected) throw new Error("EXPECTED_TRANSFER_INTERRUPTION");
        const pending = await db.outbox.list(own.workspaceId);
        if (pending.length !== 1 || pending[0]?.state !== "SENDING")
          throw new Error("UNCERTAIN_METADATA_NOT_DURABLE");
        db.close();
        db = await api.IndexedDbLocalStore.open("live-file-sync");
        runtime = makeRuntime();
      }
      const recovered = await coordinator().run();
      const afterRecoverySends = metadataSends;
      const renamed = await runtime.renameFile(file.id, 1, "Display.txt");
      const rename = await coordinator().run();
      const deleted = await runtime.deleteFile(file.id, renamed.version, true);
      await coordinator().run();
      const restored = await runtime.deleteFile(
        file.id,
        deleted.version,
        false,
      );
      await coordinator().run();
      await runtime.setFilePolicy(file.id, restored.version, {
        classification: "PRIVATE",
        processingBoundary: "LOCAL_ONLY",
        aiAccess: "ASK",
      });
      const policySync = await coordinator().run();
      const project = await runtime.service.create(runtime.context, {
        type: "PROJECT",
        title: "Remote-linked project",
      });
      const projectSync = await coordinator().run();
      const linked = await runtime.link(
        { kind: "FILE", id: file.id },
        { kind: "WORK", id: project.id },
        "RELATED",
      );
      const linkedSync = await coordinator().run();
      const localLinks = (await runtime.loadWorkspace()).links;
      const response = await fetch("/api/v1/files/bytes?id=" + file.id);
      if (!response.ok) throw new Error("DOWNLOAD_HTTP_" + response.status);
      const download = await response.blob(),
        downloadHash = await blobs.digest(download);
      const metadata = await (
        await fetch("/api/v1/files/metadata?id=" + file.id)
      ).json();
      const pending = await db.outbox.list(own.workspaceId),
        local = (await runtime.loadWorkspace()).files;
      if (!local) throw new Error("MISSING_LOCAL_FILES_COLLECTION");
      const other = await api.IndexedDbLocalStore.open("live-file-sync-other"),
        otherBlobs = await api.IndexedDbLocalBlobStore.open(
          "live-file-sync-other",
        );
      const otherOwn = await other.identity.ensure({
        schemaVersion: 1,
        workspaceId: crypto.randomUUID(),
        principalId: crypto.randomUUID(),
        deviceId: crypto.randomUUID(),
      });
      const otherRuntime = new api.LocalRuntime(
        new api.LocalWorkspace(
          other.metadata,
          otherBlobs,
          otherOwn,
          {
            extract: (id, body) => api.indexDocument(id, body, []),
            resolve: (links) => [...links],
          },
          { now: () => "2026-10-13T00:00:00Z" },
          { next: () => crypto.randomUUID() },
        ),
      );
      await other.syncState.save(
        {
          workspaceId: otherOwn.workspaceId,
          remoteWorkspaceId: session.context.workspaceId,
          remotePrincipalId: session.context.principalId,
          serverOrigin: location.origin,
          epoch: remote.epoch,
          cursor: 0,
          version: 1,
        },
        null,
      );
      await new api.LocalWorkSyncCoordinator(otherRuntime.context, {
        metadata: other.metadata,
        outbox: other.outbox,
        syncState: other.syncState,
        replica: other.replica,
        clock: { now: () => "2026-10-13T00:02:00Z" },
        transport: {
          lookup: async () => {
            throw new Error("NO_RECEIPT_EXPECTED");
          },
          send: async () => {
            throw new Error("NO_METADATA_MUTATION_EXPECTED");
          },
          pull: async (scope) => {
            const response = await fetch(
              `/api/v1/sync?after=${scope.cursor}&epoch=${encodeURIComponent(scope.epoch!)}&bodyMode=metadata`,
            );
            if (!response.ok) throw new Error("OTHER_PULL_FAILED");
            return response.json();
          },
        },
      }).run();
      const otherLinks = (await otherRuntime.loadWorkspace()).links;
      const missingBefore = await otherBlobs.get(
        otherOwn.workspaceId,
        file.contentHash,
      );
      let missingRejected = false;
      try {
        await otherRuntime.readFileBytes(file.id);
      } catch (error) {
        if (!(error instanceof api.FileBytesUnavailableError)) throw error;
        missingRejected = true;
      }
      const binding = async () => {
        const scope = await other.syncState.get(otherOwn.workspaceId);
        if (!scope) throw new Error("MISSING_OTHER_BINDING");
        return scope;
      };
      const corrupt = new Uint8Array(original);
      corrupt[0] = 255;
      let corruptRejected = false;
      try {
        await api.hydrateLocalFileBytes(
          otherRuntime.context,
          file.id,
          other.metadata,
          otherBlobs,
          binding,
          async () => new Blob([corrupt]),
        );
      } catch (error) {
        if (
          !(error instanceof api.DomainError) ||
          error.code !== "VALIDATION_ERROR"
        )
          throw error;
        corruptRejected = true;
      }
      if (await otherBlobs.get(otherOwn.workspaceId, file.contentHash))
        throw new Error("CORRUPT_BYTES_PERSISTED");
      await api.hydrateLocalFileBytes(
        otherRuntime.context,
        file.id,
        other.metadata,
        otherBlobs,
        binding,
        async () => {
          const response = await fetch(`/api/v1/files/bytes?id=${file.id}`);
          if (!response.ok) throw new Error("OTHER_DOWNLOAD_FAILED");
          return response.blob();
        },
      );
      const hydrated = await otherRuntime.readFileBytes(file.id),
        hydratedHash = await otherBlobs.digest(hydrated),
        otherPending = await other.outbox.list(otherOwn.workspaceId);
      const otherFiles = (await otherRuntime.loadWorkspace()).files;
      other.close();
      otherBlobs.close();
      db.close();
      return {
        fileId: file.id,
        hash: file.contentHash,
        recovered,
        rename,
        policySync,
        otherFiles,
        chunkSends,
        afterRecoverySends,
        downloadSize: download.size,
        downloadHash,
        metadata,
        pending,
        local,
        metadataOnly: missingBefore === null,
        missingRejected,
        corruptRejected,
        hydratedHash,
        otherPending,
        projectSync,
        linkedSync,
        linked,
        localLinks,
        otherLinks,
      };
    });
    expect(result.recovered.accepted).toHaveLength(1);
    expect(result.recovered.conflicted).toEqual([]);
    expect(result.recovered.unresolved).toEqual([]);
    expect(result.chunkSends).toBe(3);
    expect(result.afterRecoverySends).toBe(1);
    expect(result.rename.accepted).toHaveLength(1);
    expect(result.rename.conflicted).toEqual([]);
    expect(result.downloadSize).toBe(700001);
    expect(result.downloadHash).toBe(result.hash);
    expect(result.metadata).toMatchObject({
      id: result.fileId,
      name: "Display.txt",
      originalName: "原始.bin",
      version: 5,
      aiPolicy: {
        classification: "PRIVATE",
        processingBoundary: "LOCAL_ONLY",
        aiAccess: "ASK",
      },
      contentHash: result.hash,
      deletedAt: null,
    });
    expect(result.pending).toEqual([]);
    expect(result.local).toHaveLength(1);
    expect(result.local[0]).toMatchObject({
      id: result.fileId,
      name: "Display.txt",
      version: 5,
      aiPolicy: {
        classification: "PRIVATE",
        processingBoundary: "LOCAL_ONLY",
        aiAccess: "ASK",
      },
    });
    expect(result.policySync.accepted).toHaveLength(1);
    expect(result.policySync.conflicted).toEqual([]);
    expect(result.otherFiles).toContainEqual(
      expect.objectContaining({
        id: result.fileId,
        version: 5,
        aiPolicy: {
          classification: "PRIVATE",
          processingBoundary: "LOCAL_ONLY",
          aiAccess: "ASK",
        },
      }),
    );
    expect(result.metadataOnly).toBe(true);
    expect(result.missingRejected).toBe(true);
    expect(result.corruptRejected).toBe(true);
    expect(result.hydratedHash).toBe(result.hash);
    expect(result.otherPending).toEqual([]);
    expect(result.projectSync.accepted).toHaveLength(1);
    expect(result.linkedSync.accepted).toHaveLength(1);
    expect(result.linkedSync.conflicted).toEqual([]);
    expect(result.linkedSync.unresolved).toEqual([]);
    expect(result.localLinks).toContainEqual(
      expect.objectContaining({
        id: result.linked.id,
        from: { kind: "FILE", id: result.fileId },
        to: result.linked.to,
        version: 1,
      }),
    );
    expect(result.otherLinks).toContainEqual(
      expect.objectContaining({
        id: result.linked.id,
        from: { kind: "FILE", id: result.fileId },
        to: result.linked.to,
        version: 1,
      }),
    );
  } finally {
    await host.close();
  }
});
