import { calendarMonthInfo, formatCalendarDate } from "@arclattice/domain";
import { Bell, ChevronLeft, ChevronRight, NotebookPen } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button, IconButton } from "../../components/ui/Button";
import { CalendarDayCell } from "../../components/ui/Content";
import type { CalendarIndex } from "./calendar-index";

export function CalendarMonth({
  index,
  month,
  selected,
  today,
  timezone,
  onShift,
  onToday,
  onSelect,
  onCreate,
}: {
  index: CalendarIndex;
  month: string;
  selected: string;
  today: string;
  timezone: string;
  onShift(by: number): void;
  onToday(): void;
  onSelect(day: string): void;
  onCreate?: ((day: string) => void) | undefined;
}) {
  const { t, i18n } = useTranslation("desk");
  const { days, offset } = calendarMonthInfo(month);
  const blanks = (7 - ((days + offset) % 7)) % 7;
  const zh = i18n.language.startsWith("zh");
  const weekdays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) =>
        formatCalendarDate("2026-09-" + (14 + index), i18n.language, {
          weekday: "short",
        }),
      ),
    [i18n.language],
  );
  const monthDays = useMemo(
    () =>
      Array.from({ length: days }, (_, indexInMonth) => {
        const day = month + "-" + String(indexInMonth + 1).padStart(2, "0");
        const summary = index.daySummary(day);
        const entries = new Map<
          string,
          { item: (typeof summary.due)[number]; signal: string }
        >();
        for (const [items, signal] of [
          [summary.due, "◇"],
          [summary.starts, "→"],
          [summary.completed, "✓"],
        ] as const) {
          for (const item of items) {
            if (!entries.has(item.id)) entries.set(item.id, { item, signal });
          }
        }
        return { day, summary, entries: [...entries.values()] };
      }),
    [days, month, index],
  );
  return (
    <section className="calendar-panel">
      <header className="calendar-month-header">
        <div>
          <h2>
            {formatCalendarDate(month + "-01", i18n.language, {
              year: "numeric",
              month: "long",
            })}
          </h2>
          <small className="muted" data-testid="calendar-timezone">
            {t("calendarTimezone", { timezone })}
          </small>
        </div>
        <div className="calendar-controls">
          <IconButton label={t("previousMonth")} onClick={() => onShift(-1)}>
            <ChevronLeft />
          </IconButton>
          <Button variant="ghost" onClick={onToday}>
            {t("today")}
          </Button>
          <IconButton label={t("nextMonth")} onClick={() => onShift(1)}>
            <ChevronRight />
          </IconButton>
        </div>
      </header>
      <div className="calendar-sheet">
        <div className="calendar-week">
          {weekdays.map((label, index) => (
            <span key={index}>{label}</span>
          ))}
        </div>
        <div
          className="calendar-grid"
          aria-label={zh ? "月份日期" : "Month days"}
        >
          {Array.from({ length: offset }, (_, index) => (
            <div
              className="calendar-blank"
              aria-hidden="true"
              key={"before" + index}
            />
          ))}
          {monthDays.map(({ day, summary, entries }, indexInMonth) => {
            return (
              <CalendarDayCell
                key={day}
                aria-label={day}
                aria-pressed={selected === day}
                selected={selected === day}
                className={"calendar-day " + (today === day ? "is-today" : "")}
                onSelect={() => onSelect(day)}
                onOpen={() => onCreate?.(day)}
              >
                <span className="calendar-date">{indexInMonth + 1}</span>
                <div className="calendar-preview">
                  {entries.slice(0, 3).map(({ item, signal }) => (
                    <span key={item.id} title={item.title}>
                      <span
                        className="calendar-event-signal"
                        aria-label={
                          signal === "◇"
                            ? t("dueDate")
                            : signal === "→"
                              ? t("startDate")
                              : zh
                                ? "已完成"
                                : "Completed"
                        }
                      >
                        {signal}
                      </span>
                      {item.title}
                    </span>
                  ))}
                  {entries.length > 3 && (
                    <small
                      className="calendar-overflow"
                      aria-label={
                        zh
                          ? `还有 ${entries.length - 3} 项`
                          : `${entries.length - 3} more items`
                      }
                    >
                      +{entries.length - 3}
                    </small>
                  )}
                </div>
                <span className="calendar-day-signals">
                  {summary.reminders.length > 0 && (
                    <Bell size={12} aria-label={zh ? "提醒" : "Reminders"} />
                  )}
                  {summary.journals.length > 0 && (
                    <NotebookPen size={12} aria-label={t("journal")} />
                  )}
                </span>
              </CalendarDayCell>
            );
          })}
          {Array.from({ length: blanks }, (_, index) => (
            <div
              className="calendar-blank"
              aria-hidden="true"
              key={"after" + index}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
