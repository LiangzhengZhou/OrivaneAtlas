import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { WorkflowService } from "@arclattice/application";
import { restoreDatabase } from "@arclattice/storage-sqlite";
import { expect, test } from "vitest";
import { snapshotToNewFile } from "../../storage-sqlite/src/database";
import { context, sqliteHarness } from "../../storage-sqlite/src/testing";
import { planDocumentPublisher } from "./plan-documents";

const harness = sqliteHarness();
const auth = { require: async () => {} };
const clock = { now: () => "2026-09-18T12:00:00.000Z" };
const ids = { next: randomUUID };

test("external proposal human review preserves documents, provenance and snapshot restore", async () => {
  const file = harness.file();
  const db = await harness.open(file);
  await db.provisionWorkspace({ id: context.workspaceId, name: "Workspace" }, [
    { id: "human", kind: "USER", displayName: "Human" },
    { id: "agent", kind: "AGENT", displayName: "Agent" },
  ]);
  const agent = { ...context, principalId: "agent" };
  const manifest = {
    version: 1,
    projects: [{ tempId: "project", title: "P" }],
    spaces: [{ tempId: "space", title: "Knowledge", descriptionMd: "# Space" }],
    documents: [
      {
        tempId: "owned",
        title: "Owned",
        bodyMd: "# Exact\n\n- [ ] Not a task\n",
        projectTempId: "project",
        ownership: "OWNED",
      },
      {
        tempId: "linked",
        title: "Linked",
        bodyMd: "**Reference**",
        projectTempId: "project",
        spaceTempId: "space",
        ownership: "LINKED",
      },
    ],
  };
  const preview = await db.request(
    agent,
    null,
    (uow, _notes, _connected, library, _organization, projects) =>
      new WorkflowService(
        uow,
        auth,
        clock,
        ids,
        planDocumentPublisher(uow, projects, library, auth, clock, ids),
      ).preview(agent, null, manifest, "EXTERNAL_AI"),
  );
  await expect(
    db.request(context, null, (uow) =>
      new WorkflowService(uow, auth, clock, ids).publish(
        context,
        preview.id,
        preview.version,
      ),
    ),
  ).rejects.toThrow("FORBIDDEN");
  const publish = () =>
    db.request(
      context,
      null,
      (uow, _notes, _connected, library, _organization, projects) =>
        new WorkflowService(
          uow,
          auth,
          clock,
          ids,
          planDocumentPublisher(uow, projects, library, auth, clock, ids),
        ).publish(context, preview.id, preview.version, true),
    );
  const published = await publish();
  expect(await publish()).toEqual(published);
  const inspect = () =>
    db.request(
      context,
      null,
      async (uow, _notes, _connected, library, _organization, projects) => ({
        work: await uow.run(context.workspaceId, (tx) => tx.list()),
        library: await library.list(),
        materials: await projects.list(),
      }),
    );
  const snapshot = await inspect();
  expect(snapshot.work).toHaveLength(1);
  expect(
    snapshot.library.filter((entry) => entry.kind === "DOCUMENT"),
  ).toHaveLength(2);
  expect(
    snapshot.library.find((entry) => entry.title === "Owned"),
  ).toMatchObject({
    bodyMd: manifest.documents[0]!.bodyMd,
    provenance: "EXTERNAL_AI",
  });
  expect(
    snapshot.library.find((entry) => entry.title === "Linked"),
  ).toMatchObject({ provenance: "EXTERNAL_AI" });
  expect(
    snapshot.materials.find((entry) => entry.title === "Owned")?.ownership,
  ).toBe("OWNED");
  expect(
    snapshot.materials.find((entry) => entry.title === "Linked")?.ownership,
  ).toBe("LINKED");
  const backup = harness.file();
  const reader = new DatabaseSync(file);
  try {
    await snapshotToNewFile(reader, backup);
  } finally {
    reader.close();
  }
  const destination = harness.file();
  await restoreDatabase(backup, destination);
  const restored = await harness.open(destination);
  expect(
    await restored.request(
      context,
      null,
      async (uow, _notes, _connected, library, _organization, projects) => ({
        work: await uow.run(context.workspaceId, (tx) => tx.list()),
        library: await library.list(),
        materials: await projects.list(),
      }),
    ),
  ).toEqual(snapshot);
});

test("library changes invalidate external approval and publication cannot cross workspaces", async () => {
  const db = await harness.create();
  const plan = await db.request(
    context,
    null,
    (uow, _notes, _connected, library, _organization, projects) =>
      new WorkflowService(
        uow,
        auth,
        clock,
        ids,
        planDocumentPublisher(uow, projects, library, auth, clock, ids),
      ).preview(context, null, {
        version: 1,
        spaces: [{ tempId: "space", title: "Space" }],
      }),
  );
  await db.request(context, null, async (_uow, _notes, _connected, library) => {
    await library.save(
      {
        id: randomUUID(),
        workspaceId: context.workspaceId,
        kind: "SPACE",
        spaceId: null,
        title: "Concurrent",
        bodyMd: "",
        version: 1,
        createdBy: "human",
        updatedBy: "human",
        createdAt: clock.now(),
        updatedAt: clock.now(),
        deletedAt: null,
        provenance: "HUMAN",
      },
      0,
    );
  });
  await expect(
    db.request(
      context,
      null,
      (uow, _notes, _connected, library, _organization, projects) =>
        new WorkflowService(
          uow,
          auth,
          clock,
          ids,
          planDocumentPublisher(uow, projects, library, auth, clock, ids),
        ).publish(context, plan.id, plan.version, true),
    ),
  ).rejects.toThrow("VERSION_CONFLICT");
  const other = { ...context, workspaceId: "workspace-b" };
  await expect(
    db.request(other, null, (uow) =>
      new WorkflowService(uow, auth, clock, ids).publish(
        other,
        plan.id,
        plan.version,
        true,
      ),
    ),
  ).rejects.toThrow("NOT_FOUND");
});
