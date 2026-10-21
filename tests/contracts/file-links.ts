import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import {
  ConnectedService,
  type ConnectedStore,
  FileService,
  type LibraryFileStore,
  LibraryService,
  type LibraryStore,
  type LocalChunkBlobStore,
  type UnitOfWork,
  WorkService,
} from "../../packages/application/src/index";
import {
  type ActorContext,
  DomainError,
} from "../../packages/domain/src/index";
export type FileLinkRun = <T>(
  actor: ActorContext,
  operation: (
    work: UnitOfWork,
    connected: ConnectedStore,
    library: LibraryStore,
    files: LibraryFileStore,
    blobs: LocalChunkBlobStore,
  ) => Promise<T>,
) => Promise<T>;
export async function fileLinkScenario(run: FileLinkRun) {
  const actor = { workspaceId: "workspace-a", principalId: "human" },
    auth = {
      require: async (context: ActorContext) => {
        if (context.principalId !== actor.principalId)
          throw new DomainError("FORBIDDEN");
      },
    },
    clock = { now: () => "2026-10-14T00:00:00Z" },
    ids = { next: randomUUID };
  const project = await run(actor, (work) =>
    new WorkService(work, auth, clock, ids).create(actor, {
      type: "PROJECT",
      title: "File project",
    }),
  );
  const space = await run(actor, (_work, _connected, library) =>
    new LibraryService(library, auth, clock, ids).save(actor, null, 0, {
      kind: "SPACE",
      spaceId: null,
      title: "Files",
      bodyMd: "",
    }),
  );
  const document = await run(actor, (_work, _connected, library) =>
    new LibraryService(library, auth, clock, ids).save(actor, null, 0, {
      kind: "DOCUMENT",
      spaceId: space.id,
      title: "Source document",
      bodyMd: "Source",
    }),
  );
  const file = await run(actor, (_work, _connected, library, files, blobs) =>
    new FileService(files, library, blobs, auth, clock, ids).upload(
      actor,
      {
        name: "original.txt",
        mime: "text/plain",
        spaceId: space.id,
        parentDocumentId: document.id,
      },
      new Blob(["original"]),
    ),
  );
  const from = { kind: "FILE" as const, id: file.id },
    to = { kind: "WORK" as const, id: project.id };
  const link = await run(actor, (_work, connected) =>
    new ConnectedService(connected, auth, clock, ids).link(
      actor,
      from,
      to,
      "RELATED",
    ),
  );
  expect(link.from).toEqual(from);
  for (const [kind, id] of [
    ["SPACE", space.id],
    ["DOCUMENT", document.id],
  ] as const) {
    expect(
      await run(actor, (work) =>
        work.run(actor.workspaceId, (tx) =>
          tx.workspaceRelatedLinks!(kind, id),
        ),
      ),
    ).toEqual([link]);
    expect(
      await run({ ...actor, workspaceId: "workspace-b" }, (work) =>
        work.run("workspace-b", (tx) => tx.workspaceRelatedLinks!(kind, id)),
      ),
    ).toEqual([]);
  }
  expect(
    await run({ ...actor, workspaceId: "workspace-b" }, (_work, connected) =>
      connected.exists(from),
    ),
  ).toBe(false);
  await expect(
    run({ ...actor, principalId: "other" }, (_work, connected) =>
      new ConnectedService(connected, auth, clock, ids).link(
        { ...actor, principalId: "other" },
        from,
        to,
        "RELATED",
      ),
    ),
  ).rejects.toThrow("FORBIDDEN");
  await expect(
    run(actor, async (_work, connected) => {
      await new ConnectedService(connected, auth, clock, ids).link(
        actor,
        from,
        { kind: "DOCUMENT", id: document.id },
        "REFERENCES",
      );
      throw new Error("ROLLBACK_FILE_LINK");
    }),
  ).rejects.toThrow("ROLLBACK_FILE_LINK");
  expect(await run(actor, (_work, connected) => connected.links())).toEqual([
    link,
  ]);
  await run(actor, (_work, _connected, library) =>
    new LibraryService(library, auth, clock, ids).setDeleted(
      actor,
      document.id,
      1,
      true,
    ),
  );
  expect(await run(actor, (_work, connected) => connected.exists(from))).toBe(
    false,
  );
  await expect(
    run(actor, (_work, connected) =>
      new ConnectedService(connected, auth, clock, ids).link(
        actor,
        from,
        to,
        "RELATED",
      ),
    ),
  ).rejects.toThrow("NOT_FOUND");
  await run(actor, (_work, _connected, library) =>
    new LibraryService(library, auth, clock, ids).setDeleted(
      actor,
      document.id,
      2,
      false,
    ),
  );
  expect(await run(actor, (_work, connected) => connected.exists(from))).toBe(
    true,
  );
  await run(actor, (_work, _connected, library, files, blobs) =>
    new FileService(files, library, blobs, auth, clock, ids).setDeleted(
      actor,
      file.id,
      1,
      true,
    ),
  );
  expect(await run(actor, (_work, connected) => connected.exists(from))).toBe(
    false,
  );
  expect(
    await run(actor, (_work, _connected, _library, files) =>
      files.get(file.id),
    ),
  ).toMatchObject({
    version: 2,
    contentHash: file.contentHash,
    originalName: "original.txt",
  });
}
