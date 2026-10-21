import { defaultNotificationPreferences } from "@arclattice/domain";
import { expect, test } from "vitest";
import {
  type NotificationCause,
  produceNotifications,
} from "./notification-policy";

const preferences = defaultNotificationPreferences("UTC");
const base: NotificationCause = {
  workspaceId: "w",
  reason: "TASK_DUE",
  subjectId: "t1",
  occasion: "2026-03-08",
  title: "Task due",
  body: "Ship it",
  target: { kind: "TASK", id: "t1", route: "/tasks/t1" },
  targetVersion: 1,
  timezone: "UTC",
  fireAt: "2026-03-08T09:00:00.000Z",
};
let counter = 0;
const run = (
  causes: NotificationCause[],
  prefs = preferences,
  existing = new Map(),
) =>
  produceNotifications({
    causes,
    existing,
    preferences: prefs,
    now: "2026-03-08T08:00:00.000Z",
    newId: () => `n${++counter}`,
  });

test("noise reasons never become notifications", () => {
  expect(
    run([
      { ...base, reason: "SYNC_SUCCESS" },
      { ...base, reason: "ATLAS_SUGGESTION" },
      { ...base, reason: "BACKGROUND_COMPLETED" },
      { ...base, reason: "ASYNC_COMPLETED_REQUESTED" },
      { ...base, reason: "CONFLICT_ACTIONABLE" },
    ]),
  ).toEqual([]);
});

test("explicit async completion and actionable conflicts are allowed", () => {
  expect(
    run([
      { ...base, reason: "ASYNC_COMPLETED_REQUESTED", userRequested: true },
      { ...base, reason: "CONFLICT_ACTIONABLE", needsUserAction: true },
    ]).map((record) => record.reason),
  ).toEqual(["ASYNC_COMPLETED_REQUESTED", "CONFLICT_ACTIONABLE"]);
});

test("same cause dedupes within a batch and against existing records", () => {
  const first = run([base, base]);
  expect(first).toHaveLength(1);
  expect(
    run([base], preferences, new Map([[first[0]!.dedupeKey, first[0]!]])),
  ).toEqual([]);
});

test("quiet hours defer delivery but keep the record", () => {
  const quiet = {
    ...preferences,
    quietHours: {
      ...preferences.quietHours,
      enabled: true,
      start: "08:00",
      end: "10:00",
    },
  };
  const [record] = run([base], quiet);
  expect(record?.delivery.state).toBe("SUPPRESSED_QUIET_HOURS");
  expect(record?.fireAt).toBe(base.fireAt);
  expect(record?.delivery.nextRetryAt).toBe("2026-03-08T10:00:00.000Z");
});

test("disabled source is respected", () => {
  expect(run([base], { ...preferences, disabledSources: ["TASK"] })).toEqual(
    [],
  );
});
