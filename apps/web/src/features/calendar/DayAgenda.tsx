import type { WorkItem } from "@arclattice/domain";
import { formatCalendarDate } from "@arclattice/domain";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/Button";
import { VirtualTaskCollection } from "../tasks/VirtualTaskCollection";
import { CalendarEventRow } from "./CalendarEventRow";
import type { CalendarIndex } from "./calendar-index";
import { ReminderPanel } from "./ReminderPanel";

export function DayAgenda({
  day,
  timezone,
  index,
  items,
  onOpen,
  onJournal,
  onCreateTask,
  onSaveReminder,
}: {
  day: string;
  timezone: string;
  index: CalendarIndex;
  items: readonly WorkItem[];
  onOpen(item: WorkItem): void;
  onJournal?: ((day: string) => void) | undefined;
  onCreateTask?: ((day: string) => void) | undefined;
  onSaveReminder?: Parameters<typeof ReminderPanel>[0]["save"] | undefined;
}) {
  const { t, i18n } = useTranslation("desk");
  const zh = i18n.language.startsWith("zh");
  const [createRequest, setCreateRequest] = useState(0);
  const summary = index.daySummary(day);
  const groups = [
    { label: zh ? "截止" : "Due", signal: "◇", entries: summary.due },
    { label: zh ? "开始" : "Starts", signal: "→", entries: summary.starts },
    {
      label: zh ? "已完成" : "Completed",
      signal: "✓",
      entries: summary.completed,
    },
  ];
  return (
    <aside className="agenda-panel">
      <h2>
        {formatCalendarDate(day, i18n.language, {
          month: "long",
          day: "numeric",
          weekday: "long",
        })}
      </h2>
      <div className="calendar-agenda-actions">
        {onCreateTask && (
          <Button variant="ghost" onClick={() => onCreateTask(day)}>
            {zh ? "+ 任务" : "+ Task"}
          </Button>
        )}
        {onSaveReminder && (
          <Button
            variant="ghost"
            onClick={() => setCreateRequest((value) => value + 1)}
          >
            {zh ? "添加提醒" : "Add reminder"}
          </Button>
        )}
        {onJournal && (
          <Button variant="ghost" onClick={() => onJournal(day)}>
            {t("journal")}
          </Button>
        )}
      </div>
      {groups
        .filter((group) => group.entries.length > 0)
        .map((group) => (
          <section
            key={group.signal}
            className="calendar-agenda-section"
            data-kind={group.signal}
          >
            <h3>
              {group.label}
              <span className="muted" data-count={group.entries.length}>
                {group.entries.length}
              </span>
            </h3>
            <VirtualTaskCollection
              items={group.entries}
              virtualizeAfter={12}
              estimatedRowHeight={44}
              render={(item) => (
                <CalendarEventRow
                  item={item}
                  signal={group.signal}
                  onOpen={onOpen}
                />
              )}
            />
          </section>
        ))}
      {onSaveReminder && (
        <ReminderPanel
          day={day}
          timezone={timezone}
          reminders={summary.reminders}
          items={items}
          save={onSaveReminder}
          hideCreate
          createRequest={createRequest}
        />
      )}
      {summary.journals.length > 0 && (
        <section className="calendar-agenda-section">
          <h3>
            {t("journal")}
            <span className="muted" data-count={summary.journals.length}>
              {summary.journals.length}
            </span>
          </h3>
          {summary.journals.map((note) => (
            <Button
              key={note.id}
              variant="text"
              onClick={() => onJournal?.(day)}
            >
              {note.title}
            </Button>
          ))}
        </section>
      )}
      {(index.overdue.length > 0 || index.unscheduled.length > 0) && (
        <details className="calendar-secondary">
          <summary>{zh ? "其他任务" : "Other tasks"}</summary>
          {[
            { label: t("overdue"), entries: index.overdue },
            { label: t("unscheduled"), entries: index.unscheduled },
          ]
            .filter((group) => group.entries.length > 0)
            .map((group) => (
              <details key={group.label}>
                <summary>
                  {group.label} · {group.entries.length}
                </summary>
                <VirtualTaskCollection
                  items={group.entries}
                  render={(item) => (
                    <CalendarEventRow item={item} signal="○" onOpen={onOpen} />
                  )}
                />
              </details>
            ))}
        </details>
      )}
    </aside>
  );
}
