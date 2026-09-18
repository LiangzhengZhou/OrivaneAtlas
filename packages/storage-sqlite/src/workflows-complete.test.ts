import { randomUUID } from "node:crypto";
import {
  CategoryService,
  WorkflowService,
  WorkService,
} from "@arclattice/application";
import { expect, test } from "vitest";
import { context, sqliteHarness } from "./testing";

const harness = sqliteHarness();
const auth = { require: async () => {} };
const clock = { now: () => "2026-09-18T12:00:00.000Z" };
const ids = { next: randomUUID };

test("atomic complete plan publishes sorted hierarchy, multi-project task, categories and recurrence once", async () => {
  const db = await harness.create();
  const service = new WorkflowService(db, auth, clock, ids);
  const work = new WorkService(db, auth, clock, ids);
  const preview = await service.preview(context, null, {
    version: 1,
    projects: [
      { tempId: "child", title: "Child", parentTempId: "root" },
      { tempId: "root", title: "Root" },
    ],
    categories: [
      {
        tempId: "category",
        name: "Research",
        projectTempIds: ["root", "child"],
      },
    ],
    tasks: [
      {
        tempId: "task",
        title: "Task",
        projectTempIds: ["root", "child"],
        activationState: "INACTIVE",
        priority: "URGENT",
        assigneePrincipalId: "human",
      },
    ],
    recurrences: [
      {
        tempId: "daily",
        title: "Daily",
        descriptionMd: "# Preserve\n",
        startDate: "2026-09-17",
        endDate: "2026-09-18",
        timezone: "UTC",
        frequency: "DAILY",
        interval: 1,
        projectTempIds: ["root", "child"],
        assigneePrincipalId: "human",
        activationState: "INACTIVE",
        priority: "HIGH",
      },
    ],
  });
  const published = await service.publish(context, preview.id, preview.version);
  expect(await service.publish(context, preview.id, preview.version)).toEqual(
    published,
  );
  if (published.payload.kind !== "PLAN") throw new Error("not plan");
  const result = published.payload.result;
  const snapshot = await work.snapshot(context);
  expect(snapshot.items).toHaveLength(3);
  expect(
    snapshot.items.find((item) => item.id === result.child)?.projectId,
  ).toBe(result.root);
  expect(snapshot.items.find((item) => item.id === result.task)).toMatchObject({
    projectIds: [result.root, result.child],
    activationState: "INACTIVE",
    priority: "URGENT",
    assigneePrincipalId: "human",
  });
  expect(published.payload.provenance).toHaveLength(5);
  const occurrences = await service.generate(
    context,
    result.daily!,
    1,
    "2026-09-17",
    "2026-09-18",
  );
  const missed = occurrences.find(
    (record) =>
      record.payload.kind === "OCCURRENCE" &&
      record.payload.status === "MISSED",
  )!;
  const definition = (await service.list(context)).find(
    (record) => record.id === result.daily,
  )!;
  if (definition.payload.kind !== "RECURRENCE") throw new Error("not rule");
  await service.saveRecurrence(context, {
    id: definition.id,
    version: definition.version,
    deleted: false,
    rule: {
      ...definition.payload,
      title: "Edited",
      priority: "LOW",
      projectIds: [],
      projectId: null,
    },
  });
  await service.backfill(context, missed.id, missed.version, null);
  const generated = (await work.snapshot(context)).items.filter(
    (item) => item.title === "Daily",
  );
  expect(generated).toHaveLength(2);
  for (const item of generated)
    expect(item).toMatchObject({
      projectIds: [result.root, result.child],
      priority: "HIGH",
      activationState: "INACTIVE",
      assigneePrincipalId: "human",
      descriptionMd: "# Preserve\n",
    });
});

test("document failure rolls back all work and events; category edits invalidate approval", async () => {
  const db = await harness.create();
  const service = new WorkflowService(db, auth, clock, ids, {
    publish: async () => {
      throw new Error("document write failed");
    },
  });
  const plan = await service.preview(context, null, {
    version: 1,
    projects: [{ tempId: "project", title: "P" }],
    documents: [
      {
        tempId: "doc",
        title: "D",
        bodyMd: "# unchanged",
        projectTempId: "project",
        ownership: "OWNED",
      },
    ],
  });
  await expect(service.publish(context, plan.id, plan.version)).rejects.toThrow(
    "document write failed",
  );
  expect(await db.run(context.workspaceId, (tx) => tx.list())).toHaveLength(0);
  expect((await service.list(context))[0]).toEqual(plan);
  const clean = new WorkflowService(db, auth, clock, ids);
  const proposal = await clean.preview(context, null, {
    version: 1,
    tasks: [{ tempId: "task", title: "T" }],
  });
  await new CategoryService(db, auth, clock, ids).save(context, {
    name: "Changed",
    projectIds: [],
    version: 0,
    deleted: false,
  });
  await expect(
    clean.publish(context, proposal.id, proposal.version),
  ).rejects.toThrow("VERSION_CONFLICT");
  await expect(
    clean.publish(
      { ...context, principalId: "other" },
      proposal.id,
      proposal.version,
    ),
  ).rejects.toThrow("FORBIDDEN");
});
