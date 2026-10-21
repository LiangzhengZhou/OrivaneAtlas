import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import type {
  ApplicationIdPurpose,
  UnitOfWork,
} from "../../packages/application/src/index";
import {
  type PlanReplayEffect,
  PlanReplayUnitOfWork,
} from "../../packages/application/src/plan-replay-effects";
import { WorkflowService } from "../../packages/application/src/workflows";

export async function planReplayScenario(uow: UnitOfWork) {
  const actor = { workspaceId: "workspace-a", principalId: "human" },
    auth = { require: async () => {} },
    clock = { now: () => "2026-10-14T00:00:00Z" };
  const planId = randomUUID(),
    projectId = randomUUID(),
    taskA = randomUUID(),
    taskB = randomUUID(),
    categoryId = randomUUID(),
    recurrenceId = randomUUID(),
    edgeId = randomUUID();
  function ids(preview: boolean) {
    const queues: Partial<Record<ApplicationIdPurpose, string[]>> = {
      WORK: [projectId, taskA, taskB],
      WORKFLOW: preview ? [planId] : [recurrenceId],
      CATEGORY: [categoryId],
      EDGE: [edgeId],
    };
    return {
      next: randomUUID,
      nextFor: (purpose: ApplicationIdPurpose) =>
        queues[purpose]?.shift() ?? randomUUID(),
    };
  }
  const manifest = {
    version: 1,
    projects: [{ tempId: "p", title: "Project", lifecycle: "ACTIVE" }],
    tasks: [
      {
        tempId: "a",
        title: "A",
        descriptionMd: "第一行\n第二行",
        dependsOn: [],
        projectTempIds: ["p"],
      },
      { tempId: "b", title: "B", dependsOn: ["a"], projectTempIds: ["p"] },
    ],
    categories: [
      { tempId: "category", name: "Category", projectTempIds: ["p"] },
    ],
    recurrences: [
      {
        tempId: "recurrence",
        title: "Repeat",
        startDate: "2026-10-15",
        timezone: "UTC",
        frequency: "DAILY",
        interval: 1,
        projectTempIds: ["p"],
      },
    ],
  };
  const previewEffects: PlanReplayEffect[] = [
    { collection: "workflows", id: planId, op: "UPSERT", baseVersion: 0 },
  ];
  const previewGuard = new PlanReplayUnitOfWork(
    uow,
    actor.workspaceId,
    actor.principalId,
    previewEffects,
  );
  const preview = await new WorkflowService(
    previewGuard,
    auth,
    clock,
    ids(true),
  ).preview(actor, null, manifest);
  expect(preview.id).toBe(planId);
  expect(previewGuard.acceptedEffects[0]?.value).toEqual(preview);
  const effects: PlanReplayEffect[] = [
    { collection: "items", id: projectId, op: "UPSERT", baseVersion: 0 },
    { collection: "categories", id: categoryId, op: "UPSERT", baseVersion: 0 },
    { collection: "items", id: projectId, op: "UPSERT", baseVersion: 1 },
    { collection: "items", id: taskA, op: "UPSERT", baseVersion: 0 },
    { collection: "items", id: taskB, op: "UPSERT", baseVersion: 0 },
    { collection: "edges", id: edgeId, op: "UPSERT", baseVersion: 0 },
    { collection: "workflows", id: recurrenceId, op: "UPSERT", baseVersion: 0 },
    { collection: "workflows", id: planId, op: "UPSERT", baseVersion: 1 },
  ];
  const incomplete = new PlanReplayUnitOfWork(
    uow,
    actor.workspaceId,
    actor.principalId,
    effects.filter((e) => e.collection !== "edges"),
  );
  await expect(
    new WorkflowService(incomplete, auth, clock, ids(false)).publish(
      actor,
      planId,
      1,
    ),
  ).rejects.toThrow("VERSION_CONFLICT");
  await uow.run(actor.workspaceId, async (tx) => {
    expect(await tx.list(true)).toEqual([]);
    expect(await tx.categories()).toEqual([]);
    expect(await tx.edges()).toEqual([]);
    expect(await tx.workflows()).toEqual([preview]);
  });
  const complete = new PlanReplayUnitOfWork(
    uow,
    actor.workspaceId,
    actor.principalId,
    effects,
  );
  const published = await new WorkflowService(
    complete,
    auth,
    clock,
    ids(false),
  ).publish(actor, planId, 1);
  if (published.payload.kind !== "PLAN") throw new Error("MISSING_PLAN");
  expect(published.payload.result).toEqual({
    p: projectId,
    category: categoryId,
    a: taskA,
    b: taskB,
    recurrence: recurrenceId,
  });
  expect(complete.acceptedEffects).toHaveLength(7);
  expect(
    complete.acceptedEffects.find((e) => e.id === projectId),
  ).toMatchObject({ version: 2 });
  await uow.run(actor.workspaceId, async (tx) => {
    expect((await tx.get(taskA)).descriptionMd).toBe("第一行\n第二行");
    expect((await tx.edges())[0]).toMatchObject({
      id: edgeId,
      fromId: taskA,
      toId: taskB,
    });
    expect((await tx.get(projectId)).categoryId).toBe(categoryId);
  });
}
