import type { EntityRef, KnowledgeLink } from "@arclattice/application";
import {
  effectiveCategoryId,
  type ProjectScope,
  projectAncestors,
  projectLifecycle,
  projectScope,
  type WorkItem,
  type WorkStatus,
} from "@arclattice/domain";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Runtime, Snapshot } from "./bootstrap";
import { TasksWorkspace } from "./features/tasks/TasksWorkspace";
import { selectTasks } from "./features/tasks/task-selectors";
import { GraphCanvas } from "./GraphCanvas";
import { ProjectBriefEditor } from "./ProjectBriefEditor";
import { ProjectInspector } from "./ProjectInspector";
import {
  ProjectHistory,
  ProjectMaterials,
  ProjectTimeline,
} from "./ProjectMaterials";
import { type ProjectTab, projectTabs } from "./projectRoute";
import { Dependencies } from "./WorkViews";

export function ProjectWorkspace({
  today,
  isArchived,
  archiveSource,
  project,
  routeTab,
  routeScope,
  onRouteChange,
  snapshot,
  busy,
  briefDirtyRef,
  onBriefSave,
  onBack,
  onProject,
  onOpen,
  onCreate,
  onLink,
  onUnlink,
  onAddEdge,
  onRemoveEdge,
  onStatus,
  onOrganize,
  runtime,
  run,
}: {
  today: string;
  isArchived(item: WorkItem): boolean;
  archiveSource(item: WorkItem): WorkItem | undefined;
  project: WorkItem;
  routeTab: ProjectTab;
  routeScope: ProjectScope;
  onRouteChange(tab: ProjectTab, scope: ProjectScope): void;
  snapshot: Snapshot;
  busy: boolean;
  briefDirtyRef: { current: boolean };
  onBriefSave(base: WorkItem, markdown: string): Promise<boolean>;
  onBack(): void;
  onProject(id: string): void;
  onOpen(ref: EntityRef): void;
  onCreate(type: "PROJECT" | "TASK" | "MILESTONE", parentId: string): void;
  onLink(from: EntityRef, to: EntityRef): Promise<boolean>;
  onUnlink(link: KnowledgeLink): Promise<boolean>;
  onAddEdge(from: string, to: string): Promise<boolean>;
  onRemoveEdge(id: string): Promise<boolean>;
  onStatus(item: WorkItem, status: WorkStatus): Promise<boolean>;
  onOrganize(item: WorkItem, action: "archive" | "unarchive" | "delete"): void;
  runtime: Runtime;
  run(operation: () => Promise<unknown>): Promise<boolean>;
}) {
  const { t } = useTranslation("desk");
  const tab = routeTab;
  const setTab = (tab: ProjectTab) => onRouteChange(tab, scope);
  const scope = routeScope;
  const setScope = (scope: ProjectScope) => onRouteChange(tab, scope);
  const [target, setTarget] = useState("");
  const [inspectedId, setInspectedId] = useState(project.id);
  const liveItems = snapshot.items.filter((item) => !item.deletedAt);
  const scoped = projectScope(project, liveItems, scope);
  const children =
    scope === "DIRECT"
      ? liveItems.filter(
          (item) =>
            item.type === "PROJECT" && item.parentProjectId === project.id,
        )
      : scoped.projects.filter((item) => item.id !== project.id);
  const tasks = scoped.tasks;
  const selectedTasks = selectTasks(
    liveItems,
    snapshot.edges,
    today,
    isArchived,
  );
  const milestones = liveItems.filter(
    (item) =>
      item.type === "MILESTONE" &&
      !!item.parentProjectId &&
      scoped.projectIds.has(item.parentProjectId),
  );
  const taskIds = new Set(tasks.map((item) => item.id));
  const projectIds = scoped.projectIds;
  const edges = snapshot.edges.filter(
    (edge) => taskIds.has(edge.fromId) || taskIds.has(edge.toId),
  );
  const graphIds = new Set([
    project.id,
    ...projectIds,
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
      projectIds.has(link.from.id) &&
      link.relation === "REFERENCES",
  );
  const linked = references.flatMap((link) => {
    const entry = materials.find(
      (entry) => entry.ref.kind === link.to.kind && entry.ref.id === link.to.id,
    );
    return entry ? [{ ...entry, link }] : [];
  });
  const available = materials.filter(
    (entry) =>
      !linked.some(
        (linked) =>
          linked.ref.id === entry.ref.id &&
          linked.ref.kind === entry.ref.kind &&
          linked.link.from.id === project.id,
      ),
  );
  const parent = liveItems.find((item) => item.id === project.parentProjectId);
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
        <nav aria-label={t("projectBreadcrumb")} className="project-breadcrumb">
          {projectAncestors(project, liveItems)
            .reverse()
            .map((ancestor) => (
              <button
                type="button"
                className="text-button"
                key={ancestor.id}
                aria-label={ancestor.title}
                onClick={() => onProject(ancestor.id)}
              >
                {ancestor.title}
              </button>
            ))}
          <span aria-current="page">{project.title}</span>
        </nav>
        <h1>{project.title}</h1>
        <p>{t("projectLifecycles." + projectLifecycle(project))}</p>
        <p>
          {
            snapshot.categories?.find(
              (category) =>
                !category.deletedAt &&
                category.id === effectiveCategoryId(project, liveItems),
            )?.name
          }
        </p>
        <label className="field project-scope">
          <span>{t("projectScope")}</span>
          <select
            aria-label={t("projectScope")}
            value={scope}
            onChange={(event) => setScope(event.target.value as ProjectScope)}
          >
            <option value="DIRECT">{t("scopeDirect")}</option>
            <option value="SUBTREE">{t("scopeSubtree")}</option>
          </select>
        </label>
        <p className="muted" data-testid="project-progress">
          {t("projectProgress", {
            completed: scoped.completed,
            canceled: scoped.canceled,
            unfinished: scoped.unfinished,
          })}
        </p>
        <div className="organization-toolbar">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => onOpen({ kind: "WORK", id: project.id })}
          >
            {t("projectSettings")}
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
        {projectTabs.map((name) => (
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
        <div hidden={tab !== "brief"}>
          <section className="project-next">
            <h2>{t("taskWorkspace.now")}</h2>
            {selectedTasks.focusTasks
              .filter((task) => taskIds.has(task.id))
              .slice(0, 5)
              .map((task) => (
                <button
                  key={task.id}
                  type="button"
                  className="agenda-item"
                  onClick={() => onOpen({ kind: "WORK", id: task.id })}
                >
                  {task.title}
                </button>
              ))}
          </section>
          <section className="project-milestones">
            <h2>{t("milestones")}</h2>
            {milestones.map((milestone) => (
              <button
                key={milestone.id}
                type="button"
                className="agenda-item"
                onClick={() => onOpen({ kind: "WORK", id: milestone.id })}
              >
                <span>
                  {milestone.status === "DONE"
                    ? "✓"
                    : milestone.status === "IN_PROGRESS"
                      ? "●"
                      : "○"}
                </span>{" "}
                {milestone.title}
              </button>
            ))}
            <button
              type="button"
              className="chip"
              disabled={busy}
              onClick={() => onCreate("MILESTONE", project.id)}
            >
              {t("newMilestone")}
            </button>
          </section>
          <progress
            aria-label={t("completion")}
            max={Math.max(1, scoped.completed + scoped.unfinished)}
            value={scoped.completed}
          />
          <section>
            <h2>{t("projectHub.children")}</h2>
            {children.map((child) => (
              <button
                type="button"
                className="agenda-item"
                key={child.id}
                onClick={() => onProject(child.id)}
              >
                {child.title}
              </button>
            ))}
          </section>

          <ProjectBriefEditor
            dirtyRef={briefDirtyRef}
            project={project}
            busy={busy}
            onSave={onBriefSave}
          />
        </div>
        {tab === "documents" && (
          <>
            <ProjectMaterials
              projectId={project.id}
              scopeIds={projectIds}
              projects={scoped.projects}
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
                  <small>
                    {liveItems.find((p) => p.id === entry.link.from.id)?.title}
                  </small>
                  <button
                    type="button"
                    className="chip"
                    disabled={busy}
                    onClick={() => {
                      void onUnlink(entry.link);
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
          <ProjectTimeline
            tasks={[...tasks, ...milestones]}
            items={liveItems}
            onOpen={onOpen}
          />
        )}
        {tab === "activity" && (
          <ProjectHistory
            projectId={project.id}
            projectIds={[...projectIds]}
            tasks={[...tasks, ...scoped.projects]}
            edges={edges}
            load={runtime.projectActivity}
            loadWork={runtime.activity}
          />
        )}
        {tab === "tasks" && (
          <TasksWorkspace
            items={tasks}
            allItems={liveItems}
            edges={snapshot.edges}
            today={today}
            busy={busy}
            isArchived={isArchived}
            archiveSource={archiveSource}
            onOrganize={onOrganize}
            onStatus={onStatus}
            onOpen={(item) => onOpen({ kind: "WORK", id: item.id })}
          />
        )}
        {tab === "graph" && (
          <>
            <p className="muted">{t("projectHub.graphHint")}</p>
            <p className="muted">{t("inspectHint")}</p>
            <label className="field">
              <span>{t("inspector")}</span>
              <select
                className="inspector-selection"
                value={inspectedId}
                onChange={(event) => setInspectedId(event.target.value)}
              >
                {graphSnapshot.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
            <div className="project-canvas-layout">
              <GraphCanvas
                snapshot={graphSnapshot}
                tasks
                onOpen={onOpen}
                onSelect={(ref) => setInspectedId(ref.id)}
                onConnect={(from, to) => onAddEdge(from.id, to.id)}
                onRemove={onRemoveEdge}
              />
              <ProjectInspector
                item={
                  graphSnapshot.items.find((item) => item.id === inspectedId) ??
                  project
                }
                snapshot={snapshot}
                busy={busy}
                runtime={runtime}
                run={run}
                onEdit={() =>
                  onOpen({
                    kind: "WORK",
                    id:
                      graphSnapshot.items.find(
                        (item) => item.id === inspectedId,
                      )?.id ?? project.id,
                  })
                }
                onProject={onProject}
                onStatus={onStatus}
                onOrganize={onOrganize}
              />
            </div>
            <Dependencies
              scopeIds={taskIds}
              items={graphSnapshot.items}
              edges={edges}
              busy={busy}
              onAdd={(from, to) =>
                taskIds.has(from) || taskIds.has(to)
                  ? onAddEdge(from, to)
                  : Promise.resolve(false)
              }
              onRemove={onRemoveEdge}
            />
          </>
        )}
      </div>
    </section>
  );
}
