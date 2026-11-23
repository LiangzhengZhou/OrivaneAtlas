import { DomainError } from "@arclattice/domain";
import { describe, expect, it } from "vitest";
import {
  type FolderLink,
  FolderLinkService,
  type FolderLinkStore,
} from "./folder-links";

import { localFolderLinkTargets } from "./local-folder-links";

const context = { workspaceId: "workspace-a", principalId: "human" };
const folderId = "11111111-1111-4111-8111-111111111111";
const noteId = "22222222-2222-4222-8222-222222222222";

function harness(folderScope = "GENERAL") {
  let rows: FolderLink[] = [];
  const store: FolderLinkStore = {
    async list() {
      return structuredClone(rows);
    },
    async findActive(folder, targetKind, targetId) {
      return (
        structuredClone(
          rows.find(
            (row) =>
              row.deletedAt === null &&
              row.folderId === folder &&
              row.targetKind === targetKind &&
              row.targetId === targetId,
          ),
        ) ?? null
      );
    },
    async save(value, expected) {
      const index = rows.findIndex((row) => row.id === value.id);
      if ((index < 0 ? 0 : rows[index]!.version) !== expected)
        throw new DomainError("VERSION_CONFLICT");
      if (index < 0) rows = [...rows, structuredClone(value)];
      else rows[index] = structuredClone(value);
    },
  };
  const service = new FolderLinkService(
    store,
    {
      async folder() {
        return { archived: false, scope: folderScope };
      },
      async target() {
        return true;
      },
    },
    { require: async () => undefined },
    { now: () => "2026-10-29T00:00:00.000Z" },
    { next: () => "33333333-3333-4333-8333-333333333333" },
  );
  return { service, rows: () => structuredClone(rows) };
}

describe("FolderLinkService", () => {
  it("checks the stored library kind in the local replica and surfaces storage failures", async () => {
    const targets = localFolderLinkTargets(
      { organizations: async () => [], workspaceEntity: async () => null },
      {
        async get<T>(_collection: string, id: string) {
          if (id === "missing") throw new DomainError("NOT_FOUND");
          if (id === "broken") throw new Error("LOCAL_DATA_CORRUPT");
          return { kind: id, deletedAt: null } as T;
        },
      },
    );
    expect(await targets.target("DOCUMENT", "SPACE")).toBe(false);
    expect(await targets.space("DOCUMENT")).toBe(false);
    expect(await targets.space("SPACE")).toBe(true);
    expect(await targets.target("DOCUMENT", "DOCUMENT")).toBe(true);
    expect(await targets.target("DOCUMENT", "missing")).toBe(false);
    await expect(targets.target("DOCUMENT", "broken")).rejects.toThrow(
      "LOCAL_DATA_CORRUPT",
    );
  });

  it("creates, lists and soft-removes a general folder link with versions", async () => {
    const h = harness();
    const created = await h.service.create(context, {
      folderId,
      targetKind: "NOTE",
      targetId: noteId,
    });
    expect(created).toMatchObject({
      workspaceId: context.workspaceId,
      folderId,
      targetKind: "NOTE",
      targetId: noteId,
      version: 1,
      deletedAt: null,
    });
    expect(await h.service.list(context, folderId)).toHaveLength(1);
    const removed = await h.service.remove(context, created.id, 1);
    expect(removed).toMatchObject({
      version: 2,
      deletedAt: expect.any(String),
    });
    expect(await h.service.list(context, folderId)).toHaveLength(0);
    await expect(h.service.remove(context, created.id, 2)).rejects.toThrow();
  });

  it("moves only the reviewed membership, preserving other links when a destination changed", async () => {
    const h = harness();
    const dest = "44444444-4444-4444-8444-444444444444";
    const third = "55555555-5555-4555-8555-555555555555";
    const input = { folderId, targetKind: "NOTE" as const, targetId: noteId };
    const source = await h.service.create(context, input);
    const other = await h.service.create(
      context,
      { ...input, folderId: third },
      third,
    );
    const move = {
      id: source.id,
      version: 1,
      folderId: dest,
      destinationLinkId: null,
    };
    await expect(
      h.service.move(context, { ...move, folderId }),
    ).rejects.toThrow();
    await expect(
      h.service.move(context, { ...move, version: 2 }),
    ).rejects.toThrow();
    await expect(
      h.service.move({ ...context, workspaceId: "elsewhere" }, move),
    ).rejects.toThrow();
    expect(h.rows()).toEqual([source, other]);
    const destination = await h.service.create(
      context,
      { ...input, folderId: dest },
      dest,
    );
    await expect(h.service.move(context, move)).rejects.toThrow();
    expect(h.rows()).toEqual([source, other, destination]);
    const removed = await h.service.move(context, {
      ...move,
      destinationLinkId: destination.id,
    });
    expect(removed).toMatchObject({
      id: source.id,
      version: 2,
      deletedAt: expect.any(String),
    });
    expect(h.rows().slice(1)).toEqual([other, destination]);
    const moved = await h.service.move(context, {
      ...move,
      id: other.id,
      folderId,
    });
    expect(moved).toMatchObject({
      id: other.id,
      folderId,
      targetId: noteId,
      version: 2,
      deletedAt: null,
    });
  });

  it.each(["PROJECT", "SPACE"])(
    "rejects generic folder links to %s",
    async (kind) => {
      const h = harness();
      await expect(
        h.service.create(context, {
          folderId,
          targetKind: kind as never,
          targetId: noteId,
        }),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    },
  );

  it("rejects note-scope folders, duplicate active targets and stale versions", async () => {
    const noteScoped = harness("NOTE");
    await expect(
      noteScoped.service.create(context, {
        folderId,
        targetKind: "NOTE",
        targetId: noteId,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const h = harness();
    const created = await h.service.create(
      context,
      { folderId, targetKind: "FILE", targetId: noteId },
      "44444444-4444-4444-8444-444444444444",
    );
    await expect(
      h.service.create(context, {
        folderId,
        targetKind: "FILE",
        targetId: noteId,
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(
      h.service.remove(context, created.id, 9),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });
});
