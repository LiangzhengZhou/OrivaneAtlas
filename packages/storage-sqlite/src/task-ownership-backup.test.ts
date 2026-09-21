import { expect, test } from "vitest";
import { restoreDatabase } from "./index";
import { context, service, sqliteHarness } from "./testing";

const harness = sqliteHarness();
test("backup restores workspace timezone and removed dependency endpoints", async () => {
  const db = await harness.create();
  const api = service(db);
  const source = await api.create(context, { title: "Before" });
  const target = await api.create(context, {
    title: "After",
    prerequisiteIds: [source.id],
  });
  await api.update(context, target.id, target.version, {
    prerequisiteIds: [],
    expectedPrerequisiteIds: [source.id],
  });
  await api.setCalendarSettings(context, 0, "Asia/Shanghai");
  const backup = harness.file();
  await db.backup(backup);
  const file = harness.file();
  await restoreDatabase(backup, file);
  const restored = await harness.open(file);
  expect((await service(restored).snapshot(context)).calendarTimezone).toBe(
    "Asia/Shanghai",
  );
  expect((await service(restored).snapshot(context)).edges).toHaveLength(0);
  const events = await restored.inspectEvents(context.workspaceId);
  const removed = events.activity.find(
    (event) => event.type === "WORK_EDGE_REMOVED",
  );
  expect(removed).toMatchObject({
    fromId: source.id,
    toId: target.id,
    edgeType: "BLOCKS",
  });
  expect(events.outbox.some((event) => event.activityId === removed?.id)).toBe(
    true,
  );
});
test("backup restores unowned task references and Markdown without owner promotion", async () => {
  const db = await harness.create();
  const api = service(db);
  const project = await api.create(context, {
    title: "Reference",
    type: "PROJECT",
  });
  const task = await api.create(context, {
    title: "No owner",
    ownerProjectId: null,
    linkedProjectIds: [project.id],
    descriptionMd: "# Original\r\n\n**unchanged**",
  });
  await api.setDeleted(context, project.id, 1, true);
  const backup = harness.file();
  await db.backup(backup);
  const restoredFile = harness.file();
  await restoreDatabase(backup, restoredFile);
  const restored = await harness.open(restoredFile);
  const snapshot = await service(restored).snapshot(context);
  expect(snapshot.items.find((i) => i.id === task.id)).toEqual(task);
  expect(snapshot.items.find((i) => i.id === project.id)?.deletedAt).not.toBe(
    null,
  );
  const updated = await service(restored).update(context, task.id, 1, {
    title: "After restore",
  });
  expect(updated.projectId).toBe(null);
  expect(updated.projectIds).toEqual([project.id]);
  expect(updated.descriptionMd).toBe(task.descriptionMd);
});

test("backup preserves paused project lifecycle and explicit completion guards", async () => {
  const db = await harness.create();
  const api = service(db);
  const project = await api.create(context, {
    title: "Paused",
    type: "PROJECT",
    descriptionMd: "# Keep",
  });
  const paused = await api.update(context, project.id, 1, {
    projectLifecycle: "PAUSED",
  });
  const task = await api.create(context, {
    title: "Pending",
    ownerProjectId: project.id,
  });
  const backup = harness.file();
  await db.backup(backup);
  const file = harness.file();
  await restoreDatabase(backup, file);
  const restored = service(await harness.open(file));
  expect(
    (await restored.snapshot(context)).items.find((i) => i.id === project.id),
  ).toEqual(paused);
  await expect(
    restored.update(context, project.id, 2, { projectLifecycle: "COMPLETED" }),
  ).rejects.toThrow("PROJECT_HAS_UNFINISHED_WORK");
  await restored.update(context, task.id, 1, { status: "DONE" });
  expect(
    (
      await restored.update(context, project.id, 2, {
        projectLifecycle: "COMPLETED",
      })
    ).status,
  ).toBe("DONE");
});
