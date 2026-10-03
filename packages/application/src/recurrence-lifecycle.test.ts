import { occurrenceDays } from "@arclattice/domain";
import { expect, test } from "vitest";
import {
  normalizeWorkflowRecords,
  occurrenceExpiry,
} from "./recurrence-lifecycle";
import type { RecurrencePayload } from "./workflows";
import { recurrenceStats } from "./workflows";

const rule: RecurrencePayload = {
  kind: "RECURRENCE",
  title: "Daily",
  descriptionMd: "",
  startDate: "2026-01-01",
  timezone: "America/New_York",
  frequency: "DAILY",
  interval: 1,
};
test("daily weekly and monthly expected dates remain stable across missing month days", () => {
  expect(
    occurrenceDays(
      { ...rule, frequency: "WEEKLY", startDate: "2026-01-01" },
      "2026-01-01",
      "2026-01-16",
    ),
  ).toEqual(["2026-01-01", "2026-01-08", "2026-01-15"]);
  expect(
    occurrenceDays(
      { ...rule, frequency: "MONTHLY", startDate: "2026-01-31" },
      "2026-01-01",
      "2026-04-30",
    ),
  ).toEqual(["2026-01-31", "2026-03-31"]);
});
test("statistics preserve completed occurrences after task purge and exclude arbitrary DONE task counts", () => {
  const base = {
    kind: "OCCURRENCE" as const,
    definitionId: "r",
    definitionVersion: 1,
    day: "2026-10-03",
    taskId: null,
    completedAt: null,
    recordedAt: "2026-10-03T00:00:00Z",
    backfilledAt: null,
  };
  const stats = recurrenceStats(
    [
      { ...base, status: "COMPLETED" },
      { ...base, status: "MISSED", taskId: "unrelated-done" },
      { ...base, status: "OPEN", taskId: "other-done" },
    ],
    new Set(["unrelated-done", "other-done"]),
    "2026-10-03",
  );
  expect(stats).toMatchObject({
    dueCount: 3,
    completedCount: 1,
    missedCount: 1,
    completionRate: 1 / 3,
  });
});
test("calendar expiration follows both DST transitions, not a fixed 24 hours", () => {
  expect(occurrenceExpiry(rule, "2026-03-08")).toBe("2026-03-09T03:59:59.999Z");
  expect(occurrenceExpiry(rule, "2026-11-01")).toBe("2026-11-02T04:59:59.999Z");
  expect(
    occurrenceExpiry({ ...rule, timezone: "Asia/Shanghai" }, "2026-01-01"),
  ).toBe("2026-01-01T15:59:59.999Z");
});
test("next occurrence respects weekly cadence, skipped month days, and ignores generation end date", () => {
  expect(
    occurrenceExpiry(
      {
        ...rule,
        frequency: "WEEKLY",
        closePolicy: "NEXT_OCCURRENCE",
        endDate: "2026-01-01",
      },
      "2026-01-01",
    ),
  ).toBe("2026-01-08T05:00:00.000Z");
  expect(
    occurrenceExpiry(
      { ...rule, frequency: "MONTHLY", closePolicy: "NEXT_OCCURRENCE" },
      "2026-01-31",
    ),
  ).toBe("2026-03-31T04:00:00.000Z");
});
test("duration distinguishes elapsed hours from local calendar days", () => {
  expect(
    occurrenceExpiry(
      {
        ...rule,
        closePolicy: "DURATION",
        durationValue: 1,
        durationUnit: "DAY",
      },
      "2026-03-08",
    ),
  ).toBe("2026-03-09T04:00:00.000Z");
  expect(
    occurrenceExpiry(
      {
        ...rule,
        closePolicy: "DURATION",
        durationValue: 24,
        durationUnit: "HOUR",
      },
      "2026-03-08",
    ),
  ).toBe("2026-03-09T05:00:00.000Z");
  expect(() =>
    occurrenceExpiry(
      {
        ...rule,
        closePolicy: "DURATION",
        durationValue: 0,
        durationUnit: "HOUR",
      },
      "2026-03-08",
    ),
  ).toThrow("VALIDATION_ERROR");
});
test("legacy definitions and orphan occurrences have explicit defaults", () => {
  const base = {
    id: "old",
    workspaceId: "w",
    version: 1,
    createdBy: "p",
    updatedBy: "p",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    deletedAt: null,
  };
  const records = normalizeWorkflowRecords([
    { ...base, payload: rule },
    {
      ...base,
      id: "occ",
      payload: {
        kind: "OCCURRENCE",
        definitionId: "old",
        definitionVersion: 1,
        day: "2026-03-08",
        status: "CREATED",
        taskId: null,
        completedAt: null,
        recordedAt: base.createdAt,
        backfilledAt: null,
      },
    },
  ]);
  expect(records[0]?.payload).toMatchObject({
    state: "ACTIVE",
    closePolicy: "END_OF_DAY",
    closeIncomplete: true,
  });
  expect(records[1]?.payload).toMatchObject({
    status: "OPEN",
    expiresAt: "2026-03-09T03:59:59.999Z",
    closedAt: null,
  });
});
