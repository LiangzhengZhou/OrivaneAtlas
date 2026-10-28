import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import type { LocalEntity } from "./local-persistence";
import { materializeWorkspaceMergeCopies } from "./workspace-merge-materialize";
import { planWorkspaceMergeSelection } from "./workspace-merge-selection";

const actor = { workspaceId: "source", principalId: "owner" };
const record = (
  collection: string,
  id: string,
  value: LocalEntity["value"],
): LocalEntity => ({
  workspaceId: "source",
  collection,
  id,
  version: 2,
  value,
});
const source = {
  workspaceId: "source",
  revision: 7,
  records: [
    record("items", "project", {
      id: "project",
      type: "PROJECT",
      parentProjectId: null,
      descriptionMd: "project task old IDs remain prose",
    }),
    record("items", "task", {
      id: "task",
      type: "TASK",
      projectIds: ["project"],
    }),
    record("organization", "WORK:task", {
      kind: "WORK",
      id: "task",
      archived: true,
    }),
    record("manualOrders", "PROJECT_TASKS:project", {
      scope: { kind: "PROJECT_TASKS", projectId: "project" },
      entries: [{ entityId: "task", scopeKey: "PROJECT_TASKS:project" }],
    }),
  ],
};
const plan = () =>
  planWorkspaceMergeSelection(
    actor,
    source,
    { workspaceId: "target", revision: 4, records: [] },
    source.records.map((row) => ({
      collection: row.collection,
      sourceId: row.id,
      action: "COPY",
    })),
    { next: randomUUID },
  );

test("materializes detached copies with computed IDs and nested references while preserving Markdown and originals", () => {
  const before = structuredClone(source),
    selected = plan(),
    copies = materializeWorkspaceMergeCopies(source, selected);
  const target = (id: string) =>
    selected.mappings.find((entry) => entry.sourceId === id)!.targetId;
  expect(
    copies.find((entry) => entry.sourceId === "task")!.value,
  ).toMatchObject({ id: target("task"), projectIds: [target("project")] });
  expect(
    copies.find((entry) => entry.collection === "organization"),
  ).toMatchObject({
    targetId: `WORK:${target("task")}`,
    value: { id: target("task"), archived: true },
  });
  expect(
    copies.find((entry) => entry.collection === "manualOrders")!.value,
  ).toMatchObject({
    id: `PROJECT_TASKS:${target("project")}`,
    entries: [
      {
        entityId: target("task"),
        scopeKey: `PROJECT_TASKS:${target("project")}`,
      },
    ],
  });
  expect(copies[0]!.value).toMatchObject({
    descriptionMd: "project task old IDs remain prose",
  });
  expect(source).toEqual(before);
});

test("folder identity, parent links and note membership survive copy materialization", () => {
  const folderA = randomUUID(),
    folderB = randomUUID();
  const folderSource = {
    workspaceId: "source",
    revision: 7,
    records: [
      record("notes", "note", {
        id: "note",
        title: "Filed",
        bodyMd: "Original",
        kind: "NOTE",
      }),
      record("organization", "FOLDER:" + folderA, {
        kind: "FOLDER",
        id: folderA,
        name: "Research",
        parentId: "",
        archived: false,
        folder: "",
        icon: "🧪",
      }),
      record("organization", "FOLDER:" + folderB, {
        kind: "FOLDER",
        id: folderB,
        name: "Papers",
        parentId: folderA,
        archived: false,
        folder: "",
        icon: "📚",
      }),
      record("organization", "NOTE:note", {
        kind: "NOTE",
        id: "note",
        archived: false,
        folder: "",
        folderId: folderB,
        icon: "🔬",
      }),
    ],
  };
  const selected = planWorkspaceMergeSelection(
    actor,
    folderSource,
    { workspaceId: "target", revision: 0, records: [] },
    folderSource.records.map((row) => ({
      collection: row.collection,
      sourceId: row.id,
      action: "COPY",
    })),
    { next: randomUUID },
  );
  const copies = materializeWorkspaceMergeCopies(folderSource, selected);
  const targetFolder = (id: string) =>
    selected.mappings
      .find((entry) => entry.sourceId === "FOLDER:" + id)!
      .targetId.slice("FOLDER:".length);
  const copiedFolderA = copies.find(
    (entry) => entry.sourceId === "FOLDER:" + folderA,
  )!;
  const copiedFolderB = copies.find(
    (entry) => entry.sourceId === "FOLDER:" + folderB,
  )!;
  const copiedNote = copies.find((entry) => entry.sourceId === "NOTE:note")!;
  expect(copiedFolderA.value).toMatchObject({
    kind: "FOLDER",
    id: targetFolder(folderA),
    name: "Research",
    parentId: "",
    icon: "🧪",
  });
  expect(copiedFolderB.value).toMatchObject({
    kind: "FOLDER",
    id: targetFolder(folderB),
    parentId: targetFolder(folderA),
  });
  expect(copiedNote.value).toMatchObject({
    kind: "NOTE",
    id: copies.find((entry) => entry.sourceId === "note")!.targetId,
    folderId: targetFolder(folderB),
    icon: "🔬",
  });
});

test("refuses stale source revisions/versions and foreign or prototype reference paths before producing copies", () => {
  const selected = plan();
  expect(() =>
    materializeWorkspaceMergeCopies({ ...source, revision: 8 }, selected),
  ).toThrow("VERSION_CONFLICT");
  expect(() =>
    materializeWorkspaceMergeCopies(
      {
        ...source,
        records: source.records.map((entry) => ({ ...entry, version: 3 })),
      },
      selected,
    ),
  ).toThrow("VERSION_CONFLICT");
  for (const bad of [
    { ...selected.references[0]!, targetId: "foreign" },
    { ...selected.references[0]!, path: ["__proto__", "polluted"] },
  ])
    expect(() =>
      materializeWorkspaceMergeCopies(source, {
        ...selected,
        references: [bad],
      }),
    ).toThrow("VALIDATION_ERROR");
  expect(Object.prototype).not.toHaveProperty("polluted");
});
