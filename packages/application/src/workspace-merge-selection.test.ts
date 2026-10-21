import { expect, test } from "vitest";
import type { LocalEntity } from "./local-persistence";
import { planWorkspaceMergeSelection } from "./workspace-merge-selection";

const actor = { workspaceId: "local", principalId: "owner" };
const uuid = "11111111-1111-4111-8111-111111111111";
const row = (
  workspaceId: string,
  collection: string,
  id: string,
  title = "Same",
): LocalEntity => ({
  workspaceId,
  collection,
  id,
  version: 1,
  value: { type: "TASK", title, projectIds: [] },
});
const local = {
  workspaceId: "local",
  revision: 3,
  records: [row("local", "items", "task"), row("local", "notes", "note")],
};
const remote = {
  workspaceId: "remote",
  revision: 8,
  records: [row("remote", "items", "existing")],
};
const ids = { next: () => uuid };

test("computed organization/order identities and recurrence history retain remapped references", () => {
  const records: LocalEntity[] = [
    {
      ...row("local", "items", "p"),
      value: { type: "PROJECT", title: "P", parentProjectId: null },
    },
    {
      ...row("local", "items", "t"),
      value: { type: "TASK", title: "T", projectIds: ["p"] },
    },
    {
      ...row("local", "organization", "WORK:t"),
      value: { id: "t", kind: "WORK", archived: true, folder: "" },
    },
    {
      ...row("local", "manualOrders", "PROJECT_TASKS:p"),
      value: {
        scope: { kind: "PROJECT_TASKS", projectId: "p" },
        entries: [
          { entityId: "t", scopeKey: "PROJECT_TASKS:p", position: 1024 },
        ],
      },
    },
    {
      ...row("local", "workflows", "series"),
      value: { payload: { kind: "RECURRENCE", projectIds: ["p"] } },
    },
    {
      ...row("local", "workflows", "occurrence"),
      value: {
        payload: {
          kind: "OCCURRENCE",
          definitionId: "series",
          taskId: "t",
          ruleSnapshot: { projectIds: ["p"] },
        },
      },
    },
  ];
  let counter = 0;
  const result = planWorkspaceMergeSelection(
    actor,
    { ...local, records },
    { ...remote, records: [] },
    records.map((entry) => ({
      collection: entry.collection,
      sourceId: entry.id,
      action: "COPY",
    })),
    {
      next: () =>
        `11111111-1111-4111-8111-${String(++counter).padStart(12, "0")}`,
    },
  );
  const destination = (id: string) =>
    result.mappings.find((entry) => entry.sourceId === id)!.targetId;
  expect(destination("WORK:t")).toBe(`WORK:${destination("t")}`);
  expect(destination("PROJECT_TASKS:p")).toBe(
    `PROJECT_TASKS:${destination("p")}`,
  );
  for (const [collection, sourceId, path, targetId] of [
    ["organization", "WORK:t", ["id"], destination("t")],
    [
      "manualOrders",
      "PROJECT_TASKS:p",
      ["entries", 0, "entityId"],
      destination("t"),
    ],
    [
      "manualOrders",
      "PROJECT_TASKS:p",
      ["entries", 0, "scopeKey"],
      destination("PROJECT_TASKS:p"),
    ],
    ["workflows", "series", ["payload", "projectIds", 0], destination("p")],
    [
      "workflows",
      "occurrence",
      ["payload", "definitionId"],
      destination("series"),
    ],
    [
      "workflows",
      "occurrence",
      ["payload", "ruleSnapshot", "projectIds", 0],
      destination("p"),
    ],
  ])
    expect(result.references).toContainEqual({
      collection,
      sourceId,
      path,
      targetId,
    });
  expect(records[2]!.value).toEqual({
    id: "t",
    kind: "WORK",
    archived: true,
    folder: "",
  });
});

test("requires an explicit decision for every source record and preserves original records", () => {
  const before = structuredClone(local);
  const result = planWorkspaceMergeSelection(
    actor,
    local,
    remote,
    [
      {
        collection: "items",
        sourceId: "task",
        action: "USE_REMOTE",
        targetId: "existing",
      },
      { collection: "notes", sourceId: "note", action: "COPY" },
    ],
    ids,
  );
  expect(result.mappings).toEqual([
    {
      collection: "items",
      sourceId: "task",
      sourceVersion: 1,
      action: "USE_REMOTE",
      targetId: "existing",
    },
    {
      collection: "notes",
      sourceId: "note",
      sourceVersion: 1,
      action: "COPY",
      targetId: uuid,
    },
  ]);
  expect(result).toMatchObject({
    localRevision: 3,
    remoteRevision: 8,
    principalId: "owner",
  });
  expect(local).toEqual(before);
  expect(() =>
    planWorkspaceMergeSelection(actor, local, remote, [], ids),
  ).toThrow("VALIDATION_ERROR");
});

test("title matches, missing bodies and IDs in another collection cannot authorize reuse", () => {
  const source = { ...local, records: [row("local", "items", "task")] };
  for (const records of [
    [row("remote", "notes", "existing")],
    [
      {
        ...row("remote", "items", "existing"),
        value: { title: "Same", type: "TASK", projectIds: ["different"] },
      },
    ],
  ])
    expect(() =>
      planWorkspaceMergeSelection(
        actor,
        source,
        { ...remote, records },
        [
          {
            collection: "items",
            sourceId: "task",
            action: "USE_REMOTE",
            targetId: "existing",
          },
        ],
        ids,
      ),
    ).toThrow("VALIDATION_ERROR");
  const document = {
    ...source,
    records: [
      {
        ...row("local", "library", "doc"),
        value: { title: "Draft", bodyMd: "private", kind: "DOCUMENT" },
      },
    ],
  };
  expect(() =>
    planWorkspaceMergeSelection(
      actor,
      document,
      {
        ...remote,
        records: [
          {
            ...row("remote", "library", "r"),
            value: {
              title: "Draft",
              bodyState: "UNLOADED",
              bodyCharacterCount: 7,
              kind: "DOCUMENT",
            },
          },
        ],
      },
      [
        {
          collection: "library",
          sourceId: "doc",
          action: "USE_REMOTE",
          targetId: "r",
        },
      ],
      ids,
    ),
  ).toThrow("VALIDATION_ERROR");
});

test("explicit skipping is recorded while duplicate choices, foreign actors and colliding allocations fail", () => {
  const source = { ...local, records: [row("local", "items", "task")] };
  const skip = {
    collection: "items",
    sourceId: "task",
    action: "SKIP" as const,
  };
  expect(
    planWorkspaceMergeSelection(actor, source, remote, [skip], ids).skipped,
  ).toEqual([{ collection: "items", sourceId: "task", sourceVersion: 1 }]);
  expect(() =>
    planWorkspaceMergeSelection(actor, source, remote, [skip, skip], ids),
  ).toThrow("VALIDATION_ERROR");
  expect(() =>
    planWorkspaceMergeSelection(
      { ...actor, workspaceId: "foreign" },
      source,
      remote,
      [skip],
      ids,
    ),
  ).toThrow("FORBIDDEN");
  expect(() =>
    planWorkspaceMergeSelection(
      actor,
      source,
      { ...remote, records: [row("remote", "items", uuid)] },
      [{ ...skip, action: "COPY" }],
      ids,
    ),
  ).toThrow("VALIDATION_ERROR");
});

test("exact task reuse cannot silently retain a different project after reviewed ID remapping", () => {
  const records = (workspaceId: string) => [
    {
      ...row(workspaceId, "items", "p", "Project"),
      value: { type: "PROJECT", title: "Project", parentProjectId: null },
    },
    {
      ...row(workspaceId, "items", "task"),
      value: { type: "TASK", title: "Same", projectIds: ["p"] },
    },
  ];
  const source = { ...local, records: records("local") },
    destination = { ...remote, records: records("remote") };
  const task = {
    collection: "items",
    sourceId: "task",
    action: "USE_REMOTE" as const,
    targetId: "task",
  };
  expect(() =>
    planWorkspaceMergeSelection(
      actor,
      source,
      destination,
      [{ collection: "items", sourceId: "p", action: "COPY" }, task],
      ids,
    ),
  ).toThrow("VALIDATION_ERROR");
  expect(() =>
    planWorkspaceMergeSelection(
      actor,
      source,
      destination,
      [{ collection: "items", sourceId: "p", action: "SKIP" }, task],
      ids,
    ),
  ).toThrow("VALIDATION_ERROR");
  expect(
    planWorkspaceMergeSelection(
      actor,
      source,
      destination,
      [
        {
          collection: "items",
          sourceId: "p",
          action: "USE_REMOTE",
          targetId: "p",
        },
        task,
      ],
      ids,
    ).mappings,
  ).toHaveLength(2);
});

test("reference plans rewrite dependency endpoints, reminder targets and knowledge links and reject skipped endpoints", () => {
  const records: LocalEntity[] = [
    {
      ...row("local", "items", "project"),
      value: { type: "PROJECT", title: "Parent", parentProjectId: null },
    },
    {
      ...row("local", "items", "task"),
      value: { type: "TASK", title: "Task", projectIds: ["project"] },
    },
    {
      ...row("local", "edges", "edge"),
      value: { fromId: "project", toId: "task", type: "BLOCKS" },
    },
    {
      ...row("local", "reminders", "reminder"),
      value: { linkedTaskId: "task", linkedProjectId: "project" },
    },
    {
      ...row("local", "files", "file"),
      value: { name: "Original", spaceId: null, parentDocumentId: null },
    },
    {
      ...row("local", "links", "link"),
      value: {
        from: { kind: "WORK", id: "task" },
        to: { kind: "FILE", id: "file" },
        relation: "REFERENCES",
      },
    },
  ];
  const choices = records.map((record) => ({
    collection: record.collection,
    sourceId: record.id,
    action: "COPY" as const,
  }));
  let counter = 0;
  const next = {
    next: () =>
      `11111111-1111-4111-8111-${String(++counter).padStart(12, "0")}`,
  };
  const plan = planWorkspaceMergeSelection(
    actor,
    { ...local, records },
    { ...remote, records: [] },
    choices,
    next,
  );
  const task = plan.mappings.find((mapping) => mapping.sourceId === "task")!,
    file = plan.mappings.find((mapping) => mapping.sourceId === "file")!;
  expect(plan.references).toContainEqual({
    collection: "edges",
    sourceId: "edge",
    path: ["toId"],
    targetId: task.targetId,
  });
  expect(plan.references).toContainEqual({
    collection: "reminders",
    sourceId: "reminder",
    path: ["linkedTaskId"],
    targetId: task.targetId,
  });
  expect(plan.references).toContainEqual({
    collection: "links",
    sourceId: "link",
    path: ["to", "id"],
    targetId: file.targetId,
  });
  expect(records[2]!.value).toEqual({
    fromId: "project",
    toId: "task",
    type: "BLOCKS",
  });
  expect(() =>
    planWorkspaceMergeSelection(
      actor,
      { ...local, records },
      { ...remote, records: [] },
      choices.map((choice) =>
        choice.sourceId === "file"
          ? { ...choice, action: "SKIP" as const }
          : choice,
      ),
      next,
    ),
  ).toThrow("VALIDATION_ERROR");
});
