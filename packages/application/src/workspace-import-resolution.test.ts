import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { createWorkspaceImportJournal } from "./workspace-import";
import {
  resolveWorkspaceImportSteps,
  workspaceImportResolutionCandidates,
} from "./workspace-import-resolution";
import { reviewWorkspaceImportSuffix } from "./workspace-import-review";

function memoFixture() {
  const base = fixture();
  const memoId = "2c4fba49-e467-5e4e-b066-453af673ae94";
  const step = {
    id: randomUUID(),
    path: "/api/memo/save",
    payload: {
      version: 0,
      deleted: false,
      input: { targetKind: "TASK", targetId: "entity", bodyMd: "Local memo\n" },
      syncCommand: {
        commandId: randomUUID(),
        deviceId: randomUUID(),
        effects: [
          {
            collection: "entityMemos",
            id: memoId,
            op: "UPSERT",
            baseVersion: 0,
          },
        ],
      },
    },
  };
  const remote = {
    workspaceId: "target",
    collection: "entityMemos",
    id: memoId,
    version: 3,
    value: {
      id: memoId,
      workspaceId: "target",
      ownerPrincipalId: "remote-owner",
      targetKind: "TASK",
      targetId: "entity",
      bodyMd: "Remote memo\n",
      version: 3,
      createdAt: "2026-10-18T00:00:00Z",
      updatedAt: "2026-10-18T00:00:00Z",
      createdBy: "remote-owner",
      updatedBy: "remote-owner",
      deletedAt: null,
    },
  };
  return { journal: { ...base.journal, steps: [step] }, step, remote };
}

test.each(["LOCAL", "REMOTE"] as const)(
  "Memo import %s requires explicit body review and updates the replay CAS together",
  (choice) => {
    const { journal, step, remote } = memoFixture(),
      before = structuredClone(journal);
    expect(reviewWorkspaceImportSuffix(journal, [remote])).toMatchObject([
      { expectedVersion: 0, actualVersion: 3 },
    ]);
    expect(
      workspaceImportResolutionCandidates(journal, [remote])[0]!.fields,
    ).toEqual([
      { field: "bodyMd", local: "Local memo\n", remote: "Remote memo\n" },
    ]);
    const steps = resolveWorkspaceImportSteps(journal, [
      { stepId: step.id, choice, remote },
    ]);
    expect(steps[0]!.payload).toMatchObject({
      version: 3,
      input: {
        targetId: "entity",
        bodyMd: choice === "LOCAL" ? "Local memo\n" : "Remote memo\n",
      },
      syncCommand: {
        effects: [
          {
            collection: "entityMemos",
            id: remote.id,
            op: "UPSERT",
            baseVersion: 3,
          },
        ],
      },
    });
    expect(
      reviewWorkspaceImportSuffix({ ...journal, steps }, [remote]),
    ).toEqual([]);
    expect(
      reviewWorkspaceImportSuffix({ ...journal, steps }, [
        { ...remote, version: 4, value: { ...remote.value, version: 4 } },
      ]),
    ).toMatchObject([{ expectedVersion: 3, actualVersion: 4 }]);
    expect(journal).toEqual(before);
  },
);

test("Memo import review rejects foreign owners and target substitutions", () => {
  const { journal, step, remote } = memoFixture();
  const foreign = {
    ...remote,
    value: {
      ...remote.value,
      ownerPrincipalId: "foreign",
      createdBy: "foreign",
      updatedBy: "foreign",
    },
  };
  expect(() => workspaceImportResolutionCandidates(journal, [foreign])).toThrow(
    "FORBIDDEN",
  );
  expect(() =>
    resolveWorkspaceImportSteps(journal, [
      { stepId: step.id, choice: "LOCAL", remote: foreign },
    ]),
  ).toThrow("FORBIDDEN");
  const changed = {
    ...remote,
    value: { ...remote.value, targetId: "another-target" },
  };
  expect(() => workspaceImportResolutionCandidates(journal, [changed])).toThrow(
    "VERSION_CONFLICT",
  );
  expect(() =>
    resolveWorkspaceImportSteps(journal, [
      { stepId: step.id, choice: "LOCAL", remote: changed },
    ]),
  ).toThrow("VALIDATION_ERROR");
});

function fixture(path = "/api/work/update") {
  const backup = {
    id: randomUUID(),
    sourceWorkspaceId: "source",
    sourcePrincipalId: "owner",
    sourceRevision: 7,
    targetWorkspaceId: "target",
    targetPrincipalId: "remote-owner",
    targetOrigin: "https://example.test",
    targetEpoch: "epoch",
    targetRevision: 12,
    createdAt: "2026-10-15T00:00:00Z",
    sha256: "a".repeat(64),
    bytes: new Blob(["archive"]),
  };
  const step = {
    id: randomUUID(),
    path,
    payload:
      path === "/api/work/update"
        ? {
            id: "entity",
            version: 1,
            input: { status: "TODO", activationState: "INACTIVE" },
          }
        : { id: "entity", version: 1, name: "Local name" },
  };
  const journal = createWorkspaceImportJournal(
    { workspaceId: "source", principalId: "owner" },
    backup,
    randomUUID(),
    [step],
  );
  const remote = {
    workspaceId: "target",
    collection: path === "/api/work/update" ? "items" : "files",
    id: "entity",
    version: 2,
    value: {
      id: "entity",
      version: 2,
      title: "Independent remote title",
      name: "Remote name",
      status: "IN_PROGRESS",
      activationState: "ACTIVE",
      deletedAt: null,
    },
  };
  return { journal, step, remote };
}

test.each(["LOCAL", "REMOTE"] as const)(
  "reviewed Work %s choice preserves independent fields and original evidence",
  (choice) => {
    const { journal, step, remote } = fixture();
    const before = structuredClone(journal);
    const candidates = workspaceImportResolutionCandidates(journal, [remote]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.fields).toHaveLength(2);
    const resolved = resolveWorkspaceImportSteps(journal, [
      { stepId: step.id, choice, remote },
    ]);
    expect(resolved[0]!.payload).toEqual({
      id: "entity",
      version: 2,
      input:
        choice === "LOCAL"
          ? { status: "TODO", activationState: "INACTIVE" }
          : { status: "IN_PROGRESS", activationState: "ACTIVE" },
    });
    expect(journal).toEqual(before);
    expect(remote.value.title).toBe("Independent remote title");
  },
);

test.each(["LOCAL", "REMOTE"] as const)(
  "reviewed File %s choice changes only name at the captured version",
  (choice) => {
    const { journal, step, remote } = fixture("/api/files/rename");
    expect(
      resolveWorkspaceImportSteps(journal, [
        { stepId: step.id, choice, remote },
      ])[0]!.payload,
    ).toEqual({
      id: "entity",
      version: 2,
      name: choice === "LOCAL" ? "Local name" : "Remote name",
    });
  },
);

test("resolution refuses deleted, foreign, missing, duplicate or unsupported structural amendments", () => {
  const { journal, step, remote } = fixture();
  const resolution = { stepId: step.id, choice: "LOCAL" as const, remote };
  expect(() =>
    resolveWorkspaceImportSteps(journal, [
      { ...resolution, remote: { ...remote, workspaceId: "foreign" } },
    ]),
  ).toThrow("FORBIDDEN");
  expect(() =>
    resolveWorkspaceImportSteps(journal, [
      {
        ...resolution,
        remote: {
          ...remote,
          value: { ...remote.value, deletedAt: "2026-10-15" },
        },
      },
    ]),
  ).toThrow("VERSION_CONFLICT");
  expect(() =>
    resolveWorkspaceImportSteps(journal, [resolution, resolution]),
  ).toThrow("VALIDATION_ERROR");
  expect(() =>
    resolveWorkspaceImportSteps(journal, [
      { ...resolution, stepId: randomUUID() },
    ]),
  ).toThrow("VALIDATION_ERROR");
  const structural = {
    ...journal,
    steps: [
      {
        ...step,
        payload: {
          id: "entity",
          version: 1,
          input: { parentProjectId: "another" },
        },
      },
    ],
  };
  expect(() => resolveWorkspaceImportSteps(structural, [resolution])).toThrow(
    "VALIDATION_ERROR",
  );
  expect(workspaceImportResolutionCandidates(structural, [remote])).toEqual([]);
});

test.each(["LOCAL", "REMOTE"] as const)(
  "manual order %s review preserves destination order and appends missing imported members",
  (choice) => {
    const { journal: base } = fixture();
    const step = {
      id: randomUUID(),
      path: "/api/manual-orders/sequence",
      payload: {
        scope: { kind: "WORKSPACE_TASKS" },
        version: 0,
        orderedEntityIds: ["import-b", "import-a"],
      },
    };
    const journal = { ...base, steps: [step] };
    const remote = {
      workspaceId: "target",
      collection: "manualOrders",
      id: "WORKSPACE_TASKS",
      version: 2,
      value: {
        id: "WORKSPACE_TASKS",
        workspaceId: "target",
        scope: { kind: "WORKSPACE_TASKS" },
        version: 2,
        updatedAt: "2026-10-15T00:00:00Z",
        updatedBy: "owner",
        entries: ["existing", "import-a"].map((entityId, index) => ({
          entityId,
          workspaceId: "target",
          scopeKey: "WORKSPACE_TASKS",
          position: (index + 1) * 1024,
          version: 1,
          updatedAt: "2026-10-15T00:00:00Z",
          updatedBy: "owner",
        })),
      },
    };
    expect(workspaceImportResolutionCandidates(journal, [remote])).toHaveLength(
      1,
    );
    expect(
      resolveWorkspaceImportSteps(journal, [
        { stepId: step.id, choice, remote },
      ])[0]!.payload,
    ).toEqual({
      scope: { kind: "WORKSPACE_TASKS" },
      version: 2,
      orderedEntityIds:
        choice === "LOCAL"
          ? ["import-b", "import-a"]
          : ["existing", "import-a", "import-b"],
    });
    expect(step.payload.version).toBe(0);
  },
);

test("review carries a resolved Work version into later organization without changing archive intent", () => {
  const { journal: base, step, remote } = fixture();
  const organize = {
    id: randomUUID(),
    path: "/api/organize",
    payload: {
      kind: "WORK",
      entries: [{ id: "entity", version: 2, organizationVersion: 0 }],
      archived: true,
      folder: "Source folder",
      tags: ["kept"],
    },
  };
  const journal = { ...base, steps: [...base.steps, organize] };
  const steps = resolveWorkspaceImportSteps(journal, [
    { stepId: step.id, choice: "REMOTE", remote },
  ]);
  expect(steps[1]!.payload).toEqual({
    ...organize.payload,
    entries: [{ id: "entity", version: 3, organizationVersion: 0 }],
  });
  expect(reviewWorkspaceImportSuffix({ ...journal, steps }, [remote])).toEqual(
    [],
  );
  expect(organize.payload.entries[0]!.version).toBe(2);
});
