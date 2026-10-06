import { recurrenceStats } from "@arclattice/application";
import { localCalendarDay, occurrenceDays } from "@arclattice/domain";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { DateField } from "./components/DateField";
import { DateTimeField } from "./components/DateTimeField";
import { recurrenceSummary } from "./components/recurrence-summary";
import { Button } from "./components/ui/Button";
import { Select } from "./components/ui/Surfaces";
import { ProjectDrilldownPicker } from "./features/projects/ProjectDrilldownPicker";

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
  skip,
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
  const [backfillId, setBackfillId] = useState<string | null>(null);
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
  const seriesIndex = useMemo(() => {
    const occurrences = new Map<string, typeof records>();
    for (const record of records) {
      if (record.payload.kind !== "OCCURRENCE" || record.deletedAt) continue;
      const group = occurrences.get(record.payload.definitionId) ?? [];
      occurrences.set(record.payload.definitionId, [...group, record]);
    }
    return {
      occurrences,
      completedIds: new Set(
        items.filter((item) => item.status === "DONE").map((item) => item.id),
      ),
    };
  }, [records, items]);
  return (
    <section className="recurrence-manager">
      <details className="panel" open>
        <summary>{t("workflows.recurrences")}</summary>
        <details>
          <summary>{text("重复规则说明", "How repeating tasks work")}</summary>
          <p>{t("workflows.recurrenceHelp")}</p>
        </details>
        {editing && (
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
              <DateField
                min={startDate}
                value={endDate}
                onChange={setEndDate}
              />
            </label>
            <label>
              {text("默认优先级", "Default priority")}
              <Select
                value={priority}
                onChange={(event) =>
                  setPriority(event.target.value as typeof priority)
                }
              >
                {(["LOW", "MEDIUM", "HIGH", "URGENT"] as const).map((value) => (
                  <option key={value} value={value}>
                    {t(`work:priorities.${value}`)}
                  </option>
                ))}
              </Select>
            </label>
            <label>
              {text("默认激活状态", "Default activation state")}
              <Select
                value={activation}
                onChange={(event) =>
                  setActivation(event.target.value as typeof activation)
                }
              >
                <option value="ACTIVE">{text("已激活", "Active")}</option>
                <option value="INACTIVE">{text("未激活", "Inactive")}</option>
                <option value="SCHEDULED">{text("按计划", "Scheduled")}</option>
              </Select>
            </label>
            <label>
              {text("激活规则", "Activation policy")}
              <Select
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
              </Select>
            </label>
            <label>
              {t("workflows.start")}
              <DateField
                required
                aria-label={t("workflows.start")}
                value={startDate}
                onChange={setStartDate}
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
              <Select
                aria-label={t("workflows.frequency")}
                value={frequency}
                onChange={(e) =>
                  setFrequency(e.target.value as typeof frequency)
                }
              >
                {(["DAILY", "WEEKLY", "MONTHLY"] as const).map((f) => (
                  <option value={f} key={f}>
                    {t(`workflows.${f}`)}
                  </option>
                ))}
              </Select>
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
              <Select
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
                <option value="DURATION">
                  {text("自定义时长", "Duration")}
                </option>
              </Select>
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
                  <Select
                    value={durationUnit}
                    onChange={(e) =>
                      setDurationUnit(e.target.value as typeof durationUnit)
                    }
                  >
                    <option value="HOUR">{text("小时", "Hours")}</option>
                    <option value="DAY">{text("天", "Days")}</option>
                    <option value="WEEK">{text("周", "Weeks")}</option>
                  </Select>
                </label>
              </>
            )}
            <label>
              <input
                type="checkbox"
                checked={closeIncomplete}
                onChange={(e) => setCloseIncomplete(e.target.checked)}
              />
              {text(
                "到期关闭未完成任务",
                "Close incomplete tasks at expiration",
              )}
            </label>
            <Button type="submit" disabled={busy}>
              {editing
                ? text("保存规则修改", "Save rule changes")
                : t("workflows.save")}
            </Button>
            {editing && (
              <Button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setTitle("");
                }}
              >
                {text("取消编辑", "Cancel edit")}
              </Button>
            )}
          </form>
        )}
        {records
          .filter((r) => r.payload.kind === "RECURRENCE" && !r.deletedAt)
          .map((r) => {
            if (r.payload.kind !== "RECURRENCE") return null;
            const rule = r.payload,
              today = localCalendarDay(new Date().toISOString(), rule.timezone);
            const seriesOccurrences = seriesIndex.occurrences.get(r.id) ?? [];
            const occurrencePayloads = seriesOccurrences.flatMap((entry) =>
              entry.payload.kind === "OCCURRENCE" ? [entry.payload] : [],
            );
            const stats = recurrenceStats(
              occurrencePayloads,
              seriesIndex.completedIds,
              today,
            );
            const through = new Date(today + "T00:00:00Z");
            through.setUTCDate(through.getUTCDate() + 365);
            const nextDay =
              rule.state === "ACTIVE"
                ? occurrenceDays(
                    rule,
                    today,
                    through.toISOString().slice(0, 10),
                  ).find(
                    (day) =>
                      !occurrencePayloads.some(
                        (entry) =>
                          entry.day === day &&
                          [
                            "COMPLETED",
                            "BACKFILLED",
                            "SKIPPED",
                            "MISSED",
                          ].includes(entry.status),
                      ),
                  )
                : undefined;
            return (
              <article className="workflow-proposal" key={r.id}>
                <h3>{rule.title}</h3>
                <p>{recurrenceSummary(rule, i18n.language)}</p>
                <p>
                  {text("下次", "Next run")}: {nextDay ?? "—"}
                </p>
                <Button
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
                </Button>
                <p className="workflow-stats">
                  {text("完成", "Completed")} {stats.completedCount}/
                  {stats.dueCount} · {text("完成率", "Rate")}{" "}
                  {Math.round(stats.completionRate * 100)}% ·{" "}
                  {text("连续", "Streak")} {stats.currentStreak}
                  {" · "}
                  {t("workflows.SKIPPED")} {stats.skippedCount}
                </p>
                <Button
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
                </Button>
                <Button
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
                </Button>
                <Button
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
                </Button>
                <p>
                  {text("状态", "State")}:{" "}
                  {rule.state === "PAUSED"
                    ? text("已暂停", "Paused")
                    : rule.state === "ENDED"
                      ? text("已结束", "Ended")
                      : text("进行中", "Running")}
                </p>
                {seriesOccurrences
                  .filter(
                    (entry) =>
                      entry.payload.kind === "OCCURRENCE" &&
                      ["OPEN", "CREATED"].includes(entry.payload.status),
                  )
                  .map((entry) => (
                    <div className="ui-toolbar" key={entry.id}>
                      <small>
                        {entry.payload.kind === "OCCURRENCE"
                          ? t(`workflows.${entry.payload.status}`)
                          : ""}
                        {" · "}
                        {entry.payload.kind === "OCCURRENCE"
                          ? entry.payload.day
                          : ""}
                      </small>
                      {skip && (
                        <Button
                          disabled={busy || !!r.deletedAt}
                          onClick={() => void skip(entry.id, entry.version)}
                        >
                          {text("跳过本次", "Skip this occurrence")}
                        </Button>
                      )}
                    </div>
                  ))}
                <details>
                  <summary>
                    {text("漏做", "Missed")}{" "}
                    {
                      occurrencePayloads.filter(
                        (entry) => entry.status === "MISSED",
                      ).length
                    }{" "}
                    ▸
                  </summary>
                  <ul>
                    {seriesOccurrences
                      .filter(
                        (entry) =>
                          entry.payload.kind === "OCCURRENCE" &&
                          entry.payload.status === "MISSED",
                      )
                      .map((o) =>
                        o.payload.kind !== "OCCURRENCE" ? null : (
                          <li key={o.id}>
                            {o.payload.day} ·{" "}
                            {t(`workflows.${o.payload.status}`)}
                            {o.payload.status === "MISSED" && !r.deletedAt && (
                              <div>
                                {backfillId !== o.id ? (
                                  <Button onClick={() => setBackfillId(o.id)}>
                                    {t("workflows.backfill")}
                                  </Button>
                                ) : (
                                  <>
                                    <label>
                                      {t("workflows.completedAt")}
                                      <DateTimeField
                                        label={t("workflows.completedAt")}
                                        value={completed[o.id] ?? ""}
                                        onChange={(value) =>
                                          setCompleted({
                                            ...completed,
                                            [o.id]: value,
                                          })
                                        }
                                      />
                                    </label>
                                    <Button
                                      type="button"
                                      disabled={busy}
                                      onClick={() =>
                                        backfill(
                                          o.id,
                                          o.version,
                                          completed[o.id]
                                            ? new Date(
                                                completed[o.id]!,
                                              ).toISOString()
                                            : null,
                                        )
                                      }
                                    >
                                      {t("workflows.backfill")}
                                    </Button>
                                  </>
                                )}
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
                </details>
              </article>
            );
          })}
      </details>
    </section>
  );
}
