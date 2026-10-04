import type { Note, WorkflowRecord } from "@arclattice/application";
import {
  localCalendarDay,
  type Reminder,
  type WorkItem,
} from "@arclattice/domain";

export interface CalendarDaySummary {
  starts: readonly WorkItem[];
  due: readonly WorkItem[];
  completed: readonly WorkItem[];
  journals: readonly Note[];
  recurrence: readonly WorkflowRecord[];
  reminders: readonly Reminder[];
}
export function buildCalendarIndex(
  items: readonly WorkItem[],
  notes: readonly Note[],
  records: readonly WorkflowRecord[],
  timezone: string,
  today: string,
  reminders: readonly Reminder[] = [],
) {
  const startsByDay = new Map<string, WorkItem[]>();
  const dueByDay = new Map<string, WorkItem[]>();
  const completedByDay = new Map<string, WorkItem[]>();
  const journalByDay = new Map<string, Note[]>();
  const recurrenceByDay = new Map<string, WorkflowRecord[]>();
  const remindersByDay = new Map<string, Reminder[]>();
  const overdue: WorkItem[] = [],
    unscheduled: WorkItem[] = [];
  function add<T>(
    map: Map<string, T[]>,
    day: string | null | undefined,
    entry: T,
  ) {
    if (!day) return;
    const group = map.get(day);
    if (group) group.push(entry);
    else map.set(day, [entry]);
  }
  for (const item of items) {
    if (item.deletedAt) continue;
    add(startsByDay, item.startDate, item);
    add(dueByDay, item.dueDate, item);
    if (item.status === "DONE" && item.completedAt)
      add(completedByDay, localCalendarDay(item.completedAt, timezone), item);
    if (item.status === "DONE" || item.status === "CANCELED") continue;
    if (item.dueDate && item.dueDate < today) overdue.push(item);
    if (!item.startDate && !item.dueDate) unscheduled.push(item);
  }
  for (const note of notes)
    if (!note.deletedAt && note.kind === "JOURNAL")
      add(journalByDay, note.day, note);
  for (const record of records)
    if (!record.deletedAt && record.payload.kind === "OCCURRENCE")
      add(recurrenceByDay, record.payload.day, record);
  for (const reminder of reminders)
    if (!reminder.deletedAt) add(remindersByDay, reminder.day, reminder);
  const daySummary = (day: string): CalendarDaySummary => ({
    reminders: remindersByDay.get(day) ?? [],
    starts: startsByDay.get(day) ?? [],
    due: dueByDay.get(day) ?? [],
    completed: completedByDay.get(day) ?? [],
    journals: journalByDay.get(day) ?? [],
    recurrence: recurrenceByDay.get(day) ?? [],
  });
  return {
    startsByDay,
    dueByDay,
    completedByDay,
    journalByDay,
    recurrenceByDay,
    remindersByDay,
    overdue,
    unscheduled,
    daySummary,
  };
}
