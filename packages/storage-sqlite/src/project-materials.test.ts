import { randomUUID } from "node:crypto";
import { ProjectService } from "@arclattice/application";
import { describe, expect, it } from "vitest";
import { restoreDatabase } from "./index";
import { context, service, sqliteHarness } from "./testing";

const harness = sqliteHarness();
const authorization = { require: async () => {} };
const clock = { now: () => "2026-09-18T12:00:00.000Z" };
const ids = { next: randomUUID };
describe("project owned materials", () => {
  it("preserves Markdown, ownership, files and events through reopen and enforces CAS", async () => {
    const db = await harness.create();
    const project = await service(db).create(context, {
      type: "PROJECT",
      title: "Research",
    });
    const bodyMd = "# 原文\r\n\n- [ ] never a task 😀";
    const document = await db.request(
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
        ).createDocument(context, {
          projectId: project.id,
          title: "Notes",
          bodyMd,
        }),
    );
    const file = await db.request(
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
        ).upload(context, {
          projectId: project.id,
          name: "data.txt",
          mime: "text/plain",
          base64: "aGVsbG8=",
        }),
    );
    const backupPath = harness.file();
    await db.backup(backupPath);
    const restoredPath = harness.file();
    await restoreDatabase(backupPath, restoredPath);
    const restored = await harness.open(restoredPath);
    await restored.request(
      context,
      null,
      async (_uow, _notes, _connected, _library, _organization, projects) => {
        expect(await projects.file(file.id)).toBe("aGVsbG8=");
      },
    );
    await db.close();
    const reopened = await harness.open(db.filename);
    await reopened.request(
      context,
      null,
      async (uow, _notes, _connected, library, _organization, projects) => {
        expect((await library.get(document.id)).bodyMd).toBe(bodyMd);
        expect(await projects.file(file.id)).toBe("aGVsbG8=");
        expect(await projects.activity(project.id)).toHaveLength(3);
        expect(
          (await uow.run(context.workspaceId, (tx) => tx.list())).filter(
            (item) => item.type === "TASK",
          ),
        ).toHaveLength(0);
      },
    );
    await expect(
      reopened.request(
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
          ).setDeleted(context, file.id, 3, true),
      ),
    ).rejects.toThrow("VERSION_CONFLICT");
    await reopened.request(
      context,
      null,
      async (_uow, _notes, _connected, _library, _organization, projects) => {
        expect((await projects.get(file.id)).deletedAt).toBeNull();
      },
    );
    await expect(
      reopened.request(
        { ...context, workspaceId: "workspace-b" },
        null,
        (_uow, _notes, _connected, _library, _organization, projects) =>
          projects.file(file.id),
      ),
    ).rejects.toThrow("NOT_FOUND");
  });
  it("rolls back document, space, ownership and activity together", async () => {
    const db = await harness.create();
    const project = await service(db).create(context, {
      type: "PROJECT",
      title: "Atomic",
    });
    await expect(
      db.request(
        context,
        null,
        async (uow, _notes, _connected, library, _organization, projects) => {
          await new ProjectService(
            uow,
            projects,
            library,
            authorization,
            clock,
            ids,
          ).createDocument(context, {
            projectId: project.id,
            title: "Transient",
            bodyMd: "content",
          });
          throw new Error("rollback");
        },
      ),
    ).rejects.toThrow("rollback");
    await db.request(
      context,
      null,
      async (_uow, _notes, _connected, library, _organization, projects) => {
        expect(await projects.list()).toEqual([]);
        expect(await projects.activity(project.id)).toEqual([]);
        expect(await library.list()).toEqual([]);
      },
    );
  });
  it("deleting a linked material preserves its source", async () => {
    const db = await harness.create();
    const project = await service(db).create(context, {
      type: "PROJECT",
      title: "Owner",
    });
    const other = await service(db).create(context, {
      type: "PROJECT",
      title: "Linked",
    });
    await db.request(
      context,
      null,
      async (uow, _notes, _connected, library, _organization, projects) => {
        const app = new ProjectService(
          uow,
          projects,
          library,
          authorization,
          clock,
          ids,
        );
        const document = await app.createDocument(context, {
          projectId: project.id,
          title: "Shared",
          bodyMd: "preserved",
        });
        const link = await app.link(context, other.id, document.id);
        await app.setDeleted(context, link.id, 1, true);
        expect((await library.get(document.id)).deletedAt).toBeNull();
        const owned = (await projects.list()).find(
          (entry) =>
            entry.targetId === document.id && entry.ownership === "OWNED",
        )!;
        await app.setDeleted(context, owned.id, 1, true);
        expect((await library.get(document.id)).deletedAt).not.toBeNull();
        await app.setDeleted(context, owned.id, 2, false);
        expect((await library.get(document.id)).bodyMd).toBe("preserved");
      },
    );
  });
});
