import type { Note, WorkflowRecord } from "@arclattice/application";
import type { Reminder } from "@arclattice/domain";
import { expect, test } from "vitest";
import { work } from "../../../../../tests/fixtures";
import { buildCalendarIndex } from "./calendar-index";

test("calendar groups all five day-panel dimensions and excludes deleted content across timezone midnight", () => {
  const day = "2026-10-04",
    base = work("task");
  const task = {
    ...base,
    startDate: day,
    dueDate: day,
    status: "DONE" as const,
    completedAt: "2026-10-03T20:00:00Z",
  };
  const journal: Note = {
    ...base,
    id: "journal",
    kind: "JOURNAL",
    bodyMd: "First\nSecond",
    day,
    classification: "PRIVATE",
    boundary: "REMOTE",
    aiAccess: "ASK",
    provenance: "HUMAN",
  };
  const reminder: Reminder = {
    ...base,
    id: "reminder",
    bodyMd: "",
    day,
    time: "09:30",
    timezone: "Asia/Shanghai",
    notifyMode: "AT_TIME",
    notifyOffsetMinutes: null,
    linkedProjectId: null,
    linkedTaskId: null,
    state: "ACTIVE",
  };
  const recurrence: WorkflowRecord = {
    ...base,
    id: "occurrence",
    payload: {
      kind: "OCCURRENCE",
      definitionId: "series",
      definitionVersion: 1,
      day,
      status: "SKIPPED",
      taskId: null,
      completedAt: null,
      recordedAt: base.createdAt,
      backfilledAt: null,
    },
  };
  const deleted = { ...task, id: "deleted", deletedAt: base.createdAt };
  const overdue = { ...base, id: "overdue", dueDate: "2026-10-01" };
  const index = buildCalendarIndex(
    [task, deleted, overdue, base],
    [journal, { ...journal, id: "deleted-journal", deletedAt: base.createdAt }],
    [recurrence],
    "Asia/Shanghai",
    day,
    [
      reminder,
      { ...reminder, id: "deleted-reminder", deletedAt: base.createdAt },
    ],
  );
  expect(index.daySummary(day)).toEqual({
    starts: [task],
    due: [task],
    completed: [task],
    journals: [journal],
    reminders: [reminder],
    recurrence: [recurrence],
  });
  expect(index.overdue).toEqual([overdue]);
  expect(index.unscheduled).toEqual([base]);
  expect(
    buildCalendarIndex([task], [], [], "UTC", day).daySummary("2026-10-03")
      .completed,
  ).toEqual([task]);
  expect(index.daySummary("2026-10-05").due).toEqual([]);
});

test("due minute becomes overdue at the workspace clock while date-only work stays pending", () => {
  const day = "2026-10-04",
    timed = {
      ...work("timed"),
      startDate: null,
      dueDate: day,
      dueTime: "18:30",
      status: "TODO" as const,
    },
    dateOnly = {
      ...work("date-only"),
      startDate: null,
      dueDate: day,
      dueTime: null,
      status: "TODO" as const,
    };
  const before = buildCalendarIndex(
    [timed, dateOnly],
    [],
    [],
    "Asia/Shanghai",
    day,
    [],
    Date.parse("2026-10-04T10:00:00.000Z"),
  );
  expect(before.dueByDay.get(day)?.map((item) => item.id)).toEqual([
    timed.id,
    dateOnly.id,
  ]);
  expect(before.overdue).toEqual([]);
  const after = buildCalendarIndex(
    [timed, dateOnly],
    [],
    [],
    "Asia/Shanghai",
    day,
    [],
    Date.parse("2026-10-04T10:31:00.000Z"),
  );
  // 18:31 in Asia/Shanghai; date-only work has no clock and remains not overdue.
  expect(after.overdue.map((item) => item.id)).toEqual([timed.id]);
});
