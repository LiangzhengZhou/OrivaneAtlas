import type { WorkflowRecord, WorkflowService } from "@arclattice/application";
import { localCalendarDay, type WorkItem } from "@arclattice/domain";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  calendarTimezone?: string;
  records: WorkflowRecord[];
  projects: WorkItem[];
  busy: boolean;
  preview(projectId: string | null, manifest: unknown): Promise<boolean>;
  publish(id: string, version: number): Promise<boolean>;
  save(
    input: Parameters<WorkflowService["saveRecurrence"]>[1],
  ): Promise<boolean>;
  generate(
    id: string,
    version: number,
    from: string,
    to: string,
  ): Promise<boolean>;
  backfill(
    id: string,
    version: number,
    completedAt: string | null,
  ): Promise<boolean>;
}
export function WorkflowManager({
  calendarTimezone = "UTC",
  records,
  projects,
  busy,
  preview,
  publish,
  save,
  generate,
  backfill,
}: Props) {
  const { t, i18n } = useTranslation("desk");
  const text = (zh: string, en: string) =>
    i18n.language.startsWith("zh") ? zh : en;
  const [projectId, setProjectId] = useState(""),
    [manifest, setManifest] = useState(
      '{"version":1,"tasks":[{"tempId":"first","title":""}]}',
    );
  const [error, setError] = useState(false),
    [title, setTitle] = useState(""),
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
  function renderPlanTree(
    record: Extract<WorkflowRecord["payload"], { kind: "PLAN" }>,
  ) {
    const nodes = record.projects ?? [];
    const children = new Map<string | null, typeof nodes>();
    for (const node of nodes) {
      const list = children.get(node.parentTempId) ?? [];
      list.push(node);
      children.set(node.parentTempId, list);
    }
    const draw = (parent: string | null, depth = 0): ReactNode[] =>
      (children.get(parent) ?? []).map((node) => (
        <li
          className="plan-tree-node"
          key={node.tempId}
          style={{ marginLeft: depth * 18 }}
        >
          <div className="plan-tree-project">
            <strong>{node.title}</strong>
            <span>{node.tempId}</span>
          </div>
          {node.descriptionMd && (
            <p className="workflow-description">{node.descriptionMd}</p>
          )}
          <ul className="plan-tree-tasks">
            {record.tasks
              .filter((task) => task.projectTempId === node.tempId)
              .map((task) => (
                <li key={task.tempId}>
                  <strong>{task.title}</strong>
                  <span>{task.tempId}</span>
                </li>
              ))}
          </ul>
          <ul className="plan-tree-children">{draw(node.tempId, depth + 1)}</ul>
        </li>
      ));
    return (
      <ul className="plan-tree">
        {draw(null)}
        {record.tasks
          .filter((task) => !task.projectTempId)
          .map((task) => (
            <li className="plan-tree-task" key={task.tempId}>
              <strong>{task.title}</strong>
              <span>{task.tempId}</span>
            </li>
          ))}
      </ul>
    );
  }
  return (
    <section className="workflow-manager">
      <details className="panel">
        <summary>{t("workflows.plans")}</summary>
        <p>{t("workflows.planHelp")}</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            let value: unknown;
            try {
              value = JSON.parse(manifest);
              setError(false);
            } catch {
              setError(true);
              return;
            }
            await preview(projectId || null, value);
          }}
        >
          <label>
            {t("workflows.project")}
            <select
              aria-label={t("workflows.project")}
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">{t("workflows.chooseProject")}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("workflows.manifest")}
            <textarea
              aria-label={t("workflows.manifest")}
              rows={8}
              required
              value={manifest}
              onChange={(e) => setManifest(e.target.value)}
            />
          </label>
          {error && <p role="alert">{t("workflows.invalidJson")}</p>}
          <button type="submit" disabled={busy}>
            {t("workflows.preview")}
          </button>
        </form>
        {records
          .filter((r) => r.payload.kind === "PLAN" && !r.deletedAt)
          .map((r) =>
            r.payload.kind !== "PLAN" ? null : (
              <article className="workflow-proposal" key={r.id}>
                <h3>
                  {projects.find(
                    (p) =>
                      r.payload.kind === "PLAN" && p.id === r.payload.projectId,
                  )?.title ?? r.id}{" "}
                  ·{" "}
                  {t(
                    r.payload.published
                      ? "workflows.published"
                      : "workflows.review",
                  )}
                </h3>
                <p>{t("workflows.reviewHelp")}</p>
                <div className="plan-tree-summary">
                  <strong>{t("workflows.treePreview")}</strong>
                  <span>
                    {(r.payload.projects ?? []).length}{" "}
                    {t("workflows.projectsCount")} · {r.payload.tasks.length}{" "}
                    {t("workflows.tasksCount")}
                  </span>
                </div>
                {(r.payload.projects ?? []).length > 0 &&
                  renderPlanTree(r.payload)}
                <ol>
                  {r.payload.tasks.map((task) => (
                    <li key={task.tempId}>
                      <strong>{task.title}</strong>
                      <div>
                        {task.tempId} · {task.startDate ?? "—"} →{" "}
                        {task.dueDate ?? "—"}
                      </div>
                      <p className="workflow-description">
                        {task.descriptionMd}
                      </p>
                      <span>
                        {t("workflows.dependencies")}:{" "}
                        {task.dependsOn.join(", ") || "—"}
                      </span>
                      <pre
                        style={{
                          whiteSpace: "pre-wrap",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {JSON.stringify(
                          {
                            projectIds: task.projectIds,
                            projectTempIds:
                              task.projectTempIds ??
                              (task.projectTempId ? [task.projectTempId] : []),
                            activationState: task.activationState ?? "ACTIVE",
                            activationPolicy: task.activationPolicy ?? "MANUAL",
                            priority: task.priority ?? "MEDIUM",
                            assigneePrincipalId:
                              task.assigneePrincipalId ?? null,
                          },
                          null,
                          2,
                        )}
                      </pre>
                    </li>
                  ))}
                </ol>
                {(
                  [
                    [text("分类", "Categories"), r.payload.categories ?? []],
                    [
                      text("周期定义", "Recurrence definitions"),
                      r.payload.recurrences ?? [],
                    ],
                    [
                      text("知识空间", "Knowledge spaces"),
                      r.payload.spaces ?? [],
                    ],
                    [
                      text(
                        "文档（保留完整正文）",
                        "Documents (full content preserved)",
                      ),
                      r.payload.documents ?? [],
                    ],
                  ] as const
                ).map(
                  ([label, entities]) =>
                    entities.length > 0 && (
                      <section key={label}>
                        <h4>
                          {label} · {entities.length}
                        </h4>
                        {entities.map((entity) => (
                          <details key={entity.tempId} open>
                            <summary>{entity.tempId}</summary>
                            <pre
                              style={{
                                whiteSpace: "pre-wrap",
                                overflowWrap: "anywhere",
                              }}
                            >
                              {JSON.stringify(entity, null, 2)}
                            </pre>
                          </details>
                        ))}
                      </section>
                    ),
                )}
                {!r.payload.published && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => publish(r.id, r.version)}
                  >
                    {t("workflows.publish")}
                  </button>
                )}
              </article>
            ),
          )}
      </details>
      <details className="panel">
        <summary>{t("workflows.recurrences")}</summary>
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
            <select
              aria-label={t("workflows.project")}
              multiple
              value={recurrenceProjects}
              onChange={(event) =>
                setRecurrenceProjects(
                  Array.from(
                    event.target.selectedOptions,
                    (option) => option.value,
                  ),
                )
              }
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
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
          .filter((r) => r.payload.kind === "RECURRENCE")
          .map((r) => {
            if (r.payload.kind !== "RECURRENCE") return null;
            const rule = r.payload,
              today = localCalendarDay(new Date().toISOString(), rule.timezone);
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
                <p>
                  {t(`workflows.${rule.frequency}`)} · {rule.interval} ·{" "}
                  {rule.timezone}
                </p>
                <button
                  type="button"
                  disabled={busy || !!r.deletedAt || today < rule.startDate}
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
                  disabled={busy}
                  onClick={() => {
                    const {
                      kind: _,
                      schedulerThrough: _cursor,
                      ...input
                    } = rule;
                    return save({
                      id: r.id,
                      version: r.version,
                      deleted: !r.deletedAt,
                      rule: input,
                    });
                  }}
                >
                  {t(r.deletedAt ? "workflows.restore" : "workflows.pause")}
                </button>
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
