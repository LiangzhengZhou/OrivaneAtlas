import { Button } from "./components/ui/Button";
import "./styles/recurrence.css";
import { recurrenceStats, type WorkflowRecord } from "@arclattice/application";
import { localCalendarDay } from "@arclattice/domain";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DismissibleDialog } from "./app/DismissibleDialog";
import { RecurrenceStatisticsBoard } from "./RecurrenceStatisticsBoard";
export function RecurrenceSummary({
  records,
  timezone,
  onManage,
}: {
  records: WorkflowRecord[];
  timezone: string;
  onManage(): void;
}) {
  const { i18n } = useTranslation();
  const text = (cn: string, en: string) =>
    i18n.language.startsWith("zh") ? cn : en;
  const [detail, setDetail] = useState(false);
  const today = localCalendarDay(new Date().toISOString(), timezone),
    seven = new Date(today + "T00:00:00Z");
  seven.setUTCDate(seven.getUTCDate() - 6);
  const occurrences = records.flatMap((r) =>
    !r.deletedAt && r.payload.kind === "OCCURRENCE" ? [r.payload] : [],
  );
  return (
    <section
      className="recurrence-summary"
      aria-label={text("周期任务摘要", "Recurring summary")}
    >
      <strong>{text("周期任务", "Recurring tasks")}</strong>
      {[
        [text("今日", "Today"), today],
        [text("最近 7 天", "Last 7 Days"), seven.toISOString().slice(0, 10)],
        [text("本月", "Current Month"), today.slice(0, 7) + "-01"],
      ].map(([label, from]) => {
        const stats = recurrenceStats(
          occurrences.filter((o) => o.day >= from!),
          new Set(),
          today,
        );
        return (
          <span key={label}>
            {label} {stats.completedCount} / {stats.dueCount}
          </span>
        );
      })}
      <Button variant="toggle" type="button" onClick={() => setDetail(true)}>
        {text("查看统计", "View statistics")}
      </Button>
      <Button type="button" onClick={onManage}>
        {text("管理周期任务", "Manage recurring tasks")}
      </Button>
      {detail && (
        <DismissibleDialog
          className="recurrence-statistics-dialog"
          aria-label={text("周期任务统计", "Recurring statistics")}
          onRequestClose={() => setDetail(false)}
        >
          <Button type="button" onClick={() => setDetail(false)}>
            {text("关闭", "Close")}
          </Button>
          <RecurrenceStatisticsBoard records={records} timezone={timezone} />
        </DismissibleDialog>
      )}
    </section>
  );
}
