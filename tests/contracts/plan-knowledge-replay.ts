import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import {
  type ApplicationIdPurpose,
  type LibraryStore,
  type NotebookStore,
  PlanKnowledgeReplayEffects,
  PlanReplayUnitOfWork,
  type ProjectStore,
  type UnitOfWork,
  WorkflowService,
} from "../../packages/application/src/index";
import { planDocumentPublisher } from "../../packages/application/src/plan-documents";

export async function planKnowledgeReplayScenario(
  run: <T>(
    operation: (
      uow: UnitOfWork,
      notes: NotebookStore,
      library: LibraryStore,
      projects: ProjectStore,
    ) => Promise<T>,
  ) => Promise<T>,
) {
  const actor = { workspaceId: "workspace-a", principalId: "human" },
    auth = { require: async () => {} },
    clock = { now: () => "2026-10-14T00:00:00Z" };
  const planId = randomUUID(),
    projectId = randomUUID(),
    spaceId = randomUUID(),
    documentId = randomUUID(),
    materialId = randomUUID();
  const ids = () => {
    const queues: Partial<Record<ApplicationIdPurpose, string[]>> = {
      WORKFLOW: [planId],
      WORK: [projectId],
      LIBRARY: [spaceId, documentId],
      PROJECT_MATERIAL: [materialId],
    };
    return {
      next: randomUUID,
      nextFor: (p: ApplicationIdPurpose) => queues[p]?.shift() ?? randomUUID(),
    };
  };
  const manifest = {
    version: 1,
    projects: [{ tempId: "p", title: "Original project", lifecycle: "ACTIVE" }],
    spaces: [{ tempId: "s", title: "Knowledge", descriptionMd: "Context" }],
    documents: [
      {
        tempId: "d",
        title: "Original",
        bodyMd: "第一行\n第二行\n[[Wiki]]",
        spaceTempId: "s",
        projectTempId: "p",
        ownership: "OWNED",
      },
    ],
  };
  const preview = await run(async (uow, _notes, library, projects) => {
    const guard = new PlanReplayUnitOfWork(
        uow,
        actor.workspaceId,
        actor.principalId,
        [{ collection: "workflows", id: planId, op: "UPSERT", baseVersion: 0 }],
      ),
      generator = ids();
    return new WorkflowService(
      guard,
      auth,
      clock,
      generator,
      planDocumentPublisher(guard, projects, library, auth, clock, generator),
    ).preview(actor, null, manifest);
  });
  const knowledgeEffects = [
    {
      collection: "library" as const,
      id: spaceId,
      op: "UPSERT" as const,
      baseVersion: 0,
    },
    {
      collection: "library" as const,
      id: documentId,
      op: "UPSERT" as const,
      baseVersion: 0,
    },
    {
      collection: "projectMaterials" as const,
      id: materialId,
      op: "UPSERT" as const,
      baseVersion: 0,
    },
    {
      collection: "projectMaterials" as const,
      id: materialId,
      op: "UPSERT" as const,
      baseVersion: 1,
    },
  ];
  const publish = (incomplete: boolean) =>
    run(async (uow, notes, library, projects) => {
      const guard = new PlanReplayUnitOfWork(
        uow,
        actor.workspaceId,
        actor.principalId,
        [
          { collection: "items", id: projectId, op: "UPSERT", baseVersion: 0 },
          { collection: "workflows", id: planId, op: "UPSERT", baseVersion: 1 },
        ],
      );
      const knowledge = new PlanKnowledgeReplayEffects(
          actor.workspaceId,
          actor.principalId,
          incomplete ? knowledgeEffects.slice(0, 3) : knowledgeEffects,
        ),
        generator = ids();
      const result = await knowledge.run(
        notes,
        library,
        projects,
        async (_n, l, p) =>
          new WorkflowService(
            guard,
            auth,
            clock,
            generator,
            planDocumentPublisher(guard, p, l, auth, clock, generator),
          ).publish(actor, planId, 1),
      );
      return {
        result,
        effects: [...guard.acceptedEffects, ...knowledge.acceptedEffects],
      };
    });
  await expect(publish(true)).rejects.toThrow("VERSION_CONFLICT");
  await run(async (uow, _notes, library, projects) => {
    await uow.run(actor.workspaceId, async (tx) => {
      expect(await tx.list(true)).toEqual([]);
      expect(await tx.workflows()).toEqual([preview]);
    });
    expect(await library.list()).toEqual([]);
    expect(await projects.list()).toEqual([]);
  });
  const accepted = await publish(false);
  expect(accepted.result).toMatchObject({
    id: planId,
    version: 2,
    payload: {
      published: true,
      result: { p: projectId, s: spaceId, d: documentId },
    },
  });
  expect(accepted.effects).toHaveLength(5);
  expect(accepted.effects.find((e) => e.id === materialId)).toMatchObject({
    version: 2,
    value: { ownership: "OWNED", projectId, targetId: documentId },
  });
  expect(accepted.effects.find((e) => e.id === documentId)).toMatchObject({
    value: { bodyMd: manifest.documents[0]!.bodyMd, provenance: "HUMAN" },
  });
}
