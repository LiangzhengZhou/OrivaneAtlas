import { randomUUID } from "node:crypto";
import {
  FileService,
  LibraryService,
  ProjectService,
  WorkReplayUnitOfWork,
  WorkService,
} from "@arclattice/application";
import { expect, it } from "vitest";
import { context, service, sqliteHarness } from "./testing";

const harness = sqliteHarness();
const clock = { now: () => "2026-11-06T00:00:00.000Z" };
const ids = { next: randomUUID };
const authorization = { require: async () => {} };

it("archives and restores atomically with events while preserving owned Markdown and versions", async () => {
  const db = await harness.create();
  const work = service(db);
  const project = await work.create(context, {
    type: "PROJECT",
    title: "Archive",
  });
  const document = await db.request(
    context,
    null,
    async (uow, _notes, _connected, library, _organization, projects) => {
      const materials = new ProjectService(
        uow,
        projects,
        library,
        authorization,
        clock,
        ids,
      );
      const space = await materials.createProjectSpace(context, {
        projectId: project.id,
        title: "Owned",
      });
      return materials.createProjectDocument(context, {
        projectId: project.id,
        spaceId: space.spaceId,
        title: "Markdown",
        bodyMd: "# 原文\r\n- [ ] untouched",
      });
    },
  );
  const before = await db.inspectEvents(context.workspaceId);
  const archived = await work.update(context, project.id, project.version, {
    archived: true,
  });
  expect(archived.archivedAt).toBeTruthy();
  expect(archived.deletedAt).toBeNull();
  expect(JSON.parse(archived.archiveBatchJson!).entries).toHaveLength(4);
  expect(archived.lifecycle).toBe(project.lifecycle);
  await expect(
    work.update(context, project.id, project.version, { archived: false }),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  const events = await db.inspectEvents(context.workspaceId);
  expect(events.activity.length).toBe(before.activity.length + 1);
  expect(events.outbox.length).toBe(before.outbox.length + 1);
  const restored = await work.update(context, project.id, archived.version, {
    archived: false,
  });
  expect(restored.archivedAt).toBeNull();
  await db.request(context, null, async (_uow, _notes, _connected, library) => {
    const current = await library.get(document.id);
    expect(current.bodyMd).toBe("# 原文\r\n- [ ] untouched");
    expect(current.version).toBe(document.version + 2);
    expect(current.deletedAt).toBeNull();
  });
  const snapshot = await work.snapshot(context);
  const beforeFailure = await db.inspectEvents(context.workspaceId);
  await expect(
    db.request(context, null, async (uow) => {
      await new WorkService(uow, authorization, clock, ids).update(
        context,
        project.id,
        restored.version,
        { archived: true },
      );
      throw new Error("rollback after archive");
    }),
  ).rejects.toThrow("rollback after archive");
  expect(await work.snapshot(context)).toEqual(snapshot);
  expect(await db.inspectEvents(context.workspaceId)).toEqual(beforeFailure);
  await expect(
    work.update(context, project.id, restored.version, {
      archived: "true" as unknown as boolean,
    }),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  const task = await work.create(context, { type: "TASK", title: "Task" });
  await expect(
    work.update(context, task.id, task.version, { archived: true }),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
});

it("preserves linked spaces, prior trash and later independent deletion during batch recovery", async () => {
  const db = await harness.create();
  const work = service(db);
  const project = await work.create(context, {
    type: "PROJECT",
    title: "Recovery",
  });
  const resources = await db.request(
    context,
    null,
    async (uow, _notes, _connected, library, _organization, projects) => {
      const ps = new ProjectService(
        uow,
        projects,
        library,
        authorization,
        clock,
        ids,
      );
      const ls = new LibraryService(library, authorization, clock, ids);
      const owned = await ps.createProjectSpace(context, {
        projectId: project.id,
        title: "Owned",
      });
      const prior = await ps.createProjectDocument(context, {
        projectId: project.id,
        spaceId: owned.spaceId,
        title: "Prior trash",
        bodyMd: "prior",
      });
      await ls.setDeleted(context, prior.id, prior.version, true);
      const later = await ps.createProjectDocument(context, {
        projectId: project.id,
        spaceId: owned.spaceId,
        title: "Later trash",
        bodyMd: "later",
      });
      const linked = await ls.save(context, null, 0, {
        kind: "SPACE",
        spaceId: null,
        title: "External",
        bodyMd: "external",
      });
      await ps.linkProjectSpace(context, {
        projectId: project.id,
        spaceId: linked.id,
      });
      return { owned, prior, later, linked };
    },
  );
  const archived = await work.update(context, project.id, project.version, {
    archived: true,
  });
  // A separate lifecycle decision after archive must not be reversed by recovery.
  await db.request(context, null, async (_uow, _notes, _connected, library) => {
    const later = await library.get(resources.later.id);
    await library.save({ ...later, version: later.version + 1 }, later.version);
  });
  await work.update(context, project.id, archived.version, { archived: false });
  await db.request(context, null, async (_uow, _notes, _connected, library) => {
    expect((await library.get(resources.prior.id)).deletedAt).not.toBeNull();
    expect((await library.get(resources.later.id)).deletedAt).not.toBeNull();
    expect((await library.get(resources.owned.spaceId)).deletedAt).toBeNull();
    expect(await library.get(resources.linked.id)).toEqual(resources.linked);
  });
});

it("rejects an incomplete archive replay effect list without committing any resource", async () => {
  const db = await harness.create();
  const work = service(db);
  const project = await work.create(context, {
    type: "PROJECT",
    title: "Guard",
  });
  const space = await db.request(
    context,
    null,
    (uow, _notes, _connected, library, _organization, projects) =>
      new ProjectService(
        uow,
        projects,
        library,
        authorization,
        clock,
        ids,
      ).createProjectSpace(context, { projectId: project.id, title: "Owned" }),
  );
  const guard = new WorkReplayUnitOfWork(db, context.workspaceId, [
    {
      collection: "items",
      id: project.id,
      op: "UPSERT",
      baseVersion: project.version,
    },
  ]);
  await expect(
    new WorkService(guard, authorization, clock, ids).update(
      context,
      project.id,
      project.version,
      { archived: true },
    ),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  expect(
    (await work.snapshot(context)).items.find(
      (entry) => entry.id === project.id,
    )?.archivedAt,
  ).toBeNull();
  await db.request(context, null, async (_uow, _notes, _connected, library) => {
    expect((await library.get(space.spaceId)).deletedAt).toBeNull();
  });
});

it("archives owned-space files without changing bytes and restores them from the same batch", async () => {
  const db = await harness.create();
  const work = service(db);
  const project = await work.create(context, {
    type: "PROJECT",
    title: "Files",
  });
  const file = await db.request(
    context,
    null,
    async (
      uow,
      _notes,
      _connected,
      library,
      _organization,
      projects,
      _sessions,
      files,
      blobs,
    ) => {
      const space = await new ProjectService(
        uow,
        projects,
        library,
        authorization,
        clock,
        ids,
      ).createProjectSpace(context, { projectId: project.id, title: "Owned" });
      return new FileService(
        files,
        library,
        blobs,
        authorization,
        clock,
        ids,
      ).upload(
        context,
        {
          name: "Original.bin",
          mime: "application/octet-stream",
          spaceId: space.spaceId,
        },
        new Blob([new Uint8Array([0, 128, 255])]),
      );
    },
  );
  const archived = await work.update(context, project.id, project.version, {
    archived: true,
  });
  await db.request(
    context,
    null,
    async (
      _uow,
      _notes,
      _connected,
      _library,
      _organization,
      _projects,
      _sessions,
      files,
    ) => {
      expect((await files.get(file.id)).deletedAt).not.toBeNull();
    },
  );
  await work.update(context, project.id, archived.version, { archived: false });
  await db.request(
    context,
    null,
    async (
      _uow,
      _notes,
      _connected,
      library,
      _organization,
      _projects,
      _sessions,
      files,
      blobs,
    ) => {
      const restored = await files.get(file.id);
      expect(restored.deletedAt).toBeNull();
      expect(restored.contentHash).toBe(file.contentHash);
      expect(restored.version).toBe(file.version + 2);
      const bytes = await new FileService(
        files,
        library,
        blobs,
        authorization,
        clock,
        ids,
      ).originalBytes(context, file.id);
      expect([...new Uint8Array(await bytes.arrayBuffer())]).toEqual([
        0, 128, 255,
      ]);
    },
  );
});
