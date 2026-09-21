import { describe, expect, it } from "vitest";
import type {
  UnitOfWork,
  WorkTransaction,
} from "../../packages/application/src/index";
import {
  CategoryService,
  WorkflowService,
  WorkService,
} from "../../packages/application/src/index";
import { isReady } from "../../packages/domain/src/index";
import { edge, work } from "../fixtures";

/** Reuse unchanged for SQLite and PostgreSQL adapters in M1. */
export function repositoryContract(
  name: string,
  create: () => UnitOfWork | Promise<UnitOfWork>,
) {
  describe(`${name} repository contract`, () => {
    function service(uow: UnitOfWork) {
      let sequence = 0;
      const clock = { now: () => "2026-09-17T00:00:00.000Z" };
      return {
        api: new WorkService(uow, { require: async () => {} }, clock, {
          next: () => "activation-" + ++sequence,
        }),
        clock,
      };
    }
    const context = { workspaceId: "workspace-a", principalId: "human" };
    it("validates execution against the resulting atomic prerequisite graph", async () => {
      const uow = await create();
      const { api } = service(uow);
      const source = await api.create(context, { title: "Source" });
      const target = await api.create(context, {
        title: "Target",
        prerequisiteIds: [source.id],
        activationPolicy: "WHEN_DEPENDENCIES_COMPLETED",
      });
      const started = await api.update(context, target.id, target.version, {
        status: "IN_PROGRESS",
        prerequisiteIds: [],
        expectedPrerequisiteIds: [source.id],
      });
      expect(started.status).toBe("IN_PROGRESS");
      expect(started.activationState).toBe("ACTIVE");
      await expect(
        api.update(context, target.id, started.version, {
          prerequisiteIds: [source.id],
          expectedPrerequisiteIds: [],
        }),
      ).rejects.toThrow("WORK_ITEM_BLOCKED");
      expect((await api.snapshot(context)).edges).toHaveLength(0);
    });
    it("persists isolated versioned calendar overrides and gates execution by the effective day", async () => {
      const uow = await create();
      const { api } = service(uow);
      expect((await api.snapshot(context)).calendarTimezone).toBe("UTC");
      const setting = await api.setCalendarSettings(context, 0, "America/Adak");
      expect(setting.version).toBe(1);
      expect((await api.snapshot(context)).calendarTimezone).toBe(
        "America/Adak",
      );
      await expect(api.setCalendarSettings(context, 0, "UTC")).rejects.toThrow(
        "VERSION_CONFLICT",
      );
      await expect(
        api.setCalendarSettings(context, 1, "Invalid/Zone"),
      ).rejects.toThrow("VALIDATION_ERROR");
      const task = await api.create(context, {
        title: "Local tomorrow",
        activationPolicy: "AT_SCHEDULED_TIME",
        startDate: "2026-09-17",
      });
      await expect(
        api.update(context, task.id, task.version, { status: "IN_PROGRESS" }),
      ).rejects.toThrow("WORK_ITEM_BLOCKED");
      await api.setCalendarSettings(context, 1, "Pacific/Kiritimati");
      expect(
        (
          await api.update(context, task.id, task.version, {
            status: "IN_PROGRESS",
          })
        ).status,
      ).toBe("IN_PROGRESS");
      await api.setCalendarSettings(context, 2, null);
      expect((await api.snapshot(context)).calendarTimezone).toBe("UTC");
      expect(
        (await uow.run("workspace-b", (tx) => tx.calendarSettings())).version,
      ).toBe(0);
    });
    it("creates prerequisites atomically and rolls back invalid edges without leaking a task", async () => {
      const uow = await create();
      const { api } = service(uow);
      const source = await api.create(context, { title: "Source" });
      const target = await api.create(context, {
        title: "Target",
        prerequisiteIds: [source.id],
        activationPolicy: "WHEN_DEPENDENCIES_COMPLETED",
      });
      expect(target.activationState).toBe("INACTIVE");
      const before = await api.snapshot(context);
      await expect(
        api.create(context, {
          title: "Bad",
          prerequisiteIds: [source.id, "missing"],
        }),
      ).rejects.toThrow();
      expect(await api.snapshot(context)).toEqual(before);
      await expect(
        api.update(context, target.id, target.version, {
          prerequisiteIds: [source.id, source.id],
        }),
      ).rejects.toThrow("VALIDATION_ERROR");
      const updated = await api.update(context, target.id, target.version, {
        prerequisiteIds: [],
        expectedPrerequisiteIds: [source.id],
      });
      expect(updated.activationState).toBe("ACTIVE");
      expect(
        (await api.snapshot(context)).items.find(
          (item) => item.id === target.id,
        ),
      ).toEqual(updated);
    });
    function workflows(uow: UnitOfWork) {
      let id = 0;
      return new WorkflowService(
        uow,
        { require: async () => {} },
        { now: () => "2026-09-17T12:00:00.000Z" },
        { next: () => "workflow-" + ++id },
      );
    }
    it("plan preview is inert; publication is atomic, bound to revision and idempotent", async () => {
      const uow = await create(),
        { api } = service(uow),
        flow = workflows(uow);
      const project = await api.create(context, {
        title: "Plan",
        type: "PROJECT",
      });
      const manifest = {
        version: 1,
        tasks: [
          { tempId: "__proto__", title: "First" },
          { tempId: "b", title: "Next", dependsOn: ["__proto__"] },
        ],
      };
      const plan = await flow.preview(context, project.id, manifest);
      expect((await api.snapshot(context)).items).toHaveLength(1);
      const published = await flow.publish(context, plan.id, plan.version);
      expect(published.payload.kind).toBe("PLAN");
      expect((await api.snapshot(context)).items).toHaveLength(3);
      expect((await api.snapshot(context)).edges).toHaveLength(1);
      expect(await flow.publish(context, plan.id, plan.version)).toEqual(
        published,
      );
      const stale = await flow.preview(context, project.id, manifest);
      await api.create(context, { title: "Human change" });
      await expect(
        flow.publish(context, stale.id, stale.version),
      ).rejects.toThrow("VERSION_CONFLICT");
      await expect(
        flow.preview(context, project.id, {
          version: 1,
          tasks: [{ tempId: "a", title: "A", dependsOn: ["a"] }],
        }),
      ).rejects.toThrow("WORK_GRAPH_CYCLE_DETECTED");
      await expect(
        flow.publish({ ...context, workspaceId: "workspace-b" }, plan.id, 1),
      ).rejects.toThrow("NOT_FOUND");
    });
    it("failed publication rolls back all tasks, edges and workflow state", async () => {
      const uow = await create(),
        { api } = service(uow),
        flow = workflows(uow);
      const project = await api.create(context, {
        title: "Plan",
        type: "PROJECT",
      });
      const plan = await flow.preview(context, project.id, {
        version: 1,
        tasks: [{ tempId: "a", title: "A" }],
      });
      const failing: UnitOfWork = {
        run: (workspace, operation) =>
          uow.run(workspace, (tx) =>
            operation({
              ...tx,
              saveWorkflow: async () => {
                throw new Error("outbox failed");
              },
            }),
          ),
      };
      await expect(
        workflows(failing).publish(context, plan.id, 1),
      ).rejects.toThrow("outbox failed");
      expect((await api.snapshot(context)).items).toHaveLength(1);
      expect((await flow.list(context))[0]).toEqual(plan);
    });
    it("recurrence records missed dates without tasks; generation and backfill never duplicate", async () => {
      const uow = await create(),
        flow = workflows(uow),
        { api } = service(uow);
      const rule = {
        title: "Daily",
        descriptionMd: "Keep text",
        projectId: null,
        startDate: "2026-09-15",
        timezone: "Asia/Shanghai",
        frequency: "DAILY" as const,
        interval: 1,
      };
      const definition = await flow.saveRecurrence(context, {
        version: 0,
        deleted: false,
        rule,
      });
      const slots = await flow.generate(
        context,
        definition.id,
        1,
        rule.startDate,
        "2026-09-17",
      );
      expect(
        slots.map((s) =>
          s.payload.kind === "OCCURRENCE" ? s.payload.status : null,
        ),
      ).toEqual(["MISSED", "MISSED", "CREATED"]);
      expect((await api.snapshot(context)).items).toHaveLength(1);
      await flow.generate(
        context,
        definition.id,
        1,
        rule.startDate,
        "2026-09-17",
      );
      expect((await api.snapshot(context)).items).toHaveLength(1);
      const filled = await flow.backfill(
        context,
        slots[0]!.id,
        1,
        "2026-09-15T12:00:00.000Z",
      );
      expect(filled.payload).toMatchObject({
        status: "BACKFILLED",
        completedAt: "2026-09-15T12:00:00.000Z",
        backfilledAt: "2026-09-17T12:00:00.000Z",
      });
      expect(
        (await api.snapshot(context)).items.filter((i) => i.status === "DONE"),
      ).toHaveLength(1);
      await expect(
        flow.backfill(context, slots[0]!.id, 1, null),
      ).rejects.toThrow("VERSION_CONFLICT");
      await expect(
        flow.generate(context, definition.id, 1, rule.startDate, "2026-09-18"),
      ).rejects.toThrow("VALIDATION_ERROR");
      await flow.saveRecurrence(context, {
        id: definition.id,
        version: 1,
        deleted: false,
        rule: { ...rule, title: "Changed" },
      });
      const historical = await flow.backfill(context, slots[1]!.id, 1, null);
      expect(historical.payload).toMatchObject({ status: "BACKFILLED" });
      expect(
        (await api.snapshot(context)).items.every(
          (item) => item.title === "Daily",
        ),
      ).toBe(true);
    });
    it("background ticks persist bounded progress, deduplicate and respect pause and creator", async () => {
      const uow = await create(),
        flow = workflows(uow),
        { api } = service(uow);
      const rule = {
        title: "Scheduled",
        descriptionMd: "Original",
        projectId: null,
        startDate: "2025-09-15",
        timezone: "UTC",
        frequency: "DAILY" as const,
        interval: 1,
      };
      const definition = await flow.saveRecurrence(context, {
        version: 0,
        deleted: false,
        rule,
      });
      await expect(
        flow.tick({ ...context, principalId: "other" }, definition.id),
      ).rejects.toThrow("FORBIDDEN");
      expect(await flow.tick(context, definition.id)).toHaveLength(366);
      expect((await api.snapshot(context)).items).toHaveLength(0);
      // New application instance, persisted cursor; competing workers still create today once.
      await Promise.all([
        workflows(uow).tick(context, definition.id),
        flow.tick(context, definition.id),
      ]);
      expect((await api.snapshot(context)).items).toHaveLength(1);
      expect(await flow.tick(context, definition.id)).toEqual([]);
      const current = (await flow.list(context)).find(
        (r) => r.id === definition.id,
      )!;
      expect(current.payload).toMatchObject({ schedulerThrough: "2026-09-17" });
      await flow.saveRecurrence(context, {
        id: current.id,
        version: current.version,
        deleted: true,
        rule,
      });
      expect(await flow.tick(context, definition.id)).toEqual([]);
    });
    it("categories preserve memberships through soft deletion, enforce CAS and reject non-projects", async () => {
      const uow = await create();
      const { api, clock } = service(uow);
      let id = 0;
      const categories = new CategoryService(
        uow,
        { require: async () => {} },
        clock,
        { next: () => "category-" + ++id },
      );
      const project = await api.create(context, {
        title: "Project",
        type: "PROJECT",
      });
      const task = await api.create(context, { title: "Task" });
      const initial = {
        version: 0,
        name: "Research",
        projectIds: [project.id],
        deleted: false,
      };
      const c = await categories.save(context, initial);
      expect((await categories.list(context))[0]).toEqual(c);
      await expect(
        categories.save(context, { ...initial, id: c.id }),
      ).rejects.toThrow("VERSION_CONFLICT");
      await expect(
        categories.save(context, {
          ...initial,
          name: "Invalid",
          projectIds: [task.id],
        }),
      ).rejects.toThrow("VALIDATION_ERROR");
      await expect(
        categories.save(context, { ...initial, name: "research" }),
      ).rejects.toThrow("VALIDATION_ERROR");
      const deleted = await categories.save(context, {
        ...initial,
        id: c.id,
        version: 1,
        deleted: true,
      });
      expect(deleted.deletedAt).not.toBeNull();
      const restored = await categories.save(context, {
        ...initial,
        id: c.id,
        version: 2,
      });
      expect(restored.projectIds).toEqual([project.id]);
      expect(restored.deletedAt).toBeNull();
      await expect(
        categories.save(
          { ...context, workspaceId: "workspace-b" },
          { ...initial, id: c.id, version: 3 },
        ),
      ).rejects.toThrow("NOT_FOUND");
    });
    it("category change failure rolls back entity and membership writes", async () => {
      const uow = await create();
      const { clock } = service(uow);
      const failing: UnitOfWork = {
        run: (workspace, operation) =>
          uow.run(workspace, (tx) =>
            operation({
              ...tx,
              appendCategoryChange: async () => {
                throw new Error("outbox unavailable");
              },
            }),
          ),
      };
      const categories = new CategoryService(
        failing,
        { require: async () => {} },
        clock,
        { next: () => "rollback-category" },
      );
      await expect(
        categories.save(context, {
          version: 0,
          name: "Rollback",
          projectIds: [],
          deleted: false,
        }),
      ).rejects.toThrow("outbox unavailable");
      expect(
        await uow.run(context.workspaceId, (tx) => tx.categories()),
      ).toEqual([]);
    });

    it("project pause and completion respect owned outcomes, not references", async () => {
      const { api } = service(await create());
      let project = await api.create(context, {
        type: "PROJECT",
        title: "Outcome",
      });
      const task = await api.create(context, {
        title: "Work",
        ownerProjectId: project.id,
      });
      await api.create(context, {
        title: "Reference",
        linkedProjectIds: [project.id],
      });
      project = await api.update(context, project.id, project.version, {
        projectLifecycle: "ACTIVE",
      });
      project = await api.update(context, project.id, project.version, {
        projectLifecycle: "PAUSED",
      });
      expect(project).toMatchObject({
        status: "IN_PROGRESS",
        activationState: "INACTIVE",
      });
      await expect(
        api.update(context, project.id, project.version, {
          projectLifecycle: "COMPLETED",
        }),
      ).rejects.toMatchObject({
        code: "PROJECT_HAS_UNFINISHED_WORK",
        params: { unfinished: 1 },
      });
      await api.update(context, task.id, task.version, { status: "CANCELED" });
      project = await api.update(context, project.id, project.version, {
        projectLifecycle: "COMPLETED",
      });
      expect(project.status).toBe("DONE");
      expect(project.completedAt).not.toBe(null);
      project = await api.update(context, project.id, project.version, {
        projectLifecycle: "ACTIVE",
      });
      expect(project.completedAt).toBe(null);
      await expect(
        api.update(context, task.id, 2, { projectLifecycle: "ACTIVE" }),
      ).rejects.toThrow("VALIDATION_ERROR");
      await expect(
        api.update(context, project.id, project.version, {
          projectLifecycle: "ACTIVE",
          status: "TODO",
        }),
      ).rejects.toThrow("VALIDATION_ERROR");
    });
    it("completed ancestors reject introduced unfinished ownership on every write path", async () => {
      const { api } = service(await create());
      let root = await api.create(context, { type: "PROJECT", title: "Root" });
      let child = await api.create(context, {
        type: "PROJECT",
        title: "Child",
        projectId: root.id,
      });
      const hidden = await api.create(context, {
        title: "Deleted",
        ownerProjectId: child.id,
      });
      await api.setDeleted(context, hidden.id, 1, true);
      await expect(
        api.update(context, root.id, 1, { status: "DONE" }),
      ).rejects.toMatchObject({
        code: "PROJECT_HAS_UNFINISHED_WORK",
        params: { unfinishedProjects: 1 },
      });
      child = await api.update(context, child.id, 1, {
        projectLifecycle: "CANCELED",
      });
      root = await api.update(context, root.id, 1, { status: "DONE" });
      await expect(
        api.create(context, { title: "New", ownerProjectId: child.id }),
      ).rejects.toThrow("PROJECT_REOPEN_REQUIRED");
      await expect(
        api.setDeleted(context, hidden.id, 2, false),
      ).rejects.toThrow("PROJECT_REOPEN_REQUIRED");
      await expect(
        api.update(context, child.id, child.version, {
          projectLifecycle: "ACTIVE",
        }),
      ).rejects.toThrow("PROJECT_REOPEN_REQUIRED");
      const outsider = await api.create(context, { title: "Outside" });
      await expect(
        api.update(context, outsider.id, 1, { ownerProjectId: child.id }),
      ).rejects.toThrow("PROJECT_REOPEN_REQUIRED");
      expect(
        (await api.snapshot(context)).items.find((i) => i.id === root.id)
          ?.status,
      ).toBe("DONE");
    });
    it("explicit reopen/create is versioned and rolls back invalid writes", async () => {
      const { api } = service(await create());
      let project = await api.create(context, {
        type: "PROJECT",
        title: "Finished",
      });
      project = await api.update(context, project.id, 1, {
        projectLifecycle: "COMPLETED",
      });
      await expect(
        api.create(context, {
          title: "Invalid",
          ownerProjectId: project.id,
          reopenProjectVersion: project.version,
          startDate: "bad",
        }),
      ).rejects.toThrow("VALIDATION_ERROR");
      expect(
        (await api.snapshot(context)).items.find((i) => i.id === project.id),
      ).toEqual(project);
      await expect(
        api.create(context, {
          title: "Stale",
          ownerProjectId: project.id,
          reopenProjectVersion: 1,
        }),
      ).rejects.toThrow("VERSION_CONFLICT");
      const task = await api.create(context, {
        title: "Next",
        ownerProjectId: project.id,
        reopenProjectVersion: project.version,
      });
      expect(task.projectId).toBe(project.id);
      expect(
        (await api.snapshot(context)).items.find((i) => i.id === project.id),
      ).toMatchObject({
        status: "IN_PROGRESS",
        version: project.version + 1,
        completedAt: null,
      });
      await expect(
        api.create(context, {
          title: "Retry",
          ownerProjectId: project.id,
          reopenProjectVersion: project.version,
        }),
      ).rejects.toThrow("VERSION_CONFLICT");
      expect((await api.snapshot(context)).items).toHaveLength(2);
    });
    it("atomic reopen requires update permission and rolls back event failure", async () => {
      const uow = await create();
      const { api } = service(uow);
      const p = await api.create(context, { type: "PROJECT", title: "P" });
      await api.update(context, p.id, 1, { projectLifecycle: "COMPLETED" });
      const denied = new WorkService(
        uow,
        {
          require: async (_c, permission) => {
            if (permission === "work:update") throw new Error("FORBIDDEN");
          },
        },
        { now: () => "2026-09-20T00:00:00Z" },
        { next: () => "denied" },
      );
      await expect(
        denied.create(context, {
          title: "No",
          ownerProjectId: p.id,
          reopenProjectVersion: 2,
        }),
      ).rejects.toThrow("FORBIDDEN");
      const failing: UnitOfWork = {
        run: (workspace, operation) =>
          uow.run(workspace, (tx) =>
            operation({
              ...tx,
              appendOutbox: async () => {
                throw new Error("outbox failed");
              },
            }),
          ),
      };
      await expect(
        new WorkService(
          failing,
          { require: async () => {} },
          { now: () => "2026-09-20T00:00:00Z" },
          { next: () => crypto.randomUUID() },
        ).create(context, {
          title: "No",
          ownerProjectId: p.id,
          reopenProjectVersion: 2,
        }),
      ).rejects.toThrow("outbox failed");
      expect((await api.snapshot(context)).items).toHaveLength(1);
      expect((await api.snapshot(context)).items[0]).toMatchObject({
        status: "DONE",
        version: 2,
      });
    });
    it("preserves legacy memberships and protects only their structural owner", async () => {
      const { api } = service(await create());
      const a = await api.create(context, { title: "A", type: "PROJECT" });
      const b = await api.create(context, { title: "B", type: "PROJECT" });
      const task = await api.create(context, {
        title: "shared",
        projectIds: [a.id, b.id],
        descriptionMd: "原文\r\n# Keep",
      });
      expect(task.projectId).toBe(a.id);
      expect(
        (await api.snapshot(context)).items.find((i) => i.id === task.id)
          ?.projectIds,
      ).toEqual([a.id, b.id]);
      await expect(api.setDeleted(context, a.id, 1, true)).rejects.toThrow(
        "DEPENDENCY_EXISTS",
      );
      const updated = await api.update(context, task.id, 1, {
        title: "renamed",
      });
      expect(updated.projectIds).toEqual([a.id, b.id]);
      await expect(
        api.update(context, task.id, 1, { projectIds: [] }),
      ).rejects.toThrow("VERSION_CONFLICT");
      await expect(
        api.update(context, task.id, 2, { projectIds: [a.id, a.id] }),
      ).rejects.toThrow("VALIDATION_ERROR");
      await expect(
        api.update(context, task.id, 2, { projectIds: [task.id] }),
      ).rejects.toThrow("VALIDATION_ERROR");
      await expect(
        api.update(context, task.id, 2, {
          projectIds: [b.id],
          projectId: a.id,
        }),
      ).rejects.toThrow("VALIDATION_ERROR");
      const moved = await api.update(context, task.id, 2, { projectId: b.id });
      expect(moved.projectIds).toEqual([b.id]);
      expect(moved.descriptionMd).toBe("原文\r\n# Keep");
      await api.setDeleted(context, a.id, 1, true);
      await api.update(context, task.id, 3, { projectIds: [] });
      await api.setDeleted(context, b.id, 1, true);
    });
    it("restores tasks without promoting a linked project to owner", async () => {
      const { api } = service(await create());
      const a = await api.create(context, { title: "A", type: "PROJECT" });
      const b = await api.create(context, { title: "B", type: "PROJECT" });
      const task = await api.create(context, {
        title: "Shared",
        projectIds: [a.id, b.id],
      });
      await api.setDeleted(context, task.id, 1, true);
      await api.setDeleted(context, a.id, 1, true);
      const restored = await api.setDeleted(context, task.id, 2, false);
      expect(restored.projectIds).toEqual([a.id, b.id]);
      expect(restored.projectId).toBe(null);
    });
    it("supports independent owner and links without resurrecting deleted references", async () => {
      const { api } = service(await create());
      const a = await api.create(context, { title: "Owner", type: "PROJECT" });
      const b = await api.create(context, {
        title: "Reference",
        type: "PROJECT",
      });
      const task = await api.create(context, {
        title: "Owned",
        ownerProjectId: a.id,
        linkedProjectIds: [b.id],
      });
      expect(task.projectId).toBe(a.id);
      expect(task.projectIds).toEqual([a.id, b.id]);
      await api.setDeleted(context, b.id, 1, true);
      const renamed = await api.update(context, task.id, 1, {
        title: "Keep links",
      });
      expect(renamed.projectIds).toEqual([a.id, b.id]);
      const unowned = await api.update(context, task.id, 2, {
        ownerProjectId: null,
      });
      expect(unowned.projectId).toBe(null);
      expect(unowned.projectIds).toEqual([b.id]);
      const snapshot = await api.snapshot(context);
      expect(snapshot.items.find((i) => i.id === task.id)?.projectId).toBe(
        null,
      );
      await expect(
        api.update(context, task.id, 3, {
          ownerProjectId: a.id,
          projectIds: [],
        }),
      ).rejects.toThrow("VALIDATION_ERROR");
      await expect(
        api.create(context, { title: "Bad", linkedProjectIds: [b.id] }),
      ).rejects.toThrow();
      await expect(
        api.update(context, a.id, 1, { linkedProjectIds: [] }),
      ).rejects.toThrow("VALIDATION_ERROR");
    });
    it("scheduling uses the injected host calendar timezone at midnight", async () => {
      const uow = await create();
      let id = 0;
      const clock = {
        now: () => "2026-09-17T15:30:00Z",
        calendarTimezone: "Asia/Tokyo",
      };
      const api = new WorkService(uow, { require: async () => {} }, clock, {
        next: () => "zone-" + ++id,
      });
      const task = await api.create(context, {
        title: "Tomorrow UTC, today Tokyo",
        activationPolicy: "AT_SCHEDULED_TIME",
        startDate: "2026-09-18",
      });
      const utc = new WorkService(
        uow,
        { require: async () => {} },
        { now: clock.now },
        { next: () => "zone-" + ++id },
      );
      await expect(
        utc.update(context, task.id, 1, { status: "IN_PROGRESS" }),
      ).rejects.toThrow("WORK_ITEM_BLOCKED");
      expect((await api.snapshot(context)).calendarTimezone).toBe("Asia/Tokyo");
      expect(
        (await api.update(context, task.id, 1, { status: "IN_PROGRESS" }))
          .status,
      ).toBe("IN_PROGRESS");
      expect((await api.snapshot(context)).items[0]?.startDate).toBe(
        "2026-09-18",
      );
    });
    it("enforces manual and UTC scheduled eligibility without read mutations", async () => {
      const { api, clock } = service(await create());
      const inactive = await api.create(context, {
        title: "paused",
        activationState: "INACTIVE",
      });
      await expect(
        api.update(context, inactive.id, 1, { status: "IN_PROGRESS" }),
      ).rejects.toThrow("WORK_ITEM_BLOCKED");
      await api.update(context, inactive.id, 1, {
        status: "IN_PROGRESS",
        activationState: "ACTIVE",
      });
      await expect(
        api.create(context, {
          title: "missing date",
          activationPolicy: "AT_SCHEDULED_TIME",
        }),
      ).rejects.toThrow("VALIDATION_ERROR");
      const scheduled = await api.create(context, {
        title: "scheduled",
        activationPolicy: "AT_SCHEDULED_TIME",
        startDate: "2026-09-18",
      });
      expect(isReady(scheduled, [scheduled], [], "2026-09-17")).toBe(false);
      expect(isReady(scheduled, [scheduled], [], "2026-09-18")).toBe(true);
      await expect(
        api.update(context, scheduled.id, 1, { status: "DONE" }),
      ).rejects.toThrow("WORK_ITEM_BLOCKED");
      expect(
        (await api.snapshot(context)).items.find((i) => i.id === scheduled.id)
          ?.version,
      ).toBe(1);
      clock.now = () => "2026-09-18T00:00:00.000Z";
      expect(
        (await api.update(context, scheduled.id, 1, { status: "DONE" })).status,
      ).toBe("DONE");
      for (const activationState of [null, "invalid", "SCHEDULED"]) {
        await expect(
          api.create(context, { title: "invalid", activationState } as never),
        ).rejects.toThrow("VALIDATION_ERROR");
      }
    });
    it("reconciles automatic activation on dependency edits and reopening", async () => {
      const { api } = service(await create());
      const a = await api.create(context, { title: "a" });
      const b = await api.create(context, { title: "b" });
      const target = await api.create(context, {
        title: "target",
        activationPolicy: "WHEN_DEPENDENCIES_COMPLETED",
      });
      const current = async () =>
        (await api.snapshot(context)).items.find((i) => i.id === target.id)!;
      await api.addEdge(context, a.id, target.id);
      const second = await api.addEdge(context, b.id, target.id);
      expect((await current()).activationState).toBe("INACTIVE");
      const done = await api.update(context, a.id, 1, { status: "DONE" });
      expect((await current()).activationState).toBe("INACTIVE");
      await api.removeEdge(context, second.id);
      const active = await current();
      expect(active.activationState).toBe("ACTIVE");
      await expect(
        api.update(context, a.id, 1, { status: "TODO" }),
      ).rejects.toThrow("VERSION_CONFLICT");
      expect(await current()).toEqual(active);
      await api.update(context, a.id, done.version, { status: "TODO" });
      expect((await current()).activationState).toBe("INACTIVE");
      expect((await current()).version).toBe(active.version + 1);
    });
    it("allows nested projects but rejects cycles, foreign parents and deleting parents", async () => {
      const { api } = service(await create());
      const parent = await api.create(context, {
        title: "parent",
        type: "PROJECT",
      });
      const child = await api.create(context, {
        title: "child",
        type: "PROJECT",
        projectId: parent.id,
      });
      await expect(
        api.update(context, parent.id, 1, { projectId: child.id }),
      ).rejects.toThrow("WORK_GRAPH_CYCLE_DETECTED");
      await expect(
        api.update(context, parent.id, 1, { projectId: parent.id }),
      ).rejects.toThrow("VALIDATION_ERROR");
      await expect(
        api.create(
          { ...context, workspaceId: "workspace-b" },
          { title: "foreign", projectId: parent.id },
        ),
      ).rejects.toThrow("NOT_FOUND");
      await expect(api.setDeleted(context, parent.id, 1, true)).rejects.toThrow(
        "DEPENDENCY_EXISTS",
      );
      await api.setDeleted(context, child.id, 1, true);
      await api.setDeleted(context, parent.id, 1, true);
      expect(
        (await api.setDeleted(context, child.id, 2, false)).projectId,
      ).toBeNull();
    });
    it("rejects moving a subtree beyond the maximum depth without changing it", async () => {
      const { api } = service(await create());
      let parent = await api.create(context, {
        title: "level 1",
        type: "PROJECT",
      });
      for (let depth = 2; depth <= 15; depth++)
        parent = await api.create(context, {
          title: "level " + depth,
          type: "PROJECT",
          projectId: parent.id,
        });
      const root = await api.create(context, {
        title: "move root",
        type: "PROJECT",
      });
      await api.create(context, {
        title: "move child",
        type: "PROJECT",
        projectId: root.id,
      });
      const before = await api.snapshot(context);
      await expect(
        api.update(context, root.id, root.version, { projectId: parent.id }),
      ).rejects.toThrow("VALIDATION_ERROR");
      expect(await api.snapshot(context)).toEqual(before);
    });
    it("rejects project endpoints in execution dependencies", async () => {
      const { api } = service(await create());
      const project = await api.create(context, {
        title: "project",
        type: "PROJECT",
      });
      const task = await api.create(context, { title: "task" });

      await expect(api.addEdge(context, project.id, task.id)).rejects.toThrow(
        "VALIDATION_ERROR",
      );
      await expect(api.addEdge(context, task.id, project.id)).rejects.toThrow(
        "VALIDATION_ERROR",
      );
    });
    it("serializes racing hierarchy changes so only one direction succeeds", async () => {
      const { api } = service(await create());
      const a = await api.create(context, { title: "a", type: "PROJECT" });
      const b = await api.create(context, { title: "b", type: "PROJECT" });
      const results = await Promise.allSettled([
        api.update(context, a.id, 1, { projectId: b.id }),
        api.update(context, b.id, 1, { projectId: a.id }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    });
    it("rolls back membership replacement with its failed outbox write", async () => {
      const storage = await create();
      let fail = false;
      const wrapped: UnitOfWork = {
        run: (workspace, operation) =>
          storage.run(workspace, (tx) =>
            operation(
              new Proxy(tx, {
                get(target, property) {
                  if (property === "appendOutbox" && fail)
                    return async () => {
                      throw new Error("outbox unavailable");
                    };
                  const value = Reflect.get(target, property);
                  return typeof value === "function"
                    ? value.bind(target)
                    : value;
                },
              }),
            ),
          ),
      };
      const { api } = service(wrapped);
      const a = await api.create(context, { title: "A", type: "PROJECT" });
      const b = await api.create(context, { title: "B", type: "PROJECT" });
      const task = await api.create(context, {
        title: "Task",
        projectIds: [a.id],
      });
      const before = await api.snapshot(context);
      fail = true;
      await expect(
        api.update(context, task.id, 1, { projectIds: [b.id] }),
      ).rejects.toThrow("outbox unavailable");
      expect(await api.snapshot(context)).toEqual(before);
    });
    it("rolls back dependency activation if its outbox write fails", async () => {
      const storage = await create();
      let fail = false;
      let writes = 0;
      const wrapped: UnitOfWork = {
        run: (workspace, operation) =>
          storage.run(workspace, (tx) =>
            operation(
              new Proxy(tx, {
                get(target, property) {
                  if (property === "appendOutbox")
                    return async (
                      ...args: Parameters<WorkTransaction["appendOutbox"]>
                    ) => {
                      if (fail && ++writes === 2)
                        throw new Error("outbox unavailable");
                      return target.appendOutbox(...args);
                    };
                  const value = Reflect.get(target, property);
                  return typeof value === "function"
                    ? value.bind(target)
                    : value;
                },
              }),
            ),
          ),
      };
      const { api } = service(wrapped);
      const source = await api.create(context, { title: "source" });
      const target = await api.create(context, {
        title: "target",
        activationPolicy: "WHEN_DEPENDENCIES_COMPLETED",
      });
      const before = await api.snapshot(context);
      fail = true;
      await expect(api.addEdge(context, source.id, target.id)).rejects.toThrow(
        "outbox unavailable",
      );
      expect(await api.snapshot(context)).toEqual(before);
    });
    it("isolates reads by workspace", async () => {
      const uow = await create();
      await uow.run("workspace-a", async (tx) => tx.insert(work("a")));
      expect(await uow.run("workspace-b", async (tx) => tx.list())).toEqual([]);
      await expect(
        uow.run("workspace-b", async (tx) => tx.get("a")),
      ).rejects.toThrow("NOT_FOUND");
    });
    it("rejects cross-workspace writes", async () => {
      const uow = await create();
      await expect(
        uow.run("workspace-b", async (tx) => tx.insert(work("a"))),
      ).rejects.toThrow("FORBIDDEN");
    });
    it("rolls back all work after a failed transaction", async () => {
      const uow = await create();
      await expect(
        uow.run("workspace-a", async (tx) => {
          await tx.insert(work("a"));
          throw new Error("rollback");
        }),
      ).rejects.toThrow("rollback");
      expect(await uow.run("workspace-a", async (tx) => tx.list())).toEqual([]);
      await uow.run("workspace-a", async (tx) => tx.insert(work("b")));
      expect(
        await uow.run("workspace-a", async (tx) => tx.list()),
      ).toHaveLength(1);
    });
    it("enforces compare-and-swap version increments", async () => {
      const uow = await create();
      await uow.run("workspace-a", async (tx) => tx.insert(work("a")));
      await uow.run("workspace-a", async (tx) =>
        tx.replace({ ...(await tx.get("a")), title: "new", version: 2 }, 1),
      );
      await expect(
        uow.run("workspace-a", async (tx) =>
          tx.replace({ ...work("a"), version: 2 }, 1),
        ),
      ).rejects.toThrow("VERSION_CONFLICT");
      await expect(
        uow.run("workspace-a", async (tx) =>
          tx.replace({ ...work("a"), version: 9 }, 2),
        ),
      ).rejects.toThrow("VERSION_CONFLICT");
    });
    it("only one racing writer succeeds", async () => {
      const uow = await create();
      await uow.run("workspace-a", async (tx) => tx.insert(work("a")));
      const results = await Promise.allSettled(
        ["one", "two"].map((title) =>
          uow.run("workspace-a", async (tx) =>
            tx.replace({ ...(await tx.get("a")), title, version: 2 }, 1),
          ),
        ),
      );
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
    });
    it("soft deletion preserves Markdown and supports restoration", async () => {
      const uow = await create();
      await uow.run("workspace-a", async (tx) => tx.insert(work("a")));
      await uow.run("workspace-a", async (tx) =>
        tx.replace(
          {
            ...(await tx.get("a")),
            deletedAt: "2026-09-13T00:00:00Z",
            version: 2,
          },
          1,
        ),
      );
      expect(await uow.run("workspace-a", async (tx) => tx.list())).toEqual([]);
      expect(
        await uow.run("workspace-a", async (tx) => tx.list(true)),
      ).toHaveLength(1);
      await uow.run("workspace-a", async (tx) =>
        tx.replace({ ...(await tx.get("a")), deletedAt: null, version: 3 }, 2),
      );
      expect(
        await uow.run(
          "workspace-a",
          async (tx) => (await tx.get("a")).descriptionMd,
        ),
      ).toBe(work("a").descriptionMd);
    });
    it("does not leak mutable entity references", async () => {
      const uow = await create();
      const input = { ...work("a") };
      await uow.run("workspace-a", async (tx) => tx.insert(input));
      input.title = "mutated outside";
      const output = await uow.run("workspace-a", async (tx) => tx.get("a"));
      Object.assign(output, { title: "also mutated" });
      expect(
        await uow.run("workspace-a", async (tx) => (await tx.get("a")).title),
      ).toBe("a");
    });
    it("rejects missing graph endpoints and isolates edge reads", async () => {
      const uow = await create();
      await expect(
        uow.run("workspace-a", async (tx) => tx.addEdge(edge("a", "b"))),
      ).rejects.toThrow("NOT_FOUND");
      await uow.run("workspace-a", async (tx) => {
        await tx.insert(work("a"));
        await tx.insert(work("b"));
        await tx.addEdge(edge("a", "b"));
      });
      expect(await uow.run("workspace-b", async (tx) => tx.edges())).toEqual(
        [],
      );
      await expect(
        uow.run("workspace-b", async (tx) => tx.removeEdge("a-b-BLOCKS")),
      ).rejects.toThrow("NOT_FOUND");
    });
    it("closes transaction handles after commit", async () => {
      const uow = await create();
      let escaped: WorkTransaction | undefined;
      await uow.run("workspace-a", async (tx) => {
        escaped = tx;
        await tx.insert(work("a"));
      });
      await expect(
        Promise.resolve().then(() => escaped?.insert(work("b"))),
      ).rejects.toThrow();
    });
    it("closes transaction handles after rollback", async () => {
      const uow = await create();
      let escaped: WorkTransaction | undefined;
      await expect(
        uow.run("workspace-a", async (tx) => {
          escaped = tx;
          await tx.insert(work("a"));
          throw new Error("rollback");
        }),
      ).rejects.toThrow("rollback");
      await expect(
        Promise.resolve().then(() => escaped?.insert(work("b"))),
      ).rejects.toThrow();
      expect(await uow.run("workspace-a", (tx) => tx.list())).toEqual([]);
    });
  });
}
