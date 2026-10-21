import { LocalRuntime, LocalWorkspace } from "@arclattice/application";
import { IndexedDbLocalStore } from "@arclattice/storage-local";
import {
  buildAliasIndex,
  indexDocument,
  normalizeWikiTitle,
  parseWikiLinks,
  resolveWikiLinks,
} from "@arclattice/wiki-core";
import { IDBFactory } from "fake-indexeddb";
import { expect, it, vi } from "vitest";
import { workspaceSnapshotLoader } from "./app/workspace-snapshot-loader";

it("batch-backed Wiki projection follows target rename, source edits and deletion without stale links", async () => {
  const factory = new IDBFactory();
  const store = await IndexedDbLocalStore.open("wiki-batch", factory);
  const identity = {
    schemaVersion: 1 as const,
    workspaceId: crypto.randomUUID(),
    principalId: crypto.randomUUID(),
    deviceId: crypto.randomUUID(),
  };
  await store.identity.ensure(identity);
  const buildRuntime = (metadata: typeof store.metadata) =>
    new LocalRuntime(
      new LocalWorkspace(
        metadata,
        {
          get: async () => null,
          put: async () => {},
        },
        identity,
        {
          extract: (id, markdown) => indexDocument(id, markdown, []),
          resolve: (links, entries) => {
            const aliases = buildAliasIndex(entries);
            return links.map((link) => ({
              ...link,
              targetDocumentId:
                aliases.get(normalizeWikiTitle(link.targetText)) ?? null,
            }));
          },
        },
        { now: () => "2026-10-20T00:00:00Z" },
        { next: () => crypto.randomUUID() },
      ),
    );
  const runtime = buildRuntime(store.metadata);
  try {
    const task = await runtime.service.create(runtime.context, {
      title: "Original task",
      type: "TASK",
    });
    const detached = await runtime.loadWorkspace();
    const independent = await runtime.loadWorkspace();
    Object.assign(detached.items.find((item) => item.id === task.id)!, {
      title: "Caller changed",
    });
    expect(independent.items.find((item) => item.id === task.id)?.title).toBe(
      "Original task",
    );
    expect(
      (await runtime.loadWorkspace()).items.find((item) => item.id === task.id)
        ?.title,
    ).toBe("Original task");
    const readSnapshot = workspaceSnapshotLoader(
      () => runtime.workspaceRevision(),
      () => runtime.loadWorkspace(),
    );
    const published: Awaited<ReturnType<typeof runtime.loadWorkspace>>[] = [];
    const publish = (
      value: Awaited<ReturnType<typeof runtime.loadWorkspace>>,
    ) => {
      published.push(value);
      return true;
    };
    await readSnapshot(publish);
    await readSnapshot(publish);
    expect(published).toHaveLength(1);
    const other = await IndexedDbLocalStore.open("wiki-batch", factory);
    try {
      const remoteWrite = await buildRuntime(other.metadata).service.create(
        runtime.context,
        { type: "TASK", title: "Second connection" },
      );
      await readSnapshot(publish);
      expect(published).toHaveLength(2);
      expect(
        published[1]!.items.some((item) => item.id === remoteWrite.id),
      ).toBe(true);
    } finally {
      other.close();
    }
    const space = await runtime.saveLibrary(null, 0, {
      kind: "SPACE",
      title: "Space",
      spaceId: null,
      bodyMd: "",
    });
    const target = await runtime.saveLibrary(null, 0, {
      kind: "DOCUMENT",
      title: "Target",
      spaceId: space.id,
      bodyMd: "Target\r\n正文",
    });
    const metadataList = vi.spyOn(store.metadata, "list");
    const emptyBacklinks = await runtime.noteBacklinks(target.id, () => []);
    expect(emptyBacklinks).toEqual({ references: [], resolvedNoteIds: [] });
    expect(
      metadataList.mock.calls.some(
        ([, collection]) => collection === "library",
      ),
    ).toBe(false);
    metadataList.mockRestore();
    const queryWorkspace = new LocalWorkspace(
      store.metadata,
      { get: async () => null, put: async () => {} },
      identity,
      {
        extract: (id, markdown) => indexDocument(id, markdown, []),
        resolve: (links) => [...links],
      },
      { now: () => "2026-10-20T00:00:00Z" },
      { next: () => crypto.randomUUID() },
    );
    await queryWorkspace.run(
      async (services) => {
        const before = await services.ports.library.listMetadata!();
        expect(await services.ports.library.listMetadata!()).toBe(before);
      },
      undefined,
      true,
    );
    await queryWorkspace
      .run(async (services) => {
        const before = await services.ports.library.listMetadata!();
        await services.ports.library.save(
          { ...target, title: "Within command", version: target.version + 1 },
          target.version,
        );
        const after = await services.ports.library.listMetadata!();
        expect(after).not.toBe(before);
        expect(after.find((entry) => entry.id === target.id)?.title).toBe(
          "Within command",
        );
        throw new Error("ROLLBACK_METADATA_REUSE_PROBE");
      })
      .then(
        () => {
          throw new Error("EXPECTED_ROLLBACK");
        },
        (error: Error) =>
          expect(error.message).toBe("ROLLBACK_METADATA_REUSE_PROBE"),
      );
    expect((await runtime.readDocumentBody(target)).title).toBe("Target");
    const source = await runtime.saveLibrary(null, 0, {
      kind: "DOCUMENT",
      title: "Source",
      spaceId: space.id,
      bodyMd: "[[Target]]\r\n",
    });
    const note = await runtime.saveNote(null, 0, {
      kind: "NOTE",
      day: null,
      title: "Backlink note",
      bodyMd: "[[Target]]\r\n正文",
    });
    const resolveNote: Parameters<typeof runtime.noteBacklinks>[1] = (
      markdown,
      documents,
    ) => resolveWikiLinks(parseWikiLinks(markdown), documents);
    const revisionBeforeBacklinks = await runtime.workspaceRevision();
    const backlinks = await runtime.noteBacklinks(target.id, resolveNote);
    expect(backlinks.references).toMatchObject([
      { sourceId: note.id, targetDocumentId: target.id, targetText: "Target" },
    ]);
    backlinks.references[0]!.targetText = "Caller changed";
    backlinks.resolvedNoteIds.length = 0;
    expect(
      (await runtime.noteBacklinks(target.id, resolveNote)).references,
    ).toMatchObject([
      { sourceId: note.id, targetDocumentId: target.id, targetText: "Target" },
    ]);
    expect(await runtime.workspaceRevision()).toBe(revisionBeforeBacklinks);
    expect((await runtime.readDocumentBody(note)).bodyMd).toBe(
      "[[Target]]\r\n正文",
    );
    expect((await runtime.loadWorkspace()).wikiLinks).toMatchObject([
      { sourceDocumentId: source.id, targetDocumentId: target.id },
    ]);
    const backup = await store.metadata.exportWorkspace!(identity.workspaceId);
    const restored = await IndexedDbLocalStore.open(
      "wiki-projection-repair",
      new IDBFactory(),
    );
    try {
      await restored.metadata.restoreEmptyWorkspace!(
        {
          ...backup,
          entities: backup.entities.filter(
            (row) => row.collection !== "$local.wikiSources",
          ),
        },
        identity.deviceId,
      );
      const repairedRuntime = buildRuntime(restored.metadata);
      const beforeRepair = await repairedRuntime.workspaceRevision();
      const loadRepair = vi.fn(() =>
        repairedRuntime.loadWorkspaceWithRevision(),
      );
      const repairSnapshots: Awaited<ReturnType<typeof loadRepair>>[] = [];
      const readRepair = workspaceSnapshotLoader(
        () => repairedRuntime.workspaceRevision(),
        loadRepair,
        (value) => value.revision,
      );
      const publishRepair = (value: Awaited<ReturnType<typeof loadRepair>>) => {
        repairSnapshots.push(value);
        return true;
      };
      await readRepair(publishRepair);
      await readRepair(publishRepair);
      expect(loadRepair).toHaveBeenCalledTimes(1);
      expect(repairSnapshots[0]!.revision).toBeGreaterThan(beforeRepair ?? 0);
      expect(repairSnapshots[0]!.revision).toBe(
        await repairedRuntime.workspaceRevision(),
      );
      const repaired = repairSnapshots[0]!.snapshot;
      expect(repaired.wikiLinks).toMatchObject([
        { sourceDocumentId: source.id, targetDocumentId: target.id },
      ]);
      Object.assign(repaired.wikiLinks![0]!, { targetText: "Caller changed" });
      expect(
        (await buildRuntime(restored.metadata).loadWorkspace()).wikiLinks,
      ).toMatchObject([{ sourceDocumentId: source.id, targetText: "Target" }]);
      const persisted = (
        await restored.metadata.list(identity.workspaceId, "$local.wikiSources")
      ).find((row) => row.id === source.id);
      expect(JSON.stringify(persisted)).not.toContain("Caller changed");
      expect(
        (await buildRuntime(restored.metadata).readDocumentBody(source)).bodyMd,
      ).toBe("[[Target]]\r\n");
      expect(
        (
          await restored.metadata.list(
            identity.workspaceId,
            "$local.wikiSources",
          )
        ).some((row) => row.id === source.id),
      ).toBe(true);
    } finally {
      restored.close();
    }
    const renamed = await runtime.saveLibrary(target.id, target.version, {
      kind: "DOCUMENT",
      title: "Renamed",
      spaceId: space.id,
      bodyMd: target.bodyMd,
    });
    expect((await runtime.loadWorkspace()).wikiLinks).toMatchObject([
      { targetDocumentId: target.id, targetText: "Target" },
    ]);
    await runtime.saveLibrary(source.id, source.version, {
      kind: "DOCUMENT",
      title: "Source",
      spaceId: space.id,
      bodyMd: "[[Renamed]]\r\n",
    });
    expect((await runtime.loadWorkspace()).wikiLinks).toMatchObject([
      { targetDocumentId: target.id, targetText: "Renamed" },
    ]);
    await runtime.deleteLibrary(renamed.id, renamed.version, true);
    expect((await runtime.loadWorkspace()).wikiLinks).toMatchObject([
      { targetDocumentId: null },
    ]);
    expect((await runtime.readDocumentBody(source)).bodyMd).toBe(
      "[[Renamed]]\r\n",
    );
  } finally {
    store.close();
  }
});
