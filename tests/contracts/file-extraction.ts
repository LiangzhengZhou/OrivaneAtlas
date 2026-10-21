import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import {
  FileExtractionService,
  type FileExtractionStore,
  FileService,
  type LibraryFileStore,
  type LibraryStore,
  type LocalChunkBlobStore,
} from "../../packages/application/src/index";
import { DomainError } from "../../packages/domain/src/index";
import { BoundedFileParser } from "../../packages/file-parsers/src/index";
export type FileExtractionTestRun = <T>(
  operation: (
    files: LibraryFileStore,
    library: LibraryStore,
    blobs: LocalChunkBlobStore,
  ) => Promise<T>,
) => Promise<T>;
export async function fileExtractionScenario(run: FileExtractionTestRun) {
  const actor = { workspaceId: "workspace-a", principalId: "human" },
    auth = {
      require: async (context: typeof actor) => {
        if (
          context.workspaceId !== actor.workspaceId ||
          context.principalId !== actor.principalId
        )
          throw new DomainError("FORBIDDEN");
      },
    },
    clock = { now: () => "2026-10-14T00:00:00Z" },
    ids = { next: randomUUID };
  const source = {
    read: (context: typeof actor, id: string) =>
      run((files, library, blobs) =>
        new FileService(files, library, blobs, auth, clock, ids).read(
          context,
          id,
        ),
      ),
    bytes: (context: typeof actor, id: string) =>
      run((files, library, blobs) =>
        new FileService(files, library, blobs, auth, clock, ids).originalBytes(
          context,
          id,
        ),
      ),
  };
  const store: FileExtractionStore = {
    searchIds: (context, query, ids) =>
      run((files) => {
        if (!files.extractions?.searchIds)
          throw new Error("MISSING_EXTRACTION_SEARCH_IDS_PORT");
        return files.extractions.searchIds(context, query, ids);
      }),
    search: (context, query, ids, limit) =>
      run((files) => {
        if (!files.extractions?.search)
          throw new Error("MISSING_EXTRACTION_SEARCH_PORT");
        return files.extractions.search(context, query, ids, limit);
      }),
    get: (context, id) =>
      run((files) => {
        if (!files.extractions) throw new Error("MISSING_EXTRACTION_PORT");
        return files.extractions.get(context, id);
      }),
    publish: (context, document) =>
      run((files) => {
        if (!files.extractions) throw new Error("MISSING_EXTRACTION_PORT");
        return files.extractions.publish(context, document);
      }),
  };
  const file = await run((files, library, blobs) =>
    new FileService(files, library, blobs, auth, clock, ids).upload(
      actor,
      { name: "原文.txt", mime: "text/plain", spaceId: null },
      new Blob(["a".repeat(3999) + "😀第二行\n" + "b".repeat(4000)]),
    ),
  );
  const service = new FileExtractionService(
    source,
    store,
    new BoundedFileParser(),
    auth,
  );
  await expect(
    service.extract({ ...actor, principalId: "other" }, file.id, 1),
  ).rejects.toThrow("FORBIDDEN");
  const document = await service.extract(actor, file.id, 1);
  expect(document.chunks).toHaveLength(3);
  expect(document.chunks.map((chunk) => chunk.text).join("")).toBe(
    await (await source.bytes(actor, file.id)).text(),
  );
  expect(document.chunks[0]?.text).toHaveLength(3999);
  expect(await store.get(actor, file.id)).toEqual(document);
  expect(await source.read(actor, file.id)).toEqual(file);
  const hits = await service.search(actor, "第二行", [file.id], 1);
  expect(hits).toHaveLength(1);
  expect(hits[0]?.text).toContain("第二行");
  expect(await service.searchFileIds(actor, "第二行", [file.id])).toEqual([
    file.id,
  ]);
  expect(await service.searchFileIds(actor, "第二行", ["unrelated"])).toEqual(
    [],
  );
  expect(await service.search(actor, "第二行", ["unrelated"], 1)).toEqual([]);
  await run(async (files) => {
    await expect(
      files.extractions!.get({ ...actor, workspaceId: "workspace-b" }, file.id),
    ).rejects.toThrow("FORBIDDEN");
    await expect(
      files.extractions!.publish(actor, { ...document, fileVersion: 2 }),
    ).rejects.toThrow("VERSION_CONFLICT");
  });
  expect(await store.get(actor, file.id)).toEqual(document);
  expect(await service.search(actor, "第二行", [file.id], 1)).toEqual(hits);
  await expect(
    run(async (files) => {
      await files.extractions!.publish(actor, { ...document, chunks: [] });
      throw new Error("ROLLBACK_EXTRACTION");
    }),
  ).rejects.toThrow("ROLLBACK_EXTRACTION");
  expect(await store.get(actor, file.id)).toEqual(document);
  const rename = () =>
    run((files, library, blobs) =>
      new FileService(files, library, blobs, auth, clock, ids).rename(
        actor,
        file.id,
        1,
        "新名称.txt",
      ),
    );
  await rename();
  expect(await store.get(actor, file.id)).toBeNull();
  expect(await service.searchFileIds(actor, "第二行", [file.id])).toEqual([]);
  expect(await service.search(actor, "第二行", [file.id], 1)).toEqual([]);
  await expect(service.extract(actor, file.id, 1)).rejects.toThrow(
    "VERSION_CONFLICT",
  );
  const updated = await service.extract(actor, file.id, 2);
  expect(updated.fileVersion).toBe(2);
  expect(updated.contentHash).toBe(file.contentHash);
  expect(updated.chunks.map((chunk) => chunk.text).join("")).toBe(
    document.chunks.map((chunk) => chunk.text).join(""),
  );
  await run((files, library, blobs) =>
    new FileService(files, library, blobs, auth, clock, ids).setDeleted(
      actor,
      file.id,
      2,
      true,
    ),
  );
  await expect(store.get(actor, file.id)).rejects.toThrow("NOT_FOUND");
  await expect(service.extract(actor, file.id, 3)).rejects.toThrow("NOT_FOUND");
  expect(await service.search(actor, "第二行", [file.id], 1)).toEqual([]);
}
