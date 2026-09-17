import type { WorkflowRecord, WorkflowService } from "@arclattice/application";
import { localCalendarDay, type WorkItem } from "@arclattice/domain";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  records: WorkflowRecord[];
  projects: WorkItem[];
  busy: boolean;
  preview(projectId: string, manifest: unknown): Promise<boolean>;
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
  records,
  projects,
  busy,
  preview,
  publish,
  save,
  generate,
  backfill,
}: Props) {
  const { t } = useTranslation("desk");
  const [projectId, setProjectId] = useState(""),
    [manifest, setManifest] = useState(
      '{"version":1,"tasks":[{"tempId":"first","title":""}]}',
    );
  const [error, setError] = useState(false),
    [title, setTitle] = useState(""),
    [startDate, setStartDate] = useState(
      localCalendarDay(
        new Date().toISOString(),
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      ),
    );
  const [timezone, setTimezone] = useState(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    ),
    [frequency, setFrequency] = useState<"DAILY" | "WEEKLY" | "MONTHLY">(
      "DAILY",
    ),
    [interval, setInterval] = useState(1);
  const [completed, setCompleted] = useState<Record<string, string>>({});
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
            await preview(projectId, value);
          }}
        >
          <label>
            {t("workflows.project")}
            <select
              aria-label={t("workflows.project")}
              required
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
                    </li>
                  ))}
                </ol>
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
                version: 0,
                deleted: false,
                rule: {
                  title,
                  descriptionMd: "",
                  projectId: projectId || null,
                  startDate,
                  timezone,
                  frequency,
                  interval,
                },
              })
            )
              setTitle("");
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
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">{t("workflows.noProject")}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={busy}>
            {t("workflows.save")}
          </button>
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
