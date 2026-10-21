import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { planWorkspaceImportSteps } from "./workspace-import-steps";
import type { WorkspaceMergeCopy } from "./workspace-merge-materialize";

const identity = {
  sourcePrincipalId: "local-owner",
  targetPrincipalId: "remote-owner",
  deviceId: randomUUID(),
};
const copy = (
  collection: string,
  value: WorkspaceMergeCopy["value"],
  targetId: string = randomUUID(),
): WorkspaceMergeCopy => ({
  collection,
  value,
  targetId,
  sourceId: randomUUID(),
  sourceVersion: 4,
});

test("formal import plans create parents first, keep tasks inactive until dependencies exist and close children before parents", () => {
  const parentId = randomUUID(),
    childId = randomUUID(),
    taskId = randomUUID(),
    edgeId = randomUUID();
  const steps = planWorkspaceImportSteps(
    [
      copy(
        "items",
        {
          type: "PROJECT",
          title: "Child",
          activationState: "INACTIVE",
          activationPolicy: "MANUAL",
          parentProjectId: parentId,
          lifecycle: "COMPLETED",
        },
        childId,
      ),
      copy(
        "items",
        {
          type: "TASK",
          title: "Task",
          projectIds: [childId],
          status: "DONE",
          activationState: "ACTIVE",
          activationPolicy: "MANUAL",
          assigneePrincipalId: "local-owner",
        },
        taskId,
      ),
      copy(
        "items",
        {
          type: "PROJECT",
          title: "Parent",
          activationState: "INACTIVE",
          activationPolicy: "MANUAL",
          parentProjectId: null,
          lifecycle: "COMPLETED",
        },
        parentId,
      ),
      copy(
        "edges",
        { fromId: parentId, toId: taskId, type: "RELATED" },
        edgeId,
      ),
    ],
    identity,
    { next: randomUUID },
  );
  expect(steps.slice(0, 3).map((step) => step.payload)).toEqual([
    expect.objectContaining({
      stableId: parentId,
      activationState: "INACTIVE",
      lifecycle: "PLANNED",
    }),
    expect.objectContaining({ stableId: childId }),
    expect.objectContaining({
      stableId: taskId,
      assigneePrincipalId: "remote-owner",
    }),
  ]);
  expect(steps[3]!.path).toBe("/api/edge/create");
  expect(steps[4]!.payload).toEqual({
    id: taskId,
    version: 1,
    input: {
      status: "DONE",
      activationState: "ACTIVE",
      activationPolicy: "MANUAL",
    },
  });
  expect(steps.slice(-2).map((step) => step.payload)).toEqual([
    { id: childId, version: 1, input: { projectLifecycle: "COMPLETED" } },
    { id: parentId, version: 1, input: { projectLifecycle: "COMPLETED" } },
  ]);
  expect(new Set(steps.map((step) => step.id)).size).toBe(steps.length);
});

test("library plans preserve Markdown and aliases, with Space before nested documents", () => {
  const spaceId = randomUUID(),
    parentId = randomUUID();
  const steps = planWorkspaceImportSteps(
    [
      copy("library", {
        kind: "DOCUMENT",
        title: "Nested",
        bodyMd: "第一行\n第二行\n[[Wiki]]",
        aliases: ["别名"],
        spaceId,
        parentDocumentId: parentId,
      }),
      copy(
        "library",
        {
          kind: "DOCUMENT",
          title: "Parent",
          bodyMd: "",
          spaceId,
          parentDocumentId: null,
        },
        parentId,
      ),
      copy(
        "library",
        { kind: "SPACE", title: "Space", bodyMd: "Description", spaceId: null },
        spaceId,
      ),
    ],
    identity,
    { next: randomUUID },
  );
  expect(steps.map((step) => step.payload)).toEqual([
    expect.objectContaining({ stableId: spaceId }),
    expect.objectContaining({ stableId: parentId }),
    expect.objectContaining({
      input: expect.objectContaining({
        bodyMd: "第一行\n第二行\n[[Wiki]]",
        aliases: ["别名"],
      }),
    }),
  ]);
});

test("owned Spaces use atomic project creation before restoring Markdown and policy", () => {
  const projectId = randomUUID(),
    spaceId = randomUUID(),
    materialId = randomUUID();
  const steps = planWorkspaceImportSteps(
    [
      copy(
        "library",
        {
          kind: "SPACE",
          title: "Owned",
          bodyMd: "Original description\n第二行",
          aliases: [],
          aiPolicy: {
            classification: "PRIVATE",
            processingBoundary: "LOCAL_ONLY",
            aiAccess: "DENY",
          },
          spaceId: null,
        },
        spaceId,
      ),
      copy(
        "projectMaterials",
        {
          kind: "SPACE",
          ownership: "OWNED",
          projectId,
          targetId: spaceId,
          role: "PRIMARY",
          inheritToChildren: true,
        },
        materialId,
      ),
      copy(
        "items",
        {
          type: "PROJECT",
          title: "Owner",
          lifecycle: "ACTIVE",
          activationState: "INACTIVE",
          activationPolicy: "MANUAL",
        },
        projectId,
      ),
    ],
    identity,
    { next: randomUUID },
  );
  expect(steps.map((step) => step.path)).toEqual([
    "/api/work/create",
    "/api/projects/space/create",
    "/api/library/save",
    "/api/work/update",
  ]);
  expect(steps[1]!.payload).toMatchObject({
    projectId,
    stableMaterialId: materialId,
    stableTargetId: spaceId,
    role: "PRIMARY",
    inheritToChildren: true,
    syncCommand: {
      effects: [
        { collection: "projectMaterials", id: materialId, baseVersion: 0 },
        { collection: "library", id: spaceId, baseVersion: 0 },
      ],
    },
  });
  expect(steps[2]!.payload).toMatchObject({
    id: spaceId,
    version: 1,
    input: {
      bodyMd: "Original description\n第二行",
      aliases: [],
      aiPolicy: {
        classification: "PRIVATE",
        processingBoundary: "LOCAL_ONLY",
        aiAccess: "DENY",
      },
    },
  });
  expect(() =>
    planWorkspaceImportSteps(
      [
        copy(
          "projectMaterials",
          { kind: "SPACE", ownership: "OWNED", projectId, targetId: spaceId },
          materialId,
        ),
      ],
      identity,
      { next: randomUUID },
    ),
  ).toThrow("VALIDATION_ERROR");
});

test.each(["OWNED", "LINKED"])(
  "owned Documents wait for their %s Space binding and preserve aliases",
  (ownership) => {
    const projectId = randomUUID(),
      spaceId = randomUUID(),
      docId = randomUUID(),
      materialId = randomUUID();
    const steps = planWorkspaceImportSteps(
      [
        copy(
          "library",
          {
            kind: "DOCUMENT",
            title: "Owned doc",
            bodyMd: "Original\n[[Wiki]]",
            aliases: ["Alias"],
            spaceId,
            parentDocumentId: null,
            provenance: "HUMAN",
          },
          docId,
        ),
        copy(
          "projectMaterials",
          { kind: "DOCUMENT", ownership: "OWNED", projectId, targetId: docId },
          materialId,
        ),
        copy("projectMaterials", {
          kind: "SPACE",
          ownership,
          projectId,
          targetId: spaceId,
          role: "PRIMARY",
        }),
        copy(
          "library",
          {
            kind: "SPACE",
            title: "Space",
            bodyMd: "Description",
            spaceId: null,
          },
          spaceId,
        ),
        copy(
          "items",
          { type: "PROJECT", title: "Owner", lifecycle: "ACTIVE" },
          projectId,
        ),
      ],
      identity,
      { next: randomUUID },
    );
    const bindingIndex = steps.findIndex(
      (step) =>
        step.path ===
        (ownership === "OWNED"
          ? "/api/projects/space/create"
          : "/api/projects/space/link"),
    );
    const docIndex = steps.findIndex(
      (step) => step.path === "/api/projects/document/create",
    );
    expect(bindingIndex).toBeGreaterThanOrEqual(0);
    expect(docIndex).toBeGreaterThan(bindingIndex);
    expect(steps[docIndex]!.payload).toMatchObject({
      projectId,
      spaceId,
      bodyMd: "Original\n[[Wiki]]",
      stableMaterialId: materialId,
      stableTargetId: docId,
    });
    expect(steps[docIndex + 1]!.payload).toMatchObject({
      id: docId,
      version: 1,
      input: { aliases: ["Alias"], parentDocumentId: null },
    });
  },
);

test("linked Document import uses a stable formal material link without changing ownership", () => {
  const projectId = randomUUID(),
    docId = randomUUID(),
    materialId = randomUUID();
  const steps = planWorkspaceImportSteps(
    [
      copy(
        "projectMaterials",
        { kind: "DOCUMENT", ownership: "LINKED", projectId, targetId: docId },
        materialId,
      ),
    ],
    identity,
    { next: randomUUID },
  );
  expect(steps).toHaveLength(1);
  expect(steps[0]!.path).toBe("/api/projects/link");
  expect(steps[0]!.payload).toMatchObject({
    projectId,
    targetId: docId,
    stableMaterialId: materialId,
    syncCommand: {
      commandId: steps[0]!.id,
      effects: [
        { collection: "projectMaterials", id: materialId, baseVersion: 0 },
      ],
    },
  });
});

test("file import registers the original name and verified hash before a display-only rename", () => {
  const targetId = randomUUID();
  const steps = planWorkspaceImportSteps(
    [
      copy(
        "files",
        {
          originalName: "原件.pdf",
          name: "Reading copy",
          mime: "application/pdf",
          size: 17,
          contentHash: "b".repeat(64),
          spaceId: null,
          parentDocumentId: null,
        },
        targetId,
      ),
    ],
    identity,
    { next: randomUUID },
  );
  expect(steps).toHaveLength(2);
  expect(steps[0]).toMatchObject({
    path: "/api/files/register",
    binary: { contentHash: "b".repeat(64), size: 17, mime: "application/pdf" },
    payload: {
      stableId: targetId,
      name: "原件.pdf",
      contentHash: "b".repeat(64),
    },
  });
  expect(steps[1]).toMatchObject({
    path: "/api/files/rename",
    payload: { id: targetId, version: 1, name: "Reading copy" },
  });
});

test("unsupported data, unhydrated bodies, unresolved original bytes, foreign assignees and cycles fail before execution", () => {
  const id = randomUUID();
  for (const copies of [
    [copy("files", { name: "Original bytes" })],
    [copy("notes", { title: "Unloaded", bodyState: "UNLOADED" })],
    [
      copy("notes", {
        title: "Image",
        bodyMd: "![](/api/library/asset?id=source)",
      }),
    ],
    [copy("items", { title: "Foreign", assigneePrincipalId: "someone-else" })],
    [copy("items", { title: "Cycle", parentProjectId: id }, id)],
  ])
    expect(() =>
      planWorkspaceImportSteps(copies, identity, { next: randomUUID }),
    ).toThrow("VALIDATION_ERROR");
});

test("organization is restored after final Work state with remapped identities and rejects unresolved reused targets", () => {
  const task = randomUUID(),
    note = randomUUID();
  const steps = planWorkspaceImportSteps(
    [
      copy("items", { type: "TASK", title: "Archived", status: "DONE" }, task),
      copy("notes", { kind: "NOTE", title: "Filed", bodyMd: "Original" }, note),
      copy(
        "organization",
        { kind: "WORK", id: task, archived: true, folder: "" },
        "WORK:" + task,
      ),
      copy(
        "organization",
        { kind: "NOTE", id: note, archived: false, folder: "Research" },
        "NOTE:" + note,
      ),
    ],
    identity,
    { next: randomUUID },
  );
  expect(steps.slice(-2).map((step) => step.payload)).toEqual([
    {
      kind: "WORK",
      action: "archive",
      entries: [{ id: task, version: 2, organizationVersion: 0 }],
    },
    {
      kind: "NOTE",
      action: "move",
      folder: "Research",
      entries: [{ id: note, version: 1, organizationVersion: 0 }],
    },
  ]);
  expect(() =>
    planWorkspaceImportSteps(
      [
        copy(
          "organization",
          { kind: "WORK", id: task, archived: true, folder: "" },
          "WORK:" + task,
        ),
      ],
      identity,
      { next: randomUUID },
    ),
  ).toThrow("VALIDATION_ERROR");
});

test("manual-order import uses remapped scope membership and the reviewed destination version", () => {
  const a = randomUUID(),
    b = randomUUID();
  const steps = planWorkspaceImportSteps(
    [
      copy("items", { type: "TASK", title: "A" }, a),
      copy("items", { type: "TASK", title: "B" }, b),
      copy(
        "manualOrders",
        {
          scope: { kind: "WORKSPACE_TASKS" },
          entries: [
            { entityId: a, position: 2048 },
            { entityId: b, position: 1024 },
          ],
        },
        "WORKSPACE_TASKS",
      ),
    ],
    {
      ...identity,
      targetManualOrders: [{ id: "WORKSPACE_TASKS", version: 9 }],
    },
    { next: randomUUID },
  );
  expect(steps.at(-1)).toMatchObject({
    path: "/api/manual-orders/sequence",
    payload: {
      scope: { kind: "WORKSPACE_TASKS" },
      version: 9,
      orderedEntityIds: [b, a],
    },
  });
});
