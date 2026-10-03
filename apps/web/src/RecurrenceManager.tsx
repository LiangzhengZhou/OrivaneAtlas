import { recurrenceStats } from "@arclattice/application";
import { localCalendarDay } from "@arclattice/domain";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ProjectDrilldownPicker } from "./features/projects/ProjectDrilldownPicker";
import { RecurrenceStatisticsBoard } from "./RecurrenceStatisticsBoard";

import type { WorkflowManagerProps } from "./WorkflowManager";
export function RecurrenceManager({
  calendarTimezone = "UTC",
  records,
  projects,
  items,
  busy,
  save,
  generate,
  backfill,
}: WorkflowManagerProps) {
  const { t, i18n } = useTranslation("desk");
  const text = (zh: string, en: string) =>
    i18n.language.startsWith("zh") ? zh : en;
  const [title, setTitle] = useState(""),
    [startDate, setStartDate] = useState(
      localCalendarDay(new Date().toISOString(), calendarTimezone),
    );
  const [timezone, setTimezone] = useState(calendarTimezone),
    [frequency, setFrequency] = useState<"DAILY" | "WEEKLY" | "MONTHLY">(
      "DAILY",
    ),
    [interval, setInterval] = useState(1);
  const [completed, setCompleted] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<{
    id: string;
    version: number;
  } | null>(null);
  const [state, setState] = useState<"ACTIVE" | "PAUSED" | "ENDED">("ACTIVE");
  const [closePolicy, setClosePolicy] = useState<
    "END_OF_DAY" | "NEXT_OCCURRENCE" | "DURATION"
  >("END_OF_DAY");
  const [closeIncomplete, setCloseIncomplete] = useState(true);
  const [durationValue, setDurationValue] = useState(24);
  const [durationUnit, setDurationUnit] = useState<"HOUR" | "DAY" | "WEEK">(
    "HOUR",
  );
  const [descriptionMd, setDescriptionMd] = useState("");
  const [endDate, setEndDate] = useState("");
  const [assignee, setAssignee] = useState("");
  const [priority, setPriority] = useState<
    "LOW" | "MEDIUM" | "HIGH" | "URGENT"
  >("MEDIUM");
  const [activation, setActivation] = useState<
    "ACTIVE" | "INACTIVE" | "SCHEDULED"
  >("ACTIVE");
  const [activationPolicy, setActivationPolicy] = useState<
    "MANUAL" | "IMMEDIATE" | "WHEN_DEPENDENCIES_COMPLETED" | "AT_SCHEDULED_TIME"
  >("MANUAL");
  const [recurrenceProjects, setRecurrenceProjects] = useState<string[]>([]);
  return (
    <section className="recurrence-manager">
      <details className="panel" open>
        <summary>{t("workflows.recurrences")}</summary>
        <RecurrenceStatisticsBoard
          records={records}
          timezone={calendarTimezone}
        />
        <p>{t("workflows.recurrenceHelp")}</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await save({
                ...(editing ? { id: editing.id } : {}),
                version: editing?.version ?? 0,
                deleted: false,
                rule: {
                  state,
                  closePolicy,
                  closeIncomplete,
                  durationValue,
                  durationUnit,
                  title,
                  descriptionMd,
                  projectIds: recurrenceProjects,
                  assigneePrincipalId: assignee || null,
                  priority,
                  activationState: activation,
                  activationPolicy,
                  endDate: endDate || null,
                  startDate,
                  timezone,
                  frequency,
                  interval,
                },
              })
            ) {
              setTitle("");
              setEditing(null);
              setState("ACTIVE");
            }
          }}
        >
          <label>
            {t("workflows.title")}
            <input
              required
              value={title}
              aria-label={t("workflows.title")}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            {text("说明（Markdown）", "Description (Markdown)")}
            <textarea
              value={descriptionMd}
              onChange={(event) => setDescriptionMd(event.target.value)}
            />
          </label>
          <label>
            {text("结束日期（含当天）", "End date (inclusive)")}
            <input
              type="date"
              min={startDate}
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </label>
          <label>
            {text("默认负责人 ID", "Default assignee ID")}
            <input
              maxLength={240}
              value={assignee}
              onChange={(event) => setAssignee(event.target.value)}
            />
          </label>
          <label>
            {text("默认优先级", "Default priority")}
            <select
              value={priority}
              onChange={(event) =>
                setPriority(event.target.value as typeof priority)
              }
            >
              {(["LOW", "MEDIUM", "HIGH", "URGENT"] as const).map((value) => (
                <option key={value} value={value}>
                  {t(`priority.${value}`, { defaultValue: value })}
                </option>
              ))}
            </select>
          </label>
          <label>
            {text("默认激活状态", "Default activation state")}
            <select
              value={activation}
              onChange={(event) =>
                setActivation(event.target.value as typeof activation)
              }
            >
              <option value="ACTIVE">{text("已激活", "Active")}</option>
              <option value="INACTIVE">{text("未激活", "Inactive")}</option>
              <option value="SCHEDULED">{text("按计划", "Scheduled")}</option>
            </select>
          </label>
          <label>
            {text("激活规则", "Activation policy")}
            <select
              value={activationPolicy}
              onChange={(event) =>
                setActivationPolicy(
                  event.target.value as typeof activationPolicy,
                )
              }
            >
              <option value="MANUAL">{text("手动", "Manual")}</option>
              <option value="IMMEDIATE">{text("立即", "Immediate")}</option>
              <option value="WHEN_DEPENDENCIES_COMPLETED">
                {text("依赖完成后", "After dependencies complete")}
              </option>
              <option value="AT_SCHEDULED_TIME">
                {text("到计划日期", "At scheduled date")}
              </option>
            </select>
          </label>
          <label>
            {t("workflows.start")}
            <input
              required
              type="date"
              aria-label={t("workflows.start")}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </label>
          <label>
            {t("workflows.timezone")}
            <input
              required
              value={timezone}
              aria-label={t("workflows.timezone")}
              onChange={(e) => setTimezone(e.target.value)}
            />
          </label>
          <label>
            {t("workflows.frequency")}
            <select
              aria-label={t("workflows.frequency")}
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as typeof frequency)}
            >
              {(["DAILY", "WEEKLY", "MONTHLY"] as const).map((f) => (
                <option value={f} key={f}>
                  {t(`workflows.${f}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("workflows.interval")}
            <input
              required
              type="number"
              min={1}
              max={366}
              value={interval}
              onChange={(e) => setInterval(Number(e.target.value))}
            />
          </label>
          <label>
            {t("workflows.project")}
            <ProjectDrilldownPicker
              mode="multiple"
              projects={projects}
              values={recurrenceProjects}
              disabled={busy}
              onChange={(values) =>
                setRecurrenceProjects(Array.isArray(values) ? values : [])
              }
            />
          </label>
          <label>
            {text("关闭策略", "Close policy")}
            <select
              value={closePolicy}
              onChange={(e) =>
                setClosePolicy(e.target.value as typeof closePolicy)
              }
            >
              <option value="END_OF_DAY">
                {text("当天结束", "End of day")}
              </option>
              <option value="NEXT_OCCURRENCE">
                {text("下一次发生", "Next occurrence")}
              </option>
              <option value="DURATION">{text("自定义时长", "Duration")}</option>
            </select>
          </label>
          {closePolicy === "DURATION" && (
            <>
              <label>
                {text("时长", "Duration value")}
                <input
                  type="number"
                  min={1}
                  max={366}
                  value={durationValue}
                  onChange={(e) => setDurationValue(Number(e.target.value))}
                />
              </label>
              <label>
                {text("单位", "Unit")}
                <select
                  value={durationUnit}
                  onChange={(e) =>
                    setDurationUnit(e.target.value as typeof durationUnit)
                  }
                >
                  <option value="HOUR">{text("小时", "Hours")}</option>
                  <option value="DAY">{text("天", "Days")}</option>
                  <option value="WEEK">{text("周", "Weeks")}</option>
                </select>
              </label>
            </>
          )}
          <label>
            <input
              type="checkbox"
              checked={closeIncomplete}
              onChange={(e) => setCloseIncomplete(e.target.checked)}
            />
            {text("到期关闭未完成任务", "Close incomplete tasks at expiration")}
          </label>
          <button type="submit" disabled={busy}>
            {editing
              ? text("保存规则修改", "Save rule changes")
              : t("workflows.save")}
          </button>
          {editing && (
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setTitle("");
              }}
            >
              {text("取消编辑", "Cancel edit")}
            </button>
          )}
        </form>
        {records
          .filter((r) => r.payload.kind === "RECURRENCE" && !r.deletedAt)
          .map((r) => {
            if (r.payload.kind !== "RECURRENCE") return null;
            const rule = r.payload,
              today = localCalendarDay(new Date().toISOString(), rule.timezone);
            const occurrencePayloads = records.flatMap((o) =>
              o.payload.kind === "OCCURRENCE" && o.payload.definitionId === r.id
                ? [o.payload]
                : [],
            );
            const stats = recurrenceStats(
              occurrencePayloads,
              new Set(
                items
                  .filter((item) => item.status === "DONE")
                  .map((item) => item.id),
              ),
              today,
            );
            return (
              <article className="workflow-proposal" key={r.id}>
                <h3>{rule.title}</h3>
                <p className="workflow-description">{rule.descriptionMd}</p>
                <p>
                  {rule.startDate} →{" "}
                  {rule.endDate ?? text("无结束日期", "No end date")} ·{" "}
                  {text("负责人", "Assignee")}:{" "}
                  {rule.assigneePrincipalId ?? "—"} ·{" "}
                  {rule.activationState ?? "ACTIVE"} ·{" "}
                  {rule.priority ?? "MEDIUM"}
                </p>
                <p>
                  {(rule.projectIds ?? [])
                    .map(
                      (id) =>
                        projects.find((project) => project.id === id)?.title ??
                        id,
                    )
                    .join(" · ")}
                </p>
                <button
                  type="button"
                  disabled={busy || !!r.deletedAt}
                  onClick={() => {
                    setEditing({ id: r.id, version: r.version });
                    setState(rule.state ?? "ACTIVE");
                    setClosePolicy(rule.closePolicy ?? "END_OF_DAY");
                    setCloseIncomplete(rule.closeIncomplete ?? true);
                    setDurationValue(rule.durationValue ?? 24);
                    setDurationUnit(rule.durationUnit ?? "HOUR");
                    setTitle(rule.title);
                    setDescriptionMd(rule.descriptionMd);
                    setStartDate(rule.startDate);
                    setEndDate(rule.endDate ?? "");
                    setTimezone(rule.timezone);
                    setFrequency(rule.frequency);
                    setInterval(rule.interval);
                    setAssignee(rule.assigneePrincipalId ?? "");
                    setPriority(rule.priority ?? "MEDIUM");
                    setActivation(rule.activationState ?? "ACTIVE");
                    setActivationPolicy(rule.activationPolicy ?? "MANUAL");
                    setRecurrenceProjects(rule.projectIds ?? []);
                  }}
                >
                  {text("编辑规则", "Edit rule")}
                </button>
                <p>
                  {rule.schedulerThrough
                    ? `${t("workflows.schedulerThrough")}: ${rule.schedulerThrough}`
                    : t("workflows.schedulerWaiting")}
                </p>
                <p className="workflow-stats">
                  {text("完成", "Completed")} {stats.completedCount}/
                  {stats.dueCount} · {text("完成率", "Rate")}{" "}
                  {Math.round(stats.completionRate * 100)}% ·{" "}
                  {text("连续", "Streak")} {stats.currentStreak}
                </p>
                <p>
                  {t(`workflows.${rule.frequency}`)} · {rule.interval} ·{" "}
                  {rule.timezone}
                </p>
                <button
                  type="button"
                  disabled={
                    busy ||
                    !!r.deletedAt ||
                    rule.state !== "ACTIVE" ||
                    today < rule.startDate
                  }
                  onClick={() => {
                    const lower = new Date(today + "T00:00:00Z");
                    lower.setUTCDate(lower.getUTCDate() - 365);
                    const from = lower.toISOString().slice(0, 10);
                    return generate(
                      r.id,
                      r.version,
                      rule.startDate > from ? rule.startDate : from,
                      today,
                    );
                  }}
                >
                  {t("workflows.generate")}
                </button>
                <button
                  type="button"
                  disabled={busy || rule.state === "ENDED"}
                  onClick={() => {
                    const {
                      kind: _,
                      schedulerThrough: _cursor,
                      ...input
                    } = rule;
                    return save({
                      id: r.id,
                      version: r.version,
                      deleted: false,
                      rule: {
                        ...input,
                        state: rule.state === "PAUSED" ? "ACTIVE" : "PAUSED",
                      },
                    });
                  }}
                >
                  {rule.state === "PAUSED"
                    ? text("恢复", "Resume")
                    : t("workflows.pause")}
                </button>
                <button
                  type="button"
                  disabled={busy || rule.state === "ENDED"}
                  onClick={() => {
                    const {
                      kind: _,
                      schedulerThrough: _cursor,
                      ...input
                    } = rule;
                    return save({
                      id: r.id,
                      version: r.version,
                      deleted: false,
                      rule: { ...input, state: "ENDED" },
                    });
                  }}
                >
                  {text("结束", "End")}
                </button>
                <p>
                  {text("状态", "State")}: {rule.state ?? "ACTIVE"}
                </p>
                <ul>
                  {records
                    .filter(
                      (o) =>
                        o.payload.kind === "OCCURRENCE" &&
                        o.payload.definitionId === r.id,
                    )
                    .map((o) =>
                      o.payload.kind !== "OCCURRENCE" ? null : (
                        <li key={o.id}>
                          {o.payload.day} · {t(`workflows.${o.payload.status}`)}
                          {o.payload.status === "MISSED" && !r.deletedAt && (
                            <div>
                              <label>
                                {t("workflows.completedAt")}
                                <input
                                  type="datetime-local"
                                  value={completed[o.id] ?? ""}
                                  onChange={(e) =>
                                    setCompleted({
                                      ...completed,
                                      [o.id]: e.target.value,
                                    })
                                  }
                                />
                              </label>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  backfill(
                                    o.id,
                                    o.version,
                                    completed[o.id]
                                      ? new Date(completed[o.id]!).toISOString()
                                      : null,
                                  )
                                }
                              >
                                {t("workflows.backfill")}
                              </button>
                            </div>
                          )}
                          {o.payload.completedAt && (
                            <small>
                              {t("workflows.completedAt")}:{" "}
                              {o.payload.completedAt}
                            </small>
                          )}
                        </li>
                      ),
                    )}
                </ul>
              </article>
            );
          })}
      </details>
    </section>
  );
}
