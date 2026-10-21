import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import {
  type LibraryStore,
  type NotebookStore,
  ProjectKnowledgeReplayEffects,
  ProjectService,
  type ProjectStore,
  type UnitOfWork,
  WorkService,
} from "../../packages/application/src/index";
import type { ActorContext } from "../../packages/domain/src/index";

export async function stableProjectKnowledgeScenario(
  run: <T>(
    actor: ActorContext,
    operation: (
      uow: UnitOfWork,
      library: LibraryStore,
      projects: ProjectStore,
      notes: NotebookStore,
    ) => Promise<T>,
  ) => Promise<T>,
) {
  const actor = { workspaceId: "workspace-a", principalId: "human" },
    auth = { require: async () => {} },
    clock = { now: () => "2026-10-13T00:00:00Z" },
    ids = { next: randomUUID };
  const project = await run(actor, (uow) =>
    new WorkService(uow, auth, clock, ids).create(actor, {
      type: "PROJECT",
      title: "Stable project knowledge",
    }),
  );
  const materialId = randomUUID(),
    spaceId = randomUUID(),
    documentMaterialId = randomUUID(),
    documentId = randomUUID();
  const app = (
    uow: UnitOfWork,
    library: LibraryStore,
    projects: ProjectStore,
  ) => new ProjectService(uow, projects, library, auth, clock, ids);
  const materialEffect = {
    collection: "projectMaterials" as const,
    id: materialId,
    op: "UPSERT" as const,
    baseVersion: 0,
  };
  await expect(
    run(actor, (uow, library, projects, notes) =>
      new ProjectKnowledgeReplayEffects(actor.workspaceId, actor.principalId, [
        materialEffect,
      ]).run(
        notes,
        library,
        projects,
        (_notes, guardedLibrary, guardedProjects) =>
          app(
            uow,
            guardedLibrary,
            guardedProjects,
          ).createProjectSpaceWithStableIds(actor, materialId, spaceId, {
            projectId: project.id,
            title: "Stable space",
          }),
      ),
    ),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  expect(
    await run(actor, (_uow, _library, projects) => projects.list()),
  ).toEqual([]);
  const binding = await run(actor, async (uow, library, projects, notes) => {
    const guard = new ProjectKnowledgeReplayEffects(
      actor.workspaceId,
      actor.principalId,
      [
        materialEffect,
        { collection: "library", id: spaceId, op: "UPSERT", baseVersion: 0 },
      ],
    );
    const binding = await guard.run(
      notes,
      library,
      projects,
      (_notes, guardedLibrary, guardedProjects) =>
        app(
          uow,
          guardedLibrary,
          guardedProjects,
        ).createProjectSpaceWithStableIds(actor, materialId, spaceId, {
          projectId: project.id,
          title: "Stable space",
        }),
    );
    expect(guard.acceptedEffects).toHaveLength(2);
    return binding;
  });
  expect(binding).toMatchObject({
    id: materialId,
    spaceId,
    projectId: project.id,
    version: 1,
  });
  await expect(
    run(actor, (uow, library, projects) =>
      app(uow, library, projects).createProjectSpaceWithStableIds(
        actor,
        materialId,
        randomUUID(),
        { projectId: project.id, title: "Duplicate" },
      ),
    ),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  await expect(
    run(actor, (uow, library, projects) =>
      app(uow, library, projects).createProjectSpaceWithStableIds(
        actor,
        randomUUID(),
        spaceId,
        { projectId: project.id, title: "Duplicate target" },
      ),
    ),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  const bodyMd = "# Original\r\n\n[[Stable space]]\n正文 😀";
  const document = await run(actor, (uow, library, projects) =>
    app(uow, library, projects).createProjectDocumentWithStableIds(
      actor,
      documentMaterialId,
      documentId,
      { projectId: project.id, spaceId, title: "Stable document", bodyMd },
    ),
  );
  expect(document).toMatchObject({
    id: documentId,
    bodyMd,
    version: 1,
    spaceId,
  });
  const linked = await run(actor, (_uow, _library, projects) =>
    projects.get(documentMaterialId),
  );
  expect(linked).toMatchObject({
    id: documentMaterialId,
    targetId: documentId,
    projectId: project.id,
    ownership: "OWNED",
    version: 1,
  });
  const secondProject = await run(actor, (uow) =>
    new WorkService(uow, auth, clock, ids).create(actor, {
      type: "PROJECT",
      title: "Linked consumer",
    }),
  );
  const linkedMaterialId = randomUUID();
  const linkedDocument = await run(
    actor,
    async (uow, library, projects, notes) => {
      const effects = new ProjectKnowledgeReplayEffects(
        actor.workspaceId,
        actor.principalId,
        [
          {
            collection: "projectMaterials",
            id: linkedMaterialId,
            op: "UPSERT",
            baseVersion: 0,
          },
        ],
      );
      const material = await effects.run(
        notes,
        library,
        projects,
        (_notes, guardedLibrary, guardedProjects) =>
          app(uow, guardedLibrary, guardedProjects).linkWithStableId(
            actor,
            linkedMaterialId,
            secondProject.id,
            documentId,
          ),
      );
      expect(effects.acceptedEffects).toHaveLength(1);
      return material;
    },
  );
  expect(linkedDocument).toMatchObject({
    id: linkedMaterialId,
    projectId: secondProject.id,
    targetId: documentId,
    ownership: "LINKED",
    version: 1,
  });
  await expect(
    run(actor, (uow, library, projects) =>
      app(uow, library, projects).linkWithStableId(
        actor,
        randomUUID(),
        secondProject.id,
        documentId,
      ),
    ),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  expect(
    await run(actor, (_uow, library) => library.get(documentId)),
  ).toMatchObject({ bodyMd, version: 1, deletedAt: null });
  await run(actor, (uow, library, projects) =>
    app(uow, library, projects).setDeleted(actor, linkedMaterialId, 1, true),
  );
  expect(
    await run(actor, (_uow, library) => library.get(documentId)),
  ).toMatchObject({ bodyMd, version: 1, deletedAt: null });
  await run(actor, (uow, library, projects) =>
    app(uow, library, projects).setDeleted(actor, documentMaterialId, 1, true),
  );
  await expect(
    run(actor, (uow, library, projects) =>
      app(uow, library, projects).createProjectDocumentWithStableIds(
        actor,
        documentMaterialId,
        randomUUID(),
        { projectId: project.id, spaceId, title: "Reuse deleted", bodyMd },
      ),
    ),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  expect(
    await run(actor, (_uow, library) => library.get(documentId)),
  ).toMatchObject({ bodyMd, version: 2, deletedAt: expect.any(String) });
  expect(
    await run(actor, (_uow, _library, projects) => projects.list()),
  ).toHaveLength(3);
}
