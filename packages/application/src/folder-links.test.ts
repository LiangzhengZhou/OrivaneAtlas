import { DomainError } from "@arclattice/domain";
import { describe, expect, it } from "vitest";
import {
  type FolderLink,
  FolderLinkService,
  type FolderLinkStore,
} from "./folder-links";

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
