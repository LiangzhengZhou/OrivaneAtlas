import { recurrenceStats, type WorkflowRecord } from "@arclattice/application";
import { localCalendarDay } from "@arclattice/domain";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Select } from "./components/ui/Surfaces";

export function RecurrenceStatisticsBoard({
  records,
  timezone,
}: {
  records: WorkflowRecord[];
  timezone: string;
}) {
  const { i18n } = useTranslation();
  const text = (zh: string, en: string) =>
    i18n.language.startsWith("zh") ? zh : en;
  const [definitionId, setDefinitionId] = useState("");
  const now = new Date().toISOString();
  const definitions = records.filter(
    (r) => r.payload.kind === "RECURRENCE" && !r.deletedAt,
  );
  const selected = definitions.find((r) => r.id === definitionId);
  const today = localCalendarDay(
    now,
    selected?.payload.kind === "RECURRENCE"
      ? selected.payload.timezone
      : timezone,
  );
  const seven = new Date(today + "T00:00:00Z");
  seven.setUTCDate(seven.getUTCDate() - 6);
  const windows = [
    [text("今天", "Today"), today],
    [text("最近 7 天", "Last 7 Days"), seven.toISOString().slice(0, 10)],
    [text("本月", "Current Month"), today.slice(0, 7) + "-01"],
  ];
  const occurrences = records.flatMap((r) =>
    r.payload.kind === "OCCURRENCE" &&
    !r.deletedAt &&
    (!definitionId || r.payload.definitionId === definitionId)
      ? [r.payload]
      : [],
  );
  return (
    <section
      className="recurrence-statistics"
      aria-label={text("周期任务统计", "Recurring statistics")}
    >
      <h3>{text("统计看板", "Statistics Board")}</h3>
      <label>
        {text("统计范围", "Statistics scope")}
        <Select
          value={definitionId}
          onChange={(e) => setDefinitionId(e.target.value)}
        >
          <option value="">{text("全部周期任务", "All recurrences")}</option>
          {definitions.map((r) => (
            <option value={r.id} key={r.id}>
              {r.payload.kind === "RECURRENCE" ? r.payload.title : ""}
            </option>
          ))}
        </Select>
      </label>
      <div className="recurrence-statistics-grid">
        {windows.map(([label, from]) => {
          const stats = recurrenceStats(
            occurrences.filter((o) => o.day >= from!),
            new Set(),
            today,
          );
          return (
            <article key={label}>
              <h4>{label}</h4>
              <dl>
                <dt>{text("应发生", "Due")}</dt>
                <dd>{stats.dueCount}</dd>
                <dt>{text("完成", "Completed")}</dt>
                <dd>{stats.completedCount}</dd>
                <dt>{text("错过", "Missed")}</dt>
                <dd>{stats.missedCount}</dd>
                <dt>{text("完成率", "Completion rate")}</dt>
                <dd>{Math.round(stats.completionRate * 100)}%</dd>
              </dl>
            </article>
          );
        })}
      </div>
    </section>
  );
}
