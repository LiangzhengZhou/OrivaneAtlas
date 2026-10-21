import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { work } from "../../../tests/fixtures";
import { canonicalEntityMemoId } from "./entity-memo-identity";
import { localDto } from "./local-dto";
import { planWorkspaceImportSteps } from "./workspace-import-steps";
import { materializeWorkspaceMemoCopies } from "./workspace-memo-copies";
import { planWorkspaceMergeSelection } from "./workspace-merge-selection";

const identity = {
  forTarget: (
    actor: Parameters<typeof canonicalEntityMemoId>[0],
    target: Parameters<typeof canonicalEntityMemoId>[1],
  ) =>
    canonicalEntityMemoId(actor, target, async (bytes) =>
      createHash("sha1").update(bytes).digest(),
    ),
};
async function fixture() {
  const actor = { workspaceId: randomUUID(), principalId: randomUUID() },
    remoteActor = { workspaceId: randomUUID(), principalId: randomUUID() };
  const task = work(randomUUID(), actor.workspaceId);
  const target = { targetKind: "TASK" as const, targetId: task.id };
  const memo = {
    ...target,
    id: await identity.forTarget(actor, target),
    workspaceId: actor.workspaceId,
    ownerPrincipalId: actor.principalId,
    bodyMd: "  私人原文\n[[do not rewrite prose]]\n",
    version: 2,
    createdAt: "2026-10-16T00:00:00Z",
    updatedAt: "2026-10-16T00:00:00Z",
    createdBy: actor.principalId,
    updatedBy: actor.principalId,
    deletedAt: null,
  };
  const source = {
    workspaceId: actor.workspaceId,
    revision: 3,
    records: [
      {
        workspaceId: actor.workspaceId,
        collection: "items",
        id: task.id,
        version: task.version,
        value: localDto(task),
      },
      {
        workspaceId: actor.workspaceId,
        collection: "entityMemos",
        id: memo.id,
        version: memo.version,
        value: localDto(memo),
      },
    ],
  };
  const remote = {
    workspaceId: remoteActor.workspaceId,
    revision: 0,
    records: [],
  };
  const choices = source.records.map((row) => ({
    collection: row.collection,
    sourceId: row.id,
    action: "COPY" as const,
  }));
  const plan = planWorkspaceMergeSelection(actor, source, remote, choices, {
    next: randomUUID,
  });
  return { actor, remoteActor, task, memo, source, remote, choices, plan };
}

test("explicit Memo import maps the target first and derives the destination owner's identity without rewriting Markdown", async () => {
  const f = await fixture(),
    before = structuredClone(f.source);
  const result = await materializeWorkspaceMemoCopies(
    f.source,
    f.plan,
    f.remoteActor,
    identity,
  );
  const taskCopy = result.copies.find((copy) => copy.collection === "items")!;
  const memoCopy = result.copies.find(
    (copy) => copy.collection === "entityMemos",
  )!;
  const id = await identity.forTarget(f.remoteActor, {
    targetKind: "TASK",
    targetId: taskCopy.targetId,
  });
  expect(memoCopy).toMatchObject({
    sourceId: f.memo.id,
    targetId: id,
    value: { id, targetId: taskCopy.targetId, bodyMd: f.memo.bodyMd },
  });
  expect(
    result.selection.mappings.find(
      (mapping) => mapping.collection === "entityMemos",
    )!.targetId,
  ).toBe(id);
  const steps = planWorkspaceImportSteps(
    result.copies,
    {
      sourcePrincipalId: f.actor.principalId,
      targetPrincipalId: f.remoteActor.principalId,
      deviceId: randomUUID(),
    },
    { next: randomUUID },
  );
  const memo = steps.find((step) => step.path === "/api/memo/save")!;
  expect(steps.indexOf(memo)).toBeGreaterThan(
    steps.findIndex((step) => step.path === "/api/work/create"),
  );
  expect(memo.payload).toMatchObject({
    version: 0,
    input: {
      targetKind: "TASK",
      targetId: taskCopy.targetId,
      bodyMd: f.memo.bodyMd,
    },
    syncCommand: {
      commandId: memo.id,
      effects: [
        { collection: "entityMemos", id, baseVersion: 0, op: "UPSERT" },
      ],
    },
  });
  expect(memo.payload).not.toHaveProperty("ownerPrincipalId");
  expect(memo.payload).not.toHaveProperty("stableId");
  expect(f.source).toEqual(before);
});

test("Memo copy refuses foreign owner, wrong destination workspace and an omitted target mapping", async () => {
  const f = await fixture();
  await expect(
    materializeWorkspaceMemoCopies(
      f.source,
      f.plan,
      { ...f.remoteActor, workspaceId: randomUUID() },
      identity,
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  const foreign = structuredClone(f.source);
  foreign.records[1]!.value = localDto({
    ...f.memo,
    ownerPrincipalId: "foreign",
    createdBy: "foreign",
    updatedBy: "foreign",
  });
  await expect(
    materializeWorkspaceMemoCopies(foreign, f.plan, f.remoteActor, identity),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(() =>
    planWorkspaceMergeSelection(
      f.actor,
      f.source,
      f.remote,
      [
        { collection: "items", sourceId: f.task.id, action: "SKIP" },
        f.choices[1]!,
      ],
      { next: randomUUID },
    ),
  ).toThrowError("VALIDATION_ERROR");
});
