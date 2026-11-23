import {
  calendarDate,
  calendarMonthInfo,
  formatCalendarDate,
  shiftCalendarMonth,
} from "@arclattice/domain";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/Button";
import type { CalendarIndex } from "./calendar-index";

export type CalendarMode = "month" | "week" | "day" | "agenda";

function offsetDay(day: string, offset: number) {
  const date = calendarDate(day);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.getUTCFullYear() >= 1 && date.getUTCFullYear() <= 9999
    ? date.toISOString().slice(0, 10)
    : null;
}

export function CalendarPeriod({
  mode,
  selected,
  today,
  timezone,
  index,
  onSelect,
}: {
  mode: Exclude<CalendarMode, "month">;
  selected: string;
  today: string;
  timezone: string;
  index: CalendarIndex;
  onSelect(day: string): void;
}) {
  const { i18n, t } = useTranslation("desk");
  const zh = i18n.language.startsWith("zh");
  const month = selected.slice(0, 7);
  const initialOffset =
    mode === "week" ? -((calendarDate(selected).getUTCDay() + 6) % 7) : 0;
  const dates =
    mode === "agenda"
      ? Array.from(
          { length: calendarMonthInfo(month).days },
          (_, i) => month + "-" + String(i + 1).padStart(2, "0"),
        )
      : Array.from({ length: mode === "week" ? 7 : 1 }, (_, i) =>
          offsetDay(selected, initialOffset + i),
        ).filter((day): day is string => day !== null);
  function adjacent(direction: number) {
    if (mode !== "agenda")
      return offsetDay(selected, direction * (mode === "week" ? 7 : 1));
    const next = shiftCalendarMonth(month, direction);
    if (!next) return null;
    return (
      next +
      "-" +
      String(
        Math.min(Number(selected.slice(8)), calendarMonthInfo(next).days),
      ).padStart(2, "0")
    );
  }
  const previous = adjacent(-1),
    next = adjacent(1);
  const fullDate = (day: string) =>
    formatCalendarDate(day, i18n.language, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  const heading =
    mode === "agenda"
      ? formatCalendarDate(selected, i18n.language, {
          year: "numeric",
          month: "long",
        })
      : mode === "week"
        ? fullDate(dates[0]!) + " – " + fullDate(dates[dates.length - 1]!)
        : fullDate(selected);
  const rows = dates.flatMap((day) => {
    const group = index.daySummary(day);
    const tasks = new Set(
      [...group.due, ...group.starts, ...group.completed].map(
        (item) => item.id,
      ),
    ).size;
    const counts = [
      [tasks, zh ? "任务" : "Tasks"],
      [group.reminders.length, zh ? "提醒" : "Reminders"],
      [group.journals.length, zh ? "日记" : "Journal entries"],
      [group.recurrence.length, zh ? "重复实例" : "Occurrences"],
    ] as const;
    const summary = counts
      .filter(([count]) => count)
      .map(([count, label]) => label + " · " + count)
      .join(" / ");
    if (mode === "agenda" && !summary) return [];
    return [{ day, summary }];
  });
  return (
    <section className="calendar-panel calendar-period">
      <header className="calendar-month-header">
        <div>
          <h2>{heading}</h2>
          <small className="muted">{t("calendarTimezone", { timezone })}</small>
        </div>
        <div className="calendar-controls">
          <Button
            variant="ghost"
            disabled={!previous}
            onClick={() => previous && onSelect(previous)}
          >
            {zh ? "上一时段" : "Previous period"}
          </Button>
          <Button variant="ghost" onClick={() => onSelect(today)}>
            {t("today")}
          </Button>
          <Button
            variant="ghost"
            disabled={!next}
            onClick={() => next && onSelect(next)}
          >
            {zh ? "下一时段" : "Next period"}
          </Button>
        </div>
      </header>
      <label className="calendar-period-picker">
        {zh ? "选择日期" : "Choose date"}
        <input
          type="date"
          value={selected}
          min="0001-01-01"
          max="9999-12-31"
          onChange={(event) => {
            const value = event.currentTarget.value;
            if (value && event.currentTarget.validity.valid) onSelect(value);
          }}
        />
      </label>
      {mode !== "day" && (
        <div className="calendar-period-list">
          {rows.length ? (
            rows.map(({ day, summary }) => (
              <Button
                key={day}
                variant="ghost"
                aria-pressed={selected === day}
                onClick={() => onSelect(day)}
              >
                <span>
                  {formatCalendarDate(day, i18n.language, {
                    month: "short",
                    day: "numeric",
                    weekday: "short",
                  })}
                </span>
                <small>{summary || (zh ? "无日程" : "No entries")}</small>
              </Button>
            ))
          ) : (
            <p role="status">{zh ? "本月没有日程" : "No entries this month"}</p>
          )}
        </div>
      )}
    </section>
  );
}
