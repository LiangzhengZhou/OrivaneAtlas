import type { EntityRef, KnowledgeLink } from "@arclattice/application";
import { projectDescendants, type WorkItem } from "@arclattice/domain";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Runtime, Snapshot } from "./bootstrap";
import { GraphCanvas } from "./GraphCanvas";
import { Markdown } from "./Markdown";
import {
  ProjectHistory,
  ProjectMaterials,
  ProjectTimeline,
} from "./ProjectMaterials";
import { Dependencies } from "./WorkViews";

export function ProjectWorkspace({
  project,
  snapshot,
  busy,
  onBack,
  onProject,
  onOpen,
  onCreate,
  onLink,
  onUnlink,
  onAddEdge,
  onRemoveEdge,
  runtime,
  run,
}: {
  project: WorkItem;
  snapshot: Snapshot;
  busy: boolean;
  onBack(): void;
  onProject(id: string): void;
  onOpen(ref: EntityRef): void;
  onCreate(type: "PROJECT" | "TASK", parentId: string): void;
  onLink(from: EntityRef, to: EntityRef): Promise<boolean>;
  onUnlink(link: KnowledgeLink): Promise<boolean>;
  onAddEdge(from: string, to: string): Promise<boolean>;
  onRemoveEdge(id: string): Promise<boolean>;
  runtime: Runtime;
  run(operation: () => Promise<unknown>): Promise<boolean>;
}) {
  const { t } = useTranslation("desk");
  const [tab, setTab] = useState("brief");
  const [target, setTarget] = useState("");
  const liveItems = snapshot.items.filter((item) => !item.deletedAt);
  const children = liveItems.filter(
    (item) => item.type === "PROJECT" && item.projectId === project.id,
  );
  const tasks = projectDescendants(project, liveItems).filter(
    (item) => item.type !== "PROJECT",
  );
  const taskIds = new Set(tasks.map((item) => item.id));
  const edges = snapshot.edges.filter(
    (edge) => taskIds.has(edge.fromId) || taskIds.has(edge.toId),
  );
  const graphIds = new Set([
    ...taskIds,
    ...edges.flatMap((edge) => [edge.fromId, edge.toId]),
  ]);
  const graphSnapshot = {
    ...snapshot,
    items: liveItems.filter((item) => graphIds.has(item.id)),
    edges,
  };
  const materials = [
    ...snapshot.notes
      .filter((note) => !note.deletedAt)
      .map((note) => ({
        ref: { kind: "NOTE" as const, id: note.id },
        title: note.title,
      })),
    ...snapshot.library
      .filter(
        (entry) =>
          !entry.deletedAt &&
          (entry.kind === "SPACE" ||
            snapshot.library.some(
              (parent) => parent.id === entry.spaceId && !parent.deletedAt,
            )),
      )
      .map((entry) => ({
        ref: { kind: entry.kind, id: entry.id },
        title: entry.title,
      })),
  ];
  const references = snapshot.links.filter(
    (link) =>
      link.from.kind === "WORK" &&
      link.from.id === project.id &&
      link.relation === "REFERENCES",
  );
  const linked = materials.filter((entry) =>
    references.some(
      (link) => link.to.kind === entry.ref.kind && link.to.id === entry.ref.id,
    ),
  );
  const available = materials.filter((entry) => !linked.includes(entry));
  const parent = liveItems.find((item) => item.id === project.projectId);
  return (
    <section className="project-workspace">
      <div className="organization-toolbar">
        <button type="button" className="chip" onClick={onBack}>
          {t("projectHub.back")}
        </button>
        {parent && (
          <button
            type="button"
            className="chip"
            onClick={() => onProject(parent.id)}
          >
            {t("parentProject")} · {parent.title}
          </button>
        )}
      </div>
      <div className="panel project-summary">
        <h1>{project.title}</h1>
        <p className="muted">
          {t("projectHub.summary", {
            children: children.length,
            documents:
              linked.length +
              (snapshot.projectMaterials ?? []).filter(
                (entry) =>
                  entry.projectId === project.id &&
                  entry.kind !== "SPACE" &&
                  !entry.deletedAt,
              ).length,
            tasks: tasks.length,
          })}
        </p>
        <div className="organization-toolbar">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => onOpen({ kind: "WORK", id: project.id })}
          >
            {t("projectHub.edit")}
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => onCreate("PROJECT", project.id)}
          >
            {t("projectHub.newChild")}
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => onCreate("TASK", project.id)}
          >
            {t("newTask")}
          </button>
        </div>
      </div>
      <div
        className="organization-toolbar"
        role="tablist"
        aria-label={t("projectHub.sections")}
      >
        {[
          "brief",
          "documents",
          "children",
          "tasks",
          "graph",
          "timeline",
          "activity",
        ].map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            id={`project-tab-${name}`}
            aria-controls="project-panel"
            aria-selected={tab === name}
            className="chip"
            onClick={() => setTab(name)}
          >
            {name === "timeline"
              ? t("projectTimeline")
              : name === "activity"
                ? t("projectActivity")
                : t(`projectHub.${name}`)}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id="project-panel"
        aria-labelledby={`project-tab-${tab}`}
      >
        {tab === "brief" && (
          <section className="panel project-summary">
            <Markdown
              text={project.descriptionMd || t("projectHub.emptyBrief")}
            />
          </section>
        )}
        {tab === "documents" && (
          <>
            <ProjectMaterials
              projectId={project.id}
              materials={snapshot.projectMaterials ?? []}
              busy={busy}
              onOpen={onOpen}
              onCreate={(input) => run(() => runtime.projectDocument(input))}
              onUpload={(input) => run(() => runtime.projectUpload(input))}
              onDelete={(material, deleted) =>
                run(() =>
                  runtime.projectDelete(material.id, material.version, deleted),
                )
              }
              onDownload={async (id) => {
                await run(async () => {
                  const result = await runtime.projectFile(id);
                  const bytes = Uint8Array.from(atob(result.base64), (char) =>
                    char.charCodeAt(0),
                  );
                  const url = URL.createObjectURL(
                    new Blob([bytes], { type: "application/octet-stream" }),
                  );
                  const anchor = document.createElement("a");
                  anchor.href = url;
                  anchor.download = result.material.title;
                  anchor.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                });
              }}
            />
            <section className="panel project-summary">
              <p>{t("projectHub.documentsHint")}</p>
              <form
                className="organization-toolbar"
                onSubmit={(event) => {
                  event.preventDefault();
                  const entry = available.find(
                    (entry) => `${entry.ref.kind}:${entry.ref.id}` === target,
                  );
                  if (entry)
                    void onLink(
                      { kind: "WORK", id: project.id },
                      entry.ref,
                    ).then((ok) => {
                      if (ok) setTarget("");
                    });
                }}
              >
                <label>
                  {t("projectHub.chooseDocument")}
                  <select
                    aria-label={t("projectHub.chooseDocument")}
                    required
                    value={target}
                    onChange={(event) => setTarget(event.target.value)}
                  >
                    <option value="">{t("projectHub.chooseDocument")}</option>
                    {available.map((entry) => (
                      <option
                        key={`${entry.ref.kind}:${entry.ref.id}`}
                        value={`${entry.ref.kind}:${entry.ref.id}`}
                      >
                        {entry.title}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="submit"
                  className="button secondary"
                  disabled={busy || !target}
                >
                  {t("projectHub.attach")}
                </button>
              </form>
              {!linked.length && (
                <p className="empty-small">{t("projectHub.emptyDocuments")}</p>
              )}
              {linked.map((entry) => (
                <div
                  className="project-material"
                  key={`${entry.ref.kind}:${entry.ref.id}`}
                >
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => onOpen(entry.ref)}
                  >
                    {entry.title}
                  </button>
                  <button
                    type="button"
                    className="chip"
                    disabled={busy}
                    onClick={() => {
                      const link = references.find(
                        (link) =>
                          link.to.kind === entry.ref.kind &&
                          link.to.id === entry.ref.id,
                      );
                      if (link) void onUnlink(link);
                    }}
                  >
                    {t("projectHub.detach")}
                  </button>
                </div>
              ))}
            </section>
          </>
        )}
        {tab === "timeline" && (
          <ProjectTimeline tasks={tasks} onOpen={onOpen} />
        )}
        {tab === "activity" && (
          <ProjectHistory
            projectId={project.id}
            tasks={tasks}
            load={runtime.projectActivity}
            loadWork={runtime.activity}
          />
        )}
        {tab === "children" && (
          <section className="panel project-summary">
            {!children.length && <p>{t("projectHub.emptyChildren")}</p>}
            {children.map((child) => (
              <button
                type="button"
                className="agenda-item"
                key={child.id}
                onClick={() => onProject(child.id)}
              >
                <strong>{child.title}</strong>
                <small>{t("work:statuses." + child.status)}</small>
              </button>
            ))}
          </section>
        )}
        {tab === "tasks" && (
          <section className="panel project-summary">
            <p className="muted">{t("recursiveProgress")}</p>
            {!tasks.length && <p>{t("projectHub.emptyTasks")}</p>}
            {tasks.map((task) => (
              <button
                type="button"
                className="agenda-item"
                key={task.id}
                onClick={() => onOpen({ kind: "WORK", id: task.id })}
              >
                <strong>{task.title}</strong>
                <small>{t("work:statuses." + task.status)}</small>
              </button>
            ))}
          </section>
        )}
        {tab === "graph" && (
          <>
            <p className="muted">{t("projectHub.graphHint")}</p>
            <GraphCanvas
              snapshot={graphSnapshot}
              tasks
              onOpen={onOpen}
              onConnect={(from, to) => onAddEdge(from.id, to.id)}
              onRemove={onRemoveEdge}
            />
            <Dependencies
              items={graphSnapshot.items}
              edges={edges}
              busy={busy}
              onAdd={onAddEdge}
              onRemove={onRemoveEdge}
            />
          </>
        )}
      </div>
    </section>
  );
}
