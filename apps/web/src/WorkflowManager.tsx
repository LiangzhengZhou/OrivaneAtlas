import {
  type WorkflowRecord,
  type WorkflowService,
} from "@arclattice/application";
import { type WorkItem } from "@arclattice/domain";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { ProjectDrilldownPicker } from "./features/projects/ProjectDrilldownPicker";

export interface WorkflowManagerProps {
  calendarTimezone?: string;
  records: WorkflowRecord[];
  projects: readonly WorkItem[];
  items: readonly WorkItem[];
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
  records,
  projects,
  busy,
  preview,
  publish,
}: WorkflowManagerProps) {
  const { t, i18n } = useTranslation("desk");
  const text = (zh: string, en: string) =>
    i18n.language.startsWith("zh") ? zh : en;
  const [projectId, setProjectId] = useState("");
  const [manifest, setManifest] = useState(
    '{"version":1,"tasks":[{"tempId":"first","title":""}]}',
  );
  const [error, setError] = useState(false);
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
      {" "}
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
            <ProjectDrilldownPicker
              mode="single"
              projects={projects}
              value={projectId || null}
              disabled={busy}
              onChange={(value) =>
                setProjectId(typeof value === "string" ? value : "")
              }
            />
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
    </section>
  );
}
