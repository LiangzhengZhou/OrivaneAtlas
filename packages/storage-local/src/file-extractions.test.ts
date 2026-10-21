import { createHash } from "node:crypto";
import { fileExtractionDocument } from "@arclattice/application";
import type { LibraryFile } from "@arclattice/domain";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { localDto } from "../../application/src/local-dto";
import { IndexedDbLocalStore } from "./indexed-db";

beforeEach(() => vi.stubGlobal("IDBKeyRange", IDBKeyRange));
afterEach(() => vi.unstubAllGlobals());
it("local derived File records survive restart and reject scope/version mismatch without creating Outbox writes", async () => {
  const factory = new IDBFactory(),
    own = {
      schemaVersion: 1 as const,
      workspaceId: "11111111-1111-4111-8111-111111111111",
      principalId: "22222222-2222-4222-8222-222222222222",
      deviceId: "33333333-3333-4333-8333-333333333333",
    },
    hash = createHash("sha256").update("正文").digest("hex");
  const file: LibraryFile = {
    id: "file",
    workspaceId: own.workspaceId,
    spaceId: null,
    parentDocumentId: null,
    name: "Original.txt",
    originalName: "Original.txt",
    extension: "txt",
    mime: "text/plain",
    size: 6,
    contentHash: hash,
    blobId: hash,
    version: 1,
    provenance: "HUMAN",
    aiPolicy: {
      classification: "PRIVATE",
      processingBoundary: "LOCAL_ONLY",
      aiAccess: "DENY",
    },
    extractionStatus: "PENDING",
    indexStatus: "PENDING",
    createdBy: own.principalId,
    updatedBy: own.principalId,
    createdAt: "2026-10-14T00:00:00Z",
    updatedAt: "2026-10-14T00:00:00Z",
    deletedAt: null,
  };
  let db = await IndexedDbLocalStore.open("file-extraction", factory);
  try {
    await db.metadata.restoreEmptyWorkspace!(
      {
        schemaVersion: 2,
        identity: own,
        syncState: null,
        mutations: [],
        entities: [
          {
            workspaceId: own.workspaceId,
            collection: "files",
            id: file.id,
            version: 1,
            value: localDto(file),
          },
        ],
      },
      own.deviceId,
    );
    const document = fileExtractionDocument(file, [
      { kind: "TEXT", locator: "text:1", text: "正文" },
    ]);
    expect(
      await db.metadata.fileProcessing!.claim(
        own,
        file,
        "no-index",
        "2026-10-14T00:00:00Z",
        false,
      ),
    ).toBe(true);
    await expect(
      db.metadata.fileProcessing!.finish(own, file, "no-index", "READY", null),
    ).rejects.toThrow("VALIDATION_ERROR");
    await db.metadata.fileProcessing!.finish(
      own,
      file,
      "no-index",
      "PENDING",
      "CANCELED",
    );
    const businessChanged = vi.fn(),
      indexChanged = vi.fn();
    const stopBusiness = db.metadata.subscribe!(
      own.workspaceId,
      businessChanged,
    );
    const stopIndex = db.metadata.subscribeFileIndex!(
      own.workspaceId,
      indexChanged,
    );
    await db.metadata.fileExtractions!.publish(own, document);
    expect(indexChanged).toHaveBeenCalledTimes(1);
    expect(businessChanged).not.toHaveBeenCalled();
    stopBusiness();
    stopIndex();
    expect(await db.metadata.fileExtractions!.get(own, file.id)).toEqual(
      document,
    );
    expect(
      await db.metadata.fileExtractions!.search!(own, "正文", [file.id], 1),
    ).toEqual(document.chunks);
    expect(
      await db.metadata.fileExtractions!.search!(own, "正文", ["other"], 1),
    ).toEqual([]);
    const at = "2026-10-14T00:00:00Z";
    expect(
      await db.metadata.fileProcessing!.claim(
        own,
        file,
        "lease-first",
        at,
        false,
      ),
    ).toBe(true);
    expect(
      await db.metadata.fileProcessing!.claim(
        own,
        file,
        "lease-other",
        at,
        false,
      ),
    ).toBe(false);
    db.close();
    db = await IndexedDbLocalStore.open("file-extraction", factory);
    expect((await db.metadata.fileProcessing!.get(own, file))?.leaseId).toBe(
      "lease-first",
    );
    expect(
      await db.metadata.fileProcessing!.claim(
        own,
        file,
        "lease-recovered",
        "2026-10-14T00:01:01Z",
        false,
      ),
    ).toBe(true);
    await expect(
      db.metadata.fileProcessing!.finish(
        own,
        file,
        "lease-first",
        "READY",
        null,
      ),
    ).rejects.toThrow("VERSION_CONFLICT");
    await db.metadata.fileProcessing!.finish(
      own,
      file,
      "lease-recovered",
      "FAILED",
      "MALFORMED",
    );
    expect(
      await db.metadata.fileProcessing!.claim(
        own,
        file,
        "lease-retry",
        "2026-10-14T00:02:00Z",
        false,
      ),
    ).toBe(false);
    expect(
      await db.metadata.fileProcessing!.claim(
        own,
        file,
        "lease-retry",
        "2026-10-14T00:02:00Z",
        true,
      ),
    ).toBe(true);
    await db.metadata.fileProcessing!.finish(
      own,
      file,
      "lease-retry",
      "READY",
      null,
    );
    expect((await db.metadata.fileProcessing!.get(own, file))?.state).toBe(
      "READY",
    );
    await expect(
      db.metadata.fileProcessing!.claim(
        { ...own, principalId: "other" },
        file,
        "forbidden",
        at,
        true,
      ),
    ).rejects.toThrow("FORBIDDEN");
    await expect(
      db.metadata.fileProcessing!.claim(
        own,
        { ...file, version: 2 },
        "stale",
        at,
        true,
      ),
    ).rejects.toThrow("VERSION_CONFLICT");
    expect(await db.outbox.list(own.workspaceId)).toEqual([]);
    expect(
      await db.metadata.get(own.workspaceId, "files", file.id),
    ).toMatchObject({ version: 1, value: localDto(file) });
    db.close();
    db = await IndexedDbLocalStore.open("file-extraction", factory);
    expect(
      await db.metadata.fileExtractions!.searchIds!(own, "正文", [file.id]),
    ).toEqual([file.id]);
    expect(
      await db.metadata.fileExtractions!.searchIds!(own, "正文", ["other"]),
    ).toEqual([]);
    await expect(
      db.metadata.fileExtractions!.searchIds!(
        { ...own, principalId: "other" },
        "正文",
        [file.id],
      ),
    ).rejects.toThrow("FORBIDDEN");
    expect(await db.metadata.fileExtractions!.get(own, file.id)).toEqual(
      document,
    );
    await expect(
      db.metadata.fileExtractions!.get(
        { ...own, principalId: "other" },
        file.id,
      ),
    ).rejects.toThrow("FORBIDDEN");
    await expect(
      db.metadata.fileExtractions!.publish(own, {
        ...document,
        fileVersion: 2,
      }),
    ).rejects.toThrow("VERSION_CONFLICT");
    expect(await db.metadata.fileExtractions!.get(own, file.id)).toEqual(
      document,
    );
    expect(await db.outbox.list(own.workspaceId)).toEqual([]);
    db.close();
    const invalidBuilder = {
      build: vi.fn(async () => [
        { locator: "wrong-source", text: "forged", grams: ["for"] },
      ]),
    };
    db = await IndexedDbLocalStore.open(
      "file-extraction",
      factory,
      invalidBuilder,
    );
    await expect(
      db.metadata.fileExtractions!.publish(
        { ...own, principalId: "other" },
        document,
      ),
    ).rejects.toThrow("FORBIDDEN");
    await expect(
      db.metadata.fileExtractions!.publish(own, {
        ...document,
        fileVersion: 2,
      }),
    ).rejects.toThrow("VERSION_CONFLICT");
    expect(invalidBuilder.build).not.toHaveBeenCalled();
    await expect(
      db.metadata.fileExtractions!.publish(own, document),
    ).rejects.toThrow("LOCAL_FILE_INDEX_CORRUPT");
    expect(await db.metadata.fileExtractions!.get(own, file.id)).toEqual(
      document,
    );
    expect(
      await db.metadata.fileExtractions!.searchIds!(own, "正文", [file.id]),
    ).toEqual([file.id]);
    const raw = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open("file-extraction");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = raw.transaction("entities", "readwrite");
        tx.objectStore("entities").delete([
          own.workspaceId,
          "$local.fileExtractions",
          file.id,
        ]);
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      raw.close();
    }
    expect(await db.metadata.fileProcessing!.get(own, file)).toBeNull();
    expect(
      await db.metadata.fileProcessing!.claim(
        own,
        file,
        "rebuild-missing",
        "2026-10-14T00:03:00Z",
        false,
      ),
    ).toBe(true);
    db.close();
    db = await IndexedDbLocalStore.open("file-extraction", factory);
    await db.metadata.fileExtractions!.publish(own, document);
    await db.metadata.fileProcessing!.finish(
      own,
      file,
      "rebuild-missing",
      "READY",
      null,
    );
    expect((await db.metadata.fileProcessing!.get(own, file))?.state).toBe(
      "READY",
    );
    expect(await db.outbox.list(own.workspaceId)).toEqual([]);
  } finally {
    db.close();
  }
});
