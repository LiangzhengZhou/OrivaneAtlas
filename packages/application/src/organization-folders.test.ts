import { DomainError } from "@arclattice/domain";
import { describe, expect, it } from "vitest";
import {
  type Organization,
  OrganizationService,
  requireFolderName,
} from "./organization";
import { requireCanonicalOrganization } from "./organization-replay-effects";

const context = { workspaceId: "workspace-a", principalId: "human" };
const instant = "2026-10-26T00:00:00.000Z";
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

type FakeNote = {
  id: string;
  workspaceId: string;
  version: number;
  deletedAt: string | null;
};

function harness(options?: {
  organization?: Organization[];
  notes?: FakeNote[];
}) {
  let rows = structuredClone(options?.organization ?? []);
  const notes = structuredClone(options?.notes ?? []);
  const store = {
    async list() {
      return structuredClone(rows);
    },
    async save(value: Organization, expectedVersion: number) {
      const index = rows.findIndex(
        (entry) => entry.kind === value.kind && entry.id === value.id,
      );
      const current = index < 0 ? 0 : rows[index]!.version;
      if (current !== expectedVersion)
        throw new DomainError("VERSION_CONFLICT");
      if (index < 0) rows = [...rows, structuredClone(value)];
      else rows[index] = structuredClone(value);
    },
  };
  const notebook = {
    async list() {
      return structuredClone(notes);
    },
    async manifest() {
      return structuredClone(notes);
    },
    async setDeleted(
      _context: unknown,
      id: string,
      version: number,
      deleted: boolean,
    ) {
      const note = notes.find((entry) => entry.id === id);
      if (!note || note.version !== version)
        throw new DomainError("VERSION_CONFLICT");
      note.version += 1;
      note.deletedAt = deleted ? instant : null;
      return structuredClone(note);
    },
  };
  const work = {
    async snapshot() {
      return { items: [], edges: [] };
    },
    async setDeleted() {
      throw new DomainError("NOT_FOUND");
    },
  };
  const service = new OrganizationService(
    store,
    work as never,
    notebook as never,
    { require: async () => undefined } as never,
    { now: () => instant },
  );
  return {
    service,
    rows: () => structuredClone(rows),
    notes: () => structuredClone(notes),
  };
}

describe("first-class note folders (ADR0138)", () => {
  it("restores a deleted folder with its original identity and rejects stale recovery", async () => {
    const h = harness();
    await h.service.apply(context, {
      kind: "FOLDER",
      action: "create",
      id: uuid(1),
      name: "Research",
      parentId: "",
    });
    await h.service.apply(context, {
      kind: "FOLDER",
      action: "delete",
      entries: [{ id: uuid(1), version: 1, organizationVersion: 1 }],
    });
    const restore = {
      kind: "FOLDER",
      action: "unarchive",
      entries: [{ id: uuid(1), version: 2, organizationVersion: 2 }],
    } as const;
    await h.service.apply(context, {
      ...restore,
      entries: [...restore.entries],
    });
    expect(h.rows()).toMatchObject([
      { id: uuid(1), name: "Research", version: 3, archived: false },
    ]);
    await expect(
      h.service.apply(context, { ...restore, entries: [...restore.entries] }),
    ).rejects.toThrow();
  });
  it("creates nested folders with stable identity and separate display names", async () => {
    const h = harness();
    await h.service.apply(context, {
      kind: "FOLDER",
      action: "create",
      id: uuid(1),
      name: "Research",
      parentId: "",
    });
    await h.service.apply(context, {
      kind: "FOLDER",
      action: "create",
      id: uuid(2),
      name: "  Papers  ",
      parentId: uuid(1),
    });
    expect(h.rows()).toEqual([
      expect.objectContaining({
        kind: "FOLDER",
        id: uuid(1),
        name: "Research",
        parentId: "",
        folder: "",
        archived: false,
        version: 1,
      }),
      expect.objectContaining({
        kind: "FOLDER",
        id: uuid(2),
        name: "Papers",
        parentId: uuid(1),
        version: 1,
      }),
    ]);
    await expect(
      h.service.apply(context, {
        kind: "FOLDER",
        action: "create",
        id: uuid(3),
        name: "Orphan",
        parentId: uuid(99),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("renames and moves with the organization version as CAS guard", async () => {
    const h = harness();
    for (const [id, name, parentId] of [
      [uuid(1), "A", ""],
      [uuid(2), "B", ""],
      [uuid(3), "Child", uuid(2)],
    ] as const)
      await h.service.apply(context, {
        kind: "FOLDER",
        action: "create",
        id,
        name,
        parentId,
      });
    await h.service.apply(context, {
      kind: "FOLDER",
      action: "rename",
      name: "Renamed",
      entries: [{ id: uuid(1), version: 1, organizationVersion: 1 }],
    });
    await h.service.apply(context, {
      kind: "FOLDER",
      action: "move",
      parentId: uuid(2),
      entries: [{ id: uuid(1), version: 2, organizationVersion: 2 }],
    });
    expect(h.rows().find((entry) => entry.id === uuid(1))).toMatchObject({
      name: "Renamed",
      parentId: uuid(2),
      version: 3,
    });
    await expect(
      h.service.apply(context, {
        kind: "FOLDER",
        action: "rename",
        name: "Stale",
        entries: [{ id: uuid(1), version: 2, organizationVersion: 2 }],
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });

  it("rejects cycles and nesting deeper than the shared bound", async () => {
    const h = harness();
    const ids = Array.from({ length: 9 }, (_, index) => uuid(index + 1));
    await h.service.apply(context, {
      kind: "FOLDER",
      action: "create",
      id: ids[0]!,
      name: "Root",
      parentId: "",
    });
    for (let depth = 1; depth < 8; depth += 1)
      await h.service.apply(context, {
        kind: "FOLDER",
        action: "create",
        id: ids[depth]!,
        name: "Level " + depth,
        parentId: ids[depth - 1]!,
      });
    await expect(
      h.service.apply(context, {
        kind: "FOLDER",
        action: "create",
        id: ids[8]!,
        name: "Too deep",
        parentId: ids[7]!,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      h.service.apply(context, {
        kind: "FOLDER",
        action: "move",
        parentId: ids[2]!,
        entries: [{ id: ids[1]!, version: 1, organizationVersion: 1 }],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      h.service.apply(context, {
        kind: "FOLDER",
        action: "move",
        parentId: ids[1]!,
        entries: [{ id: ids[1]!, version: 1, organizationVersion: 1 }],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("soft deletes only empty folders and keeps note membership explicit", async () => {
    const h = harness();
    await h.service.apply(context, {
      kind: "FOLDER",
      action: "create",
      id: uuid(1),
      name: "Empty",
      parentId: "",
    });
    await h.service.apply(context, {
      kind: "FOLDER",
      action: "create",
      id: uuid(2),
      name: "Parent",
      parentId: "",
    });
    await h.service.apply(context, {
      kind: "FOLDER",
      action: "create",
      id: uuid(3),
      name: "Child",
      parentId: uuid(2),
    });
    await expect(
      h.service.apply(context, {
        kind: "FOLDER",
        action: "delete",
        entries: [{ id: uuid(2), version: 1, organizationVersion: 1 }],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await h.service.apply(context, {
      kind: "FOLDER",
      action: "delete",
      entries: [{ id: uuid(1), version: 1, organizationVersion: 1 }],
    });
    expect(h.rows().find((entry) => entry.id === uuid(1))).toMatchObject({
      archived: true,
      version: 2,
    });
  });

  it("moves notes by stable folder identity and clears the legacy label", async () => {
    const h = harness({
      notes: [
        {
          id: "note-1",
          workspaceId: context.workspaceId,
          version: 2,
          deletedAt: null,
        },
      ],
      organization: [
        {
          kind: "NOTE",
          id: "note-1",
          workspaceId: context.workspaceId,
          version: 1,
          archived: false,
          folder: "Legacy",
          updatedAt: instant,
          updatedBy: "human",
        },
      ],
    });
    await h.service.apply(context, {
      kind: "FOLDER",
      action: "create",
      id: uuid(1),
      name: "Target",
      parentId: "",
    });
    await h.service.apply(context, {
      kind: "NOTE",
      action: "move",
      folderId: uuid(1),
      entries: [{ id: "note-1", version: 2, organizationVersion: 1 }],
    });
    expect(h.rows()[0]).toMatchObject({
      kind: "NOTE",
      id: "note-1",
      folder: "",
      folderId: uuid(1),
      version: 2,
    });
    await expect(
      h.service.apply(context, {
        kind: "NOTE",
        action: "move",
        folderId: uuid(9),
        entries: [{ id: "note-1", version: 2, organizationVersion: 2 }],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("stores bounded emoji presentation icons on notes and folders", async () => {
    const h = harness({
      notes: [
        {
          id: "note-1",
          workspaceId: context.workspaceId,
          version: 2,
          deletedAt: null,
        },
      ],
    });
    await h.service.apply(context, {
      kind: "NOTE",
      action: "icon",
      icon: "🔬",
      entries: [{ id: "note-1", version: 2, organizationVersion: 0 }],
    });
    expect(h.rows()[0]).toMatchObject({
      kind: "NOTE",
      id: "note-1",
      icon: "🔬",
      folder: "",
      version: 1,
    });
    await h.service.apply(context, {
      kind: "NOTE",
      action: "icon",
      icon: "📚",
      entries: [{ id: "note-1", version: 2, organizationVersion: 1 }],
    });
    expect(h.rows()[0]).toMatchObject({ icon: "📚", version: 2 });
    await h.service.apply(context, {
      kind: "NOTE",
      action: "icon",
      icon: "",
      entries: [{ id: "note-1", version: 2, organizationVersion: 2 }],
    });
    expect(h.rows()[0]).toMatchObject({ icon: "", version: 3 });
    await h.service.apply(context, {
      kind: "FOLDER",
      action: "create",
      id: uuid(5),
      name: "Lab",
      parentId: "",
    });
    await h.service.apply(context, {
      kind: "FOLDER",
      action: "icon",
      icon: "🧪",
      entries: [{ id: uuid(5), version: 1, organizationVersion: 1 }],
    });
    expect(h.rows()[1]).toMatchObject({
      kind: "FOLDER",
      id: uuid(5),
      name: "Lab",
      icon: "🧪",
      version: 2,
    });
    await expect(
      h.service.apply(context, {
        kind: "NOTE",
        action: "icon",
        icon: "x".repeat(17),
        entries: [{ id: "note-1", version: 2, organizationVersion: 3 }],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("validates canonical folder rows and folder names", () => {
    const folder = {
      kind: "FOLDER" as const,
      id: uuid(1),
      workspaceId: context.workspaceId,
      version: 1,
      archived: false,
      folder: "",
      name: "Papers",
      parentId: "",
      updatedAt: instant,
      updatedBy: "human",
    };
    expect(
      requireCanonicalOrganization(
        folder,
        `FOLDER:${uuid(1)}`,
        context.workspaceId,
        1,
      ),
    ).toEqual(folder);
    expect(() =>
      requireCanonicalOrganization(
        { ...folder, folderId: uuid(2) },
        `FOLDER:${uuid(1)}`,
        context.workspaceId,
        1,
      ),
    ).toThrow(DomainError);
    expect(() =>
      requireCanonicalOrganization(
        { ...folder, name: " bad " },
        `FOLDER:${uuid(1)}`,
        context.workspaceId,
        1,
      ),
    ).toThrow(DomainError);
    expect(() => requireFolderName("  ")).toThrow(DomainError);
    expect(requireFolderName("  Nested  ")).toBe("Nested");
    expect(
      requireCanonicalOrganization(
        { ...folder, icon: "🧪" },
        `FOLDER:${uuid(1)}`,
        context.workspaceId,
        1,
      ),
    ).toMatchObject({ icon: "🧪" });
    expect(() =>
      requireCanonicalOrganization(
        { ...folder, icon: "x".repeat(17) },
        `FOLDER:${uuid(1)}`,
        context.workspaceId,
        1,
      ),
    ).toThrow(DomainError);
    const noteRow = {
      kind: "NOTE" as const,
      id: "note-1",
      workspaceId: context.workspaceId,
      version: 1,
      archived: false,
      folder: "",
      folderId: "",
      icon: "📚",
      updatedAt: instant,
      updatedBy: "human",
    };
    expect(
      requireCanonicalOrganization(
        noteRow,
        "NOTE:note-1",
        context.workspaceId,
        1,
      ),
    ).toMatchObject({ icon: "📚" });
    expect(() =>
      requireCanonicalOrganization(
        { ...folder, kind: "WORK", name: undefined, icon: "📚" },
        `WORK:${uuid(1)}`,
        context.workspaceId,
        1,
      ),
    ).toThrow(DomainError);
  });
});
