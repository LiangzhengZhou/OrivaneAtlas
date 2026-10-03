import { expect, test } from "vitest";
import { work } from "../../../tests/fixtures";
import { NotificationPlanner } from "./notifications";

const planner = new NotificationPlanner();
const base = {
  server: "https://example.test",
  actor: { workspaceId: "workspace-a", principalId: "human" },
  items: [],
  workflows: [],
  timezone: "America/New_York",
  today: "2026-03-08",
  now: "2026-03-08T05:00:00.000Z",
};
test("planner generates all task kinds with local wall time across DST and stable IDs", () => {
  const input = {
    ...base,
    items: [
      { ...work("task"), startDate: "2026-03-08", dueDate: "2026-03-08" },
    ],
    dailyDigest: true,
    horizonDays: 2,
  };
  const intents = planner.plan(input);
  expect(
    intents
      .filter((intent) => intent.localDay === "2026-03-08")
      .map((intent) => intent.scheduledAt),
  ).toEqual([
    "2026-03-08T13:00:00.000Z",
    "2026-03-08T13:00:00.000Z",
    "2026-03-08T13:00:00.000Z",
  ]);
  expect(intents.map((intent) => intent.kind)).toEqual(
    expect.arrayContaining([
      "TASK_START",
      "TASK_DUE",
      "TASK_OVERDUE",
      "DAILY_DIGEST",
    ]),
  );
  expect(planner.plan(input)).toEqual(intents);
});
test("completed canceled deleted and foreign tasks never schedule; identity separates native schedules", () => {
  const intents = planner.plan({
    ...base,
    items: [
      { ...work("done"), dueDate: base.today, status: "DONE" },
      { ...work("canceled"), dueDate: base.today, status: "CANCELED" },
      { ...work("deleted"), dueDate: base.today, deletedAt: base.now },
      { ...work("foreign", "other"), dueDate: base.today },
    ],
  });
  expect(intents).toEqual([]);
  const first = planner.plan({ ...base, dailyDigest: true })[0]!;
  expect(
    planner.plan({
      ...base,
      actor: { ...base.actor, principalId: "other" },
      dailyDigest: true,
    })[0]?.id,
  ).not.toBe(first.id);
  expect(
    planner.plan({
      ...base,
      server: "https://other.test",
      dailyDigest: true,
    })[0]?.id,
  ).not.toBe(first.id);
});
test("planner emits recurrence expiration reminders from the occurrence window, with no Markdown", () => {
  const intents = planner.plan({
    ...base,
    workflows: [
      {
        id: "o",
        workspaceId: "workspace-a",
        version: 1,
        createdBy: "human",
        updatedBy: "human",
        createdAt: base.now,
        updatedAt: base.now,
        deletedAt: null,
        payload: {
          kind: "OCCURRENCE",
          definitionId: "r",
          definitionVersion: 1,
          day: base.today,
          status: "OPEN",
          expiresAt: "2026-03-09T03:59:59.999Z",
          taskId: "task",
          completedAt: null,
          recordedAt: base.now,
          backfilledAt: null,
        },
      },
    ],
  });
  expect(intents).toHaveLength(1);
  expect(intents[0]).toMatchObject({
    kind: "RECURRENCE_EXPIRING",
    scheduledAt: "2026-03-09T02:59:59.999Z",
  });
  expect(JSON.stringify(intents)).not.toContain("descriptionMd");
});
