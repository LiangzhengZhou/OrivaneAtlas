import type {
  WorkspaceNote as Note,
  WorkflowRecord,
} from "@arclattice/application";
import {
  calendarMonthInfo,
  shiftCalendarMonth,
  type WorkItem,
} from "@arclattice/domain";
import { useMemo, useState } from "react";
import { CalendarMonth } from "./CalendarMonth";
import { buildCalendarIndex } from "./calendar-index";
import { DayAgenda } from "./DayAgenda";
import type { ReminderPanel } from "./ReminderPanel";
import "./calendar-workspace.css";

const emptyReminders: NonNullable<
  Parameters<typeof ReminderPanel>[0]["reminders"]
> = [];
const emptyRecords: WorkflowRecord[] = [];
const emptyJournals: Note[] = [];

export interface CalendarViewState {
  month: string;
  selected: string;
}
export function CalendarView({
  pickerItems,
  reminders = emptyReminders,
  onSaveReminder,
  timezone = "UTC",
  records = emptyRecords,
  items,
  today,
  onOpen,
  journals = emptyJournals,
  onJournal,
  onCreateTask,
  viewState,
  onViewStateChange,
}: {
  reminders?: Parameters<typeof ReminderPanel>[0]["reminders"];
  onSaveReminder?: Parameters<typeof ReminderPanel>[0]["save"];
  pickerItems?: readonly WorkItem[];
  timezone?: string;
  records?: WorkflowRecord[];
  items: WorkItem[];
  today: string;
  journals?: Note[];
  onJournal?(day: string): void;
  onCreateTask?(day: string): void;
  onOpen(item: WorkItem): void;
  viewState?: CalendarViewState;
  onViewStateChange?(state: CalendarViewState): void;
}) {
  const [localState, setLocalState] = useState<CalendarViewState>({
    month: today.slice(0, 7),
    selected: today,
  });
  const state = viewState ?? localState;
  const update = (next: CalendarViewState) => {
    if (!viewState) setLocalState(next);
    onViewStateChange?.(next);
  };
  const index = useMemo(
    () =>
      buildCalendarIndex(items, journals, records, timezone, today, reminders),
    [items, journals, records, timezone, today, reminders],
  );
  const shift = (by: number) => {
    const next = shiftCalendarMonth(state.month, by);
    if (!next) return;
    const day = Math.min(
      Number(state.selected.slice(8, 10)),
      calendarMonthInfo(next).days,
    );
    update({
      month: next,
      selected: next + "-" + String(day).padStart(2, "0"),
    });
  };
  return (
    <div className="calendar-layout">
      <CalendarMonth
        index={index}
        month={state.month}
        selected={state.selected}
        today={today}
        timezone={timezone}
        onShift={shift}
        onToday={() => update({ month: today.slice(0, 7), selected: today })}
        onSelect={(selected) => update({ ...state, selected })}
        onCreate={onCreateTask}
      />
      <DayAgenda
        day={state.selected}
        timezone={timezone}
        index={index}
        items={pickerItems ?? items}
        onOpen={onOpen}
        onJournal={onJournal}
        onCreateTask={onCreateTask}
        onSaveReminder={onSaveReminder}
      />
    </div>
  );
}
