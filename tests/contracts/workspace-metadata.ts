import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import {
  bodyManifest,
  LibraryService,
  type LibraryStore,
  NotebookService,
  type NotebookStore,
} from "../../packages/application/src/index";
import type { ActorContext } from "../../packages/domain/src/index";

export async function workspaceMetadataScenario(
  context: ActorContext,
  notes: NotebookStore,
  library: LibraryStore,
) {
  const auth = { require: async () => {} },
    clock = { now: () => "2026-10-05T12:00:00Z" },
    ids = { next: randomUUID };
  const documents = new LibraryService(library, auth, clock, ids);
  const captures = new NotebookService(notes, auth, clock, ids);
  expect(await library.ensureWikiIndex!()).toBe(false);
  const space = await documents.save(context, null, 0, {
    kind: "SPACE",
    spaceId: null,
    title: "Knowledge",
    bodyMd: "Space intro",
  });
  const target = await documents.save(context, null, 0, {
    kind: "DOCUMENT",
    spaceId: space.id,
    title: "Architecture",
    bodyMd: "中文😀",
  });
  const source = await documents.save(context, null, 0, {
    kind: "DOCUMENT",
    spaceId: space.id,
    title: "Source",
    bodyMd: "[[Architecture]]",
  });
  const note = await captures.save(context, null, 0, {
    kind: "NOTE",
    day: null,
    title: "Capture",
    bodyMd: "中文😀\n[[Architecture]]",
  });
  const renamed = await documents.save(context, target.id, target.version, {
    kind: "DOCUMENT",
    spaceId: space.id,
    title: "System architecture",
    bodyMd: target.bodyMd,
  });
  const metadata = await library.listMetadata!();
  expect(await notes.searchIds!("Architecture")).toEqual([note.id]);
  expect(await notes.searchIds!("中文😀")).toEqual([note.id]);
  expect(await notes.searchIds!("%")).toEqual([]);
  expect(await notes.searchIds!("missing")).toEqual([]);
  expect(metadata).toEqual((await library.list()).map(bodyManifest));
  expect(await notes.listMetadata!()).toEqual(
    (await notes.list()).map(bodyManifest),
  );
  expect(metadata.find((entry) => entry.id === target.id)).toMatchObject({
    version: renamed.version,
    bodyCharacterCount: 3,
    aliases: expect.arrayContaining(["Architecture"]),
    bodyState: "UNLOADED",
  });
  for (const entry of metadata) expect(entry).not.toHaveProperty("bodyMd");
  expect(await library.ensureWikiIndex!()).toBe(false);
  expect(await library.wikiLinks!()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        sourceDocumentId: source.id,
        targetDocumentId: target.id,
      }),
    ]),
  );
  return { source, target: renamed, note, space };
}
