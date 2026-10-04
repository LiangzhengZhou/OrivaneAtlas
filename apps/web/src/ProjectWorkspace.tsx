import {
  type EntityRef,
  type KnowledgeLink,
  scopedKnowledgeDocuments,
} from "@arclattice/application";
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
import { openGraph } from "./features/graph/graph-route";
import { KnowledgeGraph } from "./features/knowledge/KnowledgeGraph";
import { ProjectDependencyGraph } from "./features/projects/ProjectDependencyGraph";
import { ProjectStructureTree } from "./features/projects/ProjectStructureTree";
import { TasksWorkspace } from "./features/tasks/TasksWorkspace";
import { selectTasks } from "./features/tasks/task-selectors";
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
  onNewPage,
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
  onNewPage(spaceId: string): void;
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
  const { t, i18n } = useTranslation("desk");
  const tab = routeTab;
  const setTab = (tab: ProjectTab) => onRouteChange(tab, scope);
  const scope = routeScope;
  const setScope = (scope: ProjectScope) => onRouteChange(tab, scope);
  const [referenceQuery, setReferenceQuery] = useState("");
  const [knowledgeQuery, setKnowledgeQuery] = useState("");
  const [knowledgeGraphOpen, setKnowledgeGraphOpen] = useState(false);
  const [inspectedId, setInspectedId] = useState(project.id);
  const liveItems = snapshot.items.filter((item) => !item.deletedAt);
  const scoped = projectScope(project, liveItems, scope);
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
    (edge) => taskIds.has(edge.fromId) && taskIds.has(edge.toId),
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
      entry.ref.kind !== "SPACE" &&
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
            {t(`projectHub.${name}`)}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id="project-panel"
        aria-labelledby={`project-tab-${tab}`}
      >
        <div hidden={tab !== "overview"}>
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
            <button
              type="button"
              className="chip"
              onClick={() =>
                openGraph({
                  kind: "project",
                  id: project.id,
                  mode: "structure",
                })
              }
            >
              {t("openGraphWorkspace")}
            </button>
            <ProjectStructureTree
              projects={liveItems}
              parentId={project.id}
              onOpen={onProject}
            />
          </section>

          <ProjectBriefEditor
            dirtyRef={briefDirtyRef}
            project={project}
            busy={busy}
            onSave={onBriefSave}
          />
          <ProjectTimeline
            tasks={[...tasks, ...milestones]}
            items={liveItems}
            onOpen={onOpen}
          />
          <ProjectHistory
            projectId={project.id}
            projectIds={[...projectIds]}
            tasks={[...tasks, ...scoped.projects]}
            edges={edges}
            load={runtime.projectActivity}
            loadWork={runtime.activity}
          />
        </div>
        {tab === "knowledge" && (
          <>
            <details
              onToggle={(event) =>
                setKnowledgeGraphOpen(event.currentTarget.open)
              }
            >
              <summary>
                {i18n.language.startsWith("zh")
                  ? "知识图谱"
                  : "Knowledge graph"}
              </summary>
              {knowledgeGraphOpen && (
                <KnowledgeGraph
                  snapshot={snapshot}
                  projectId={project.id}
                  onOpen={onOpen}
                />
              )}
            </details>
            <input
              aria-label={
                i18n.language.startsWith("zh")
                  ? "搜索项目知识"
                  : "Search project knowledge"
              }
              value={knowledgeQuery}
              onChange={(event) => setKnowledgeQuery(event.target.value)}
            />
            {knowledgeQuery &&
              scopedKnowledgeDocuments({
                ...snapshot,
                projectId: project.id,
                workspaceFallback: true,
              })
                .filter((entry) =>
                  (
                    entry.title +
                    " " +
                    entry.bodyMd +
                    " " +
                    (entry.aliases ?? []).join(" ")
                  )
                    .toLocaleLowerCase()
                    .includes(knowledgeQuery.toLocaleLowerCase()),
                )
                .map((entry) => (
                  <button
                    type="button"
                    className="agenda-item"
                    key={entry.id}
                    onClick={() => onOpen({ kind: "DOCUMENT", id: entry.id })}
                  >
                    {entry.title}
                  </button>
                ))}
            <ProjectMaterials
              library={snapshot.library}
              onCreateSpace={(input) =>
                run(() => runtime.createProjectSpace(input))
              }
              onLinkSpace={(input) =>
                run(() => runtime.linkProjectSpace(input))
              }
              projectId={project.id}
              scopeIds={projectIds}
              projects={scoped.projects}
              materials={snapshot.projectMaterials ?? []}
              inheritedSpaces={(snapshot.projectMaterials ?? []).filter(
                (material) =>
                  material.kind === "SPACE" &&
                  !material.deletedAt &&
                  material.inheritToChildren &&
                  projectAncestors(project, liveItems).some(
                    (ancestor) => ancestor.id === material.projectId,
                  ) &&
                  !(snapshot.projectMaterials ?? []).some(
                    (direct) =>
                      direct.projectId === project.id &&
                      !direct.deletedAt &&
                      direct.targetId === material.targetId,
                  ),
              )}
              busy={busy}
              onOpen={onOpen}
              onNewPage={onNewPage}
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
              <label>
                {t("projectHub.chooseDocument")}
                <input
                  type="search"
                  value={referenceQuery}
                  onChange={(event) => setReferenceQuery(event.target.value)}
                />
              </label>
              {referenceQuery &&
                available
                  .filter((entry) =>
                    entry.title
                      .toLocaleLowerCase()
                      .includes(referenceQuery.toLocaleLowerCase()),
                  )
                  .slice(0, 20)
                  .map((entry) => (
                    <button
                      type="button"
                      key={entry.ref.kind + ":" + entry.ref.id}
                      disabled={busy}
                      onClick={() =>
                        void onLink(
                          { kind: "WORK", id: project.id },
                          entry.ref,
                        ).then((ok) => {
                          if (ok) setReferenceQuery("");
                        })
                      }
                    >
                      {entry.title}
                    </button>
                  ))}
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
        {tab === "tasks" && (
          <>
            <p className="muted">{t("inspectHint")}</p>
            <div className="project-canvas-layout">
              <ProjectDependencyGraph
                initialFocus={
                  snapshot.items.some(
                    (i) => i.id === inspectedId && i.type === "TASK",
                  )
                    ? inspectedId
                    : ""
                }
                onWorkspace={() =>
                  openGraph({
                    kind: "project",
                    id: project.id,
                    mode: "dependencies",
                    focus: snapshot.items.some(
                      (i) => i.id === inspectedId && i.type === "TASK",
                    )
                      ? inspectedId
                      : "",
                    selection: inspectedId,
                  })
                }
                inspector={
                  <ProjectInspector
                    item={
                      graphSnapshot.items.find(
                        (item) => item.id === inspectedId,
                      ) ?? project
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
                }
                snapshot={graphSnapshot}
                fullSnapshot={snapshot}
                onOpen={onOpen}
                onSelect={(ref) => setInspectedId(ref.id)}
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
