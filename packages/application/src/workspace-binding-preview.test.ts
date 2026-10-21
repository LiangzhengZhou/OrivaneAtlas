import { expect, test } from "vitest";
import type { LocalEntity, LocalJson } from "./local-persistence";
import { previewWorkspaceBinding } from "./workspace-binding-preview";

const actor = { workspaceId: "local", principalId: "owner" };
const row = (
  workspaceId: string,
  collection: string,
  id: string,
  value: LocalJson,
): LocalEntity => ({ workspaceId, collection, id, version: 1, value });
const preview = (local: LocalEntity[], remote: LocalEntity[]) =>
  previewWorkspaceBinding(
    actor,
    { workspaceId: "local", revision: 3, records: local },
    { workspaceId: "remote", revision: 9, records: remote },
  );

test("binding review counts and groups semantic duplicates without writing or returning bodies", () => {
  const input = [
    row("local", "items", "a", { type: "TASK", title: "Task", projectIds: [] }),
    row("local", "library", "d", {
      kind: "DOCUMENT",
      title: "Draft",
      spaceId: "s",
      bodyMd: "Private source",
    }),
    row("local", "files", "f", { name: "Original.pdf", contentHash: "hash" }),
  ];
  const before = structuredClone(input);
  const result = preview(input, [
    row("remote", "items", "b", {
      type: "TASK",
      title: "Task",
      projectIds: [],
    }),
    row("remote", "library", "e", {
      kind: "DOCUMENT",
      title: "Draft",
      spaceId: "s",
      bodyState: "UNLOADED",
      bodyCharacterCount: 14,
    }),
    row("remote", "files", "g", {
      name: "Different name.pdf",
      contentHash: "hash",
    }),
  ]);
  expect(result.counts.local).toEqual({
    tasks: 1,
    projects: 0,
    documents: 1,
    notes: 0,
    files: 1,
  });
  expect(result.exactDuplicates).toEqual([
    { collection: "items", localIds: ["a"], remoteIds: ["b"] },
  ]);
  expect(result.documentNameCollisions).toEqual([
    {
      collection: "library",
      key: "s:draft",
      localIds: ["d"],
      remoteIds: ["e"],
    },
  ]);
  expect(result.fileHashDuplicates).toEqual([
    { collection: "files", key: "hash", localIds: ["f"], remoteIds: ["g"] },
  ]);
  expect(JSON.stringify(result)).not.toContain("Private source");
  expect(input).toEqual(before);
  expect(result.localRevision).toBe(3);
  expect(result.remoteRevision).toBe(9);
});

test("identity, membership, hierarchy, aliases and deletions are explicit review issues", () => {
  const result = preview(
    [
      row("local", "items", "p", {
        type: "PROJECT",
        title: "Local",
        parentProjectId: "missing",
      }),
      row("local", "items", "t", {
        type: "TASK",
        title: "Orphan",
        projectIds: ["missing"],
      }),
      row("local", "library", "d", {
        kind: "DOCUMENT",
        title: "Alias",
        aliases: ["Ｏｔｈｅｒ"],
        spaceId: "s",
      }),
      row("local", "items", "deleted", {
        type: "TASK",
        title: "Task",
        deletedAt: "now",
      }),
    ],
    [
      row("remote", "items", "p", {
        type: "PROJECT",
        title: "Remote",
        parentProjectId: null,
      }),
      row("remote", "library", "r", {
        kind: "DOCUMENT",
        title: "Other",
        spaceId: "s",
      }),
    ],
  );
  expect(result.idCollisions).toEqual([
    { id: "p", localCollection: "items", remoteCollection: "items" },
  ]);
  expect(result.projectHierarchyConflicts).toEqual([
    { id: "p", reason: "MISSING_PARENT" },
  ]);
  expect(result.taskMembershipConflicts).toEqual([
    { id: "t", missingProjectIds: ["missing"] },
  ]);
  expect(result.documentNameCollisions[0]!.key).toBe("s:other");
  expect(result.counts.local.tasks).toBe(1);
});

test("foreign actors and cross-workspace record injection fail closed", () => {
  expect(() =>
    previewWorkspaceBinding(
      { ...actor, workspaceId: "foreign" },
      { workspaceId: "local", revision: 1, records: [] },
      { workspaceId: "remote", revision: 1, records: [] },
    ),
  ).toThrow("FORBIDDEN");
  expect(() => preview([row("foreign", "items", "x", {})], [])).toThrow(
    "VALIDATION_ERROR",
  );
});

test("manifest title and size equality never proves exact Markdown equality", () => {
  const result = preview(
    [
      row("local", "notes", "a", {
        kind: "NOTE",
        title: "Same",
        bodyState: "UNLOADED",
        bodyCharacterCount: 5,
      }),
    ],
    [
      row("remote", "notes", "b", {
        kind: "NOTE",
        title: "Same",
        bodyState: "UNLOADED",
        bodyCharacterCount: 5,
      }),
    ],
  );
  expect(result.exactDuplicates).toEqual([]);
  expect(result.possibleDuplicates).toHaveLength(1);
});

test("cycles and repeated records cannot disappear inside preview indexes", () => {
  const a = row("local", "items", "a", {
    type: "PROJECT",
    title: "A",
    parentProjectId: "b",
  });
  const b = row("remote", "items", "b", {
    type: "PROJECT",
    title: "B",
    parentProjectId: "a",
  });
  expect(preview([a], [b]).projectHierarchyConflicts).toEqual([
    { id: "a", reason: "CYCLE" },
    { id: "b", reason: "CYCLE" },
  ]);
  expect(() => preview([a, a], [b])).toThrow("VALIDATION_ERROR");
});

test("duplicate groups retain all identities without a Cartesian row expansion", () => {
  const local = Array.from({ length: 1500 }, (_, i) =>
    row("local", "items", `l${i}`, {
      type: "TASK",
      title: "Same",
      projectIds: [],
    }),
  );
  const remote = Array.from({ length: 1500 }, (_, i) =>
    row("remote", "items", `r${i}`, {
      type: "TASK",
      title: "Same",
      projectIds: [],
    }),
  );
  const result = preview(local, remote);
  expect(result.possibleDuplicates).toHaveLength(1);
  expect(result.exactDuplicates).toHaveLength(1);
  expect(result.exactDuplicates[0]!.localIds).toHaveLength(1500);
  expect(result.exactDuplicates[0]!.remoteIds).toHaveLength(1500);
});

test("binding manifest includes relationship collections and keeps organization composite identities", async () => {
  const { bindingManifestRecords } = await import(
    "./workspace-binding-preview"
  );
  const workspaceId = "remote";
  const records = bindingManifestRecords(workspaceId, {
    schemaVersion: 1,
    cursor: 8,
    epoch: "epoch",
    notes: [],
    library: [],
    workspace: {
      items: [],
      edges: [
        {
          id: "edge",
          workspaceId,
          fromId: "a",
          toId: "b",
          type: "BLOCKS",
          createdBy: "owner",
          createdAt: "2026-10-15T00:00:00Z",
        },
      ],
      organization: ["WORK", "NOTE"].map((kind) => ({
        kind: kind as "WORK" | "NOTE",
        id: "same",
        workspaceId,
        version: 1,
        archived: true,
        folder: "Archive",
        updatedAt: "2026-10-15T00:00:00Z",
        updatedBy: "owner",
      })),
      projectMaterials: [],
      links: [],
      categories: [],
      workflows: [],
      reminders: [],
    },
  });
  expect(
    records.map((record) => [record.collection, record.id, record.version]),
  ).toEqual([
    ["edges", "edge", 1],
    ["organization", "WORK:same", 1],
    ["organization", "NOTE:same", 1],
  ]);
});
