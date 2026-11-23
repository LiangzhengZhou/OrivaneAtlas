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
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/Button";
import { CalendarMonth } from "./CalendarMonth";
import { type CalendarMode, CalendarPeriod } from "./CalendarPeriod";
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
  mode?: CalendarMode;
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
  const { i18n } = useTranslation("desk");
  const zh = i18n.language.startsWith("zh");
  const state = viewState ?? localState;
  const mode = state.mode ?? "month";
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
      ...state,
      month: next,
      selected: next + "-" + String(day).padStart(2, "0"),
    });
  };
  return (
    <>
      <div
        role="group"
        aria-label={zh ? "日历视图" : "Calendar views"}
        className="calendar-modes"
      >
        {(
          [
            ["month", "月", "Month"],
            ["week", "周", "Week"],
            ["day", "日", "Day"],
            ["agenda", "议程", "Agenda"],
          ] as const
        ).map(([value, cn, en]) => (
          <Button
            key={value}
            variant="ghost"
            aria-pressed={mode === value}
            onClick={() => update({ ...state, mode: value })}
          >
            {zh ? cn : en}
          </Button>
        ))}
      </div>
      <div className="calendar-layout">
        {mode === "month" ? (
          <CalendarMonth
            index={index}
            month={state.month}
            selected={state.selected}
            today={today}
            timezone={timezone}
            onShift={shift}
            onToday={() =>
              update({ month: today.slice(0, 7), selected: today })
            }
            onSelect={(selected) =>
              update({ month: selected.slice(0, 7), selected })
            }
            onCreate={onCreateTask}
          />
        ) : (
          <CalendarPeriod
            mode={mode}
            index={index}
            timezone={timezone}
            selected={state.selected}
            today={today}
            onSelect={(selected) =>
              update({ ...state, month: selected.slice(0, 7), selected })
            }
          />
        )}
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
    </>
  );
}
