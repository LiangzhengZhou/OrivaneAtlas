import type { ReminderInput } from "@arclattice/domain";
import { expect, it } from "vitest";
import { reminderDraftChanged } from "./reminder-draft";

it("guards body links schedule and notification edits without treating a view expansion as data", () => {
  const draft: ReminderInput = {
    title: "Reminder",
    bodyMd: "Original\nMarkdown",
    day: "2026-10-11",
    time: "09:00",
    timezone: "UTC",
    notifyMode: "AT_TIME",
    notifyOffsetMinutes: null,
    linkedProjectId: null,
    linkedTaskId: null,
    state: "ACTIVE",
  };
  expect(reminderDraftChanged({ ...draft }, draft)).toBe(false);
  for (const patch of [
    { bodyMd: "New text" },
    { linkedTaskId: "task" },
    { day: "2026-10-12" },
    { time: "10:00" },
    { timezone: "Asia/Shanghai" },
    { notifyMode: "MINUTES_BEFORE" as const, notifyOffsetMinutes: 15 },
  ])
    expect(reminderDraftChanged({ ...draft, ...patch }, draft)).toBe(true);
});
