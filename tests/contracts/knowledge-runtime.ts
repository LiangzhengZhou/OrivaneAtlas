import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import {
  AgentSessionService,
  type AgentSessionStore,
  LibraryService,
  type LibraryStore,
  ProjectService,
  type ProjectStore,
  RetrievalService,
  resolveProjectKnowledgeScope,
  scopedKnowledgeDocuments,
  type UnitOfWork,
  WorkService,
} from "../../packages/application/src/index";

export async function knowledgeRuntimeScenario(
  uow: UnitOfWork,
  library: LibraryStore,
  materials: ProjectStore,
  sessions?: AgentSessionStore,
) {
  const actor = { workspaceId: "workspace-a", principalId: "human" };
  const authorization = { require: async () => {} };
  const clock = { now: () => "2026-10-01T00:00:00.000Z" };
  const ids = { next: randomUUID };
  const work = new WorkService(uow, authorization, clock, ids);
  const documents = new LibraryService(library, authorization, clock, ids);
  const projects = new ProjectService(
    uow,
    materials,
    library,
    authorization,
    clock,
    ids,
  );
  const parent = await work.create(actor, { type: "PROJECT", title: "Parent" });
  const project = await work.create(actor, {
    type: "PROJECT",
    title: "Project A",
    parentProjectId: parent.id,
  });
  const inherited = await projects.createProjectSpace(actor, {
    projectId: parent.id,
    title: "Inherited",
    inheritToChildren: true,
  });
  const primary = await projects.createProjectSpace(actor, {
    projectId: project.id,
    title: "Primary",
    role: "PRIMARY",
  });
  const secondary = await projects.createProjectSpace(actor, {
    projectId: project.id,
    title: "Secondary",
    role: "SUPPORTING",
  });
  const linkedSpace = await documents.save(actor, null, 0, {
    kind: "SPACE",
    spaceId: null,
    title: "Linked",
    bodyMd: "",
  });
  await projects.linkProjectSpace(actor, {
    projectId: project.id,
    spaceId: linkedSpace.id,
  });
  const fallback = await documents.save(actor, null, 0, {
    kind: "SPACE",
    spaceId: null,
    title: "Unrelated",
    bodyMd: "",
  });
  const bindings = await projects.listProjectSpaces(actor, project.id, true);
  const spaces = [
    primary.spaceId,
    secondary.spaceId,
    linkedSpace.id,
    inherited.spaceId,
    fallback.id,
  ];
  const saved = [];
  for (const spaceId of spaces)
    saved.push(
      await documents.save(actor, null, 0, {
        kind: "DOCUMENT",
        spaceId,
        title: `Storage ${saved.length}`,
        bodyMd: "storage knowledge",
        aliases: [`Alias ${saved.length}`],
      }),
    );
  const scope = resolveProjectKnowledgeScope({
    workspaceId: actor.workspaceId,
    projectId: project.id,
    bindings,
    library: await library.list(),
    workspaceFallback: true,
  });
  expect(scope.spaceIds).toEqual(spaces);
  expect(
    scopedKnowledgeDocuments({
      ...(await work.snapshot(actor)),
      projectId: project.id,
      workspaceId: actor.workspaceId,
      projectMaterials: await materials.list(),
      library: await library.list(),
      workspaceFallback: true,
    }).map((entry) => entry.id),
  ).toEqual(scope.documentIds);
  const retrieved = await new RetrievalService(library, authorization).search(
    actor,
    "storage",
    scope,
    await library.wikiLinks!(),
  );
  expect(retrieved.map((result) => result.document.id)).toEqual(
    saved.map((document) => document.id),
  );
  const root = saved[0]!;
  const child = await documents.save(actor, null, 0, {
    kind: "DOCUMENT",
    spaceId: root.spaceId,
    parentDocumentId: root.id,
    title: "Child",
    bodyMd: "[[Alias 0]] [[Future]]",
  });
  expect(
    (await library.wikiLinks!()).find((link) => link.targetText === "Alias 0")
      ?.targetDocumentId,
  ).toBe(root.id);
  const renamed = await documents.save(actor, root.id, root.version, {
    ...root,
    title: "Renamed",
  });
  const source = await documents.save(actor, null, 0, {
    kind: "DOCUMENT",
    spaceId: root.spaceId,
    title: "Source",
    bodyMd: "[[Storage 0]]",
  });
  expect(
    (await library.wikiLinks!()).find(
      (link) => link.sourceDocumentId === source.id,
    )?.targetDocumentId,
  ).toBe(root.id);
  await expect(
    documents.save(actor, root.id, renamed.version, {
      ...renamed,
      parentDocumentId: child.id,
    }),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  await documents.save(actor, child.id, child.version, {
    ...child,
    parentDocumentId: null,
  });
  const deleted = await documents.setDeleted(
    actor,
    root.id,
    renamed.version,
    true,
  );
  expect(
    (await library.wikiLinks!()).filter(
      (link) => link.targetDocumentId === root.id,
    ),
  ).toEqual([]);
  await documents.setDeleted(actor, root.id, deleted.version, false);
  expect(
    (await library.wikiLinks!()).filter(
      (link) => link.targetDocumentId === root.id,
    ),
  ).toHaveLength(2);
  const future = await documents.save(actor, null, 0, {
    kind: "DOCUMENT",
    spaceId: root.spaceId,
    title: "Future",
    bodyMd: "",
  });
  expect(
    (await library.wikiLinks!()).find((link) => link.targetText === "Future")
      ?.targetDocumentId,
  ).toBe(future.id);
  expect(await library.revisions(root.id)).toHaveLength(4);
  const beforeRebuild = (await library.wikiLinks!())
    .map((link) => ({ ...link }))
    .sort((left, right) => left.targetText.localeCompare(right.targetText));
  await documents.rebuildWikiIndex(actor);
  expect(
    (await library.wikiLinks!()).sort((left, right) =>
      left.targetText.localeCompare(right.targetText),
    ),
  ).toEqual(beforeRebuild);
  let sessionId: string | null = null;
  if (sessions) {
    const service = new AgentSessionService(
      sessions,
      authorization,
      clock,
      ids,
    );
    const created = await service.create(actor, "Conversation");
    sessionId = created.id;
    const user = await service.append(actor, created.id, created.version, {
      kind: "USER",
      text: "storage",
      runId: null,
    });
    await service.append(actor, created.id, user.version, {
      kind: "ASSISTANT",
      text: "answer",
      runId: null,
    });
    const restored = await service.get(actor, created.id);
    expect(restored.messages.map((message) => message.kind)).toEqual([
      "USER",
      "ASSISTANT",
    ]);
    await expect(
      service.get({ ...actor, principalId: "other" }, restored.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      service.append(actor, restored.id, user.version, {
        kind: "USER",
        text: "stale",
        runId: null,
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  }
  const nested = await documents.save(actor, null, 0, {
    kind: "DOCUMENT",
    spaceId: root.spaceId,
    title: "Persistent child",
    bodyMd: "[[Alias 0]]",
    parentDocumentId: root.id,
  });
  return { rootId: root.id, childId: nested.id, sessionId };
}

export async function knowledgeRuntimeRoundTrip(
  library: LibraryStore,
  sessions: AgentSessionStore,
  state: Awaited<ReturnType<typeof knowledgeRuntimeScenario>>,
) {
  expect((await library.get(state.childId)).parentDocumentId).toBe(
    state.rootId,
  );
  expect((await library.get(state.rootId)).aliases).toContain("Storage 0");
  expect(
    (await library.wikiLinks!()).find(
      (link) => link.sourceDocumentId === state.childId,
    )?.targetDocumentId,
  ).toBe(state.rootId);
  expect(
    (await sessions.get(state.sessionId!)).messages.map(
      (message) => message.kind,
    ),
  ).toEqual(["USER", "ASSISTANT"]);
  expect(await library.revisions(state.rootId)).toHaveLength(4);
}
