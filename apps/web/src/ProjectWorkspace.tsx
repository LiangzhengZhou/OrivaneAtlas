import {
  type EntityRef,
  type KnowledgeLink,
  scopedKnowledgeDocuments,
} from "@arclattice/application";
import {
  effectiveCategoryId,
  type ProjectScope,
  projectLifecycle,
  projectScope,
  type WorkItem,
  type WorkStatus,
} from "@arclattice/domain";
import { MoreHorizontal } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useEntitySelection } from "./app/EntitySelection";
import type { Runtime, Snapshot } from "./bootstrap";
import { Button, IconButton, Toolbar } from "./components/ui/Button";
import { ListRow, MenuItem } from "./components/ui/Content";
import { Menu, Popover, Select } from "./components/ui/Surfaces";
import { openGraph } from "./features/graph/graph-route";
import { KnowledgeGraph } from "./features/knowledge/KnowledgeGraph";
import { ProjectDependencyGraph } from "./features/projects/ProjectDependencyGraph";
import { ProjectStructureTree } from "./features/projects/ProjectStructureTree";
import {
  type TaskPresentation,
  TasksWorkspace,
} from "./features/tasks/TasksWorkspace";
import { type TaskWorkspaceIndex } from "./features/tasks/task-selectors";
import type { WorkspaceWorkIndex } from "./features/tasks/workspace-work-index";
import {
  ProjectBriefEditor,
  type ProjectBriefState,
} from "./ProjectBriefEditor";
import { ProjectInspector } from "./ProjectInspector";
import {
  ProjectHistory,
  ProjectMaterials,
  ProjectTimeline,
} from "./ProjectMaterials";
import { type ProjectTab, projectTabs } from "./projectRoute";
import { Dependencies } from "./WorkViews";

export function ProjectWorkspace({
  workIndex,
  taskIndex,
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
  taskPresentation,
  onTaskPresentationChange,
}: {
  workIndex: WorkspaceWorkIndex;
  taskIndex: TaskWorkspaceIndex;
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
  taskPresentation: TaskPresentation;
  onTaskPresentationChange(state: TaskPresentation): void;
}) {
  const { t, i18n } = useTranslation("desk");
  const selection = useEntitySelection();
  const headerMenuAnchor = useRef<HTMLButtonElement>(null);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const taskFilterAnchor = useRef<HTMLButtonElement>(null);
  const [taskFilterOpen, setTaskFilterOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const headerMenuLabel = i18n.language.startsWith("zh")
    ? "项目更多操作"
    : "More project actions";
  const tab = routeTab;
  const setTab = (tab: ProjectTab) => onRouteChange(tab, scope);
  const scope = routeScope;
  const setScope = (scope: ProjectScope) => onRouteChange(tab, scope);
  const [referenceQuery, setReferenceQuery] = useState("");
  const briefState = useRef<ProjectBriefState>({ draft: null, mode: "live" });
  const [knowledgeQuery, setKnowledgeQuery] = useState("");
  const [knowledgeGraphOpen, setKnowledgeGraphOpen] = useState(false);
  const [dependencyOpen, setDependencyOpen] = useState(false);
  const [dependencyState, setDependencyState] = useState({
    focus: "",
    hops: 1,
    scope: "focus",
    taskScope:
      "DIRECT_PROJECT" as import("./features/graph/graph-scope").ProjectTaskScope,
    includeExternal: false,
  });
  const [inspectedId, setInspectedId] = useState(project.id);
  const liveItems = useMemo(
    () => snapshot.items.filter((item) => !item.deletedAt),
    [snapshot.items],
  );
  const scoped = useMemo(
    () => projectScope(project, liveItems, scope),
    [project, liveItems, scope],
  );
  const ancestors = useMemo(
    () =>
      (workIndex.ancestorIdsByProjectId.get(project.id) ?? []).flatMap((id) => {
        const value = workIndex.projectsById.get(id);
        return value ? [value] : [];
      }),
    [workIndex, project.id],
  );
  const ancestorIds = useMemo(
    () => new Set(ancestors.map((entry) => entry.id)),
    [ancestors],
  );
  const inheritedMaterials = useMemo(() => {
    const entries = snapshot.projectMaterials ?? [];
    const directTargets = new Set(
      entries
        .filter((entry) => entry.projectId === project.id && !entry.deletedAt)
        .map((entry) => entry.targetId),
    );
    return entries.filter(
      (entry) =>
        entry.kind === "SPACE" &&
        !entry.deletedAt &&
        entry.inheritToChildren &&
        ancestorIds.has(entry.projectId) &&
        !directTargets.has(entry.targetId),
    );
  }, [snapshot.projectMaterials, project.id, ancestorIds]);
  const tasks = scoped.tasks;
  const recentKnowledge = useMemo(
    () =>
      tab === "overview"
        ? scopedKnowledgeDocuments({
            ...snapshot,
            projectId: project.id,
            workspaceFallback: false,
          })
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .slice(0, 3)
        : [],
    [snapshot, project.id, tab],
  );
  const selectedTasks = taskIndex;
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
  const materials = useMemo(() => {
    if (tab !== "knowledge") return [];
    const liveSpaces = new Set(
      snapshot.library
        .filter((entry) => entry.kind === "SPACE" && !entry.deletedAt)
        .map((entry) => entry.id),
    );
    return [
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
              (!!entry.spaceId && liveSpaces.has(entry.spaceId))),
        )
        .map((entry) => ({
          ref: { kind: entry.kind, id: entry.id },
          title: entry.title,
        })),
    ];
  }, [snapshot.notes, snapshot.library, tab]);
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
  const parent = workIndex.projectsById.get(project.parentProjectId ?? "");
  return (
    <section className="project-workspace">
      <div className="panel project-summary">
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
        <p className="muted" data-testid="project-progress">
          {t("projectProgress", {
            completed: scoped.completed,
            canceled: scoped.canceled,
            unfinished: scoped.unfinished,
          })}
        </p>
        <Toolbar>
          <Button
            type="button"
            variant="primary"
            disabled={busy}
            onClick={() => onCreate("TASK", project.id)}
          >
            {t("newTask")}
          </Button>
          <IconButton
            ref={headerMenuAnchor}
            label={headerMenuLabel}
            aria-haspopup="menu"
            aria-expanded={headerMenuOpen}
            onClick={() => setHeaderMenuOpen((open) => !open)}
          >
            <MoreHorizontal />
          </IconButton>
          {headerMenuOpen && (
            <Menu
              anchorRef={headerMenuAnchor}
              label={headerMenuLabel}
              onDismiss={() => setHeaderMenuOpen(false)}
            >
              <MenuItem
                onClick={() => {
                  setHeaderMenuOpen(false);
                  onBack();
                }}
              >
                {t("projectHub.back")}
              </MenuItem>
              {parent && (
                <MenuItem
                  onClick={() => {
                    setHeaderMenuOpen(false);
                    onProject(parent.id);
                  }}
                >
                  {t("parentProject")} · {parent.title}
                </MenuItem>
              )}
              <MenuItem
                disabled={busy}
                onClick={() => {
                  setHeaderMenuOpen(false);
                  onOpen({ kind: "WORK", id: project.id });
                }}
              >
                {t("projectSettings")}
              </MenuItem>
              <MenuItem
                disabled={busy}
                onClick={() => {
                  setHeaderMenuOpen(false);
                  onCreate("PROJECT", project.id);
                }}
              >
                {t("projectHub.newChild")}
              </MenuItem>
              <MenuItem
                disabled={busy}
                onClick={() => {
                  setHeaderMenuOpen(false);
                  onCreate("MILESTONE", project.id);
                }}
              >
                {t("newMilestone")}
              </MenuItem>
            </Menu>
          )}
        </Toolbar>
      </div>
      <div
        className="organization-toolbar"
        role="tablist"
        aria-label={t("projectHub.sections")}
      >
        {projectTabs.map((name) => (
          <Button
            key={name}
            type="button"
            role="tab"
            id={`project-tab-${name}`}
            aria-controls="project-panel"
            aria-selected={tab === name}
            variant="toggle"
            onClick={() => setTab(name)}
          >
            {t(`projectHub.${name}`)}
          </Button>
        ))}
      </div>
      <div
        role="tabpanel"
        id="project-panel"
        aria-labelledby={`project-tab-${tab}`}
      >
        {tab === "overview" && (
          <div>
            <section className="project-next">
              <h2>{t("taskWorkspace.now")}</h2>
              {selectedTasks.focusTasks
                .filter((task) => taskIds.has(task.id))
                .slice(0, 5)
                .map((task) => (
                  <ListRow
                    key={task.id}
                    className="agenda-item"
                    onSelect={() =>
                      selection?.select({ kind: "WORK", id: task.id })
                    }
                    onOpen={() => onOpen({ kind: "WORK", id: task.id })}
                  >
                    {task.title}
                  </ListRow>
                ))}
            </section>
            {tasks.some(
              (task) =>
                task.status === "TODO" &&
                (selectedTasks.derived.blockersByTaskId.get(task.id)?.length ??
                  0) > 0,
            ) && (
              <section className="project-blockers">
                <h2>
                  {i18n.language.startsWith("zh") ? "受阻任务" : "Blockers"}
                </h2>
                {tasks
                  .filter(
                    (task) =>
                      task.status === "TODO" &&
                      (selectedTasks.derived.blockersByTaskId.get(task.id)
                        ?.length ?? 0) > 0,
                  )
                  .slice(0, 5)
                  .map((task) => (
                    <ListRow
                      key={task.id}
                      onSelect={() =>
                        selection?.select({ kind: "WORK", id: task.id })
                      }
                      onOpen={() => onOpen({ kind: "WORK", id: task.id })}
                    >
                      {task.title}
                      <small>
                        {(
                          selectedTasks.derived.blockersByTaskId.get(task.id) ??
                          []
                        )
                          .map((id) => workIndex.itemsById.get(id)?.title)
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    </ListRow>
                  ))}
              </section>
            )}
            <section className="project-milestones">
              <h2>{t("milestones")}</h2>
              {milestones.map((milestone) => (
                <Button
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
                </Button>
              ))}
              <Button
                type="button"
                variant="toggle"
                disabled={busy}
                onClick={() => onCreate("MILESTONE", project.id)}
              >
                {t("newMilestone")}
              </Button>
            </section>
            <progress
              aria-label={t("completion")}
              max={Math.max(1, scoped.completed + scoped.unfinished)}
              value={scoped.completed}
            />
            <section>
              <h2>{t("projectHub.children")}</h2>
              <Button
                type="button"
                variant="toggle"
                onClick={() =>
                  openGraph({
                    kind: "project",
                    id: project.id,
                    mode: "structure",
                  })
                }
              >
                {t("openGraphWorkspace")}
              </Button>
              <ProjectStructureTree
                projects={liveItems}
                parentId={project.id}
                onOpen={onProject}
              />
            </section>

            <ProjectBriefEditor
              retained={briefState}
              dirtyRef={briefDirtyRef}
              project={project}
              busy={busy}
              onSave={onBriefSave}
            />
            {recentKnowledge.length > 0 && (
              <section className="project-recent-knowledge">
                <h2>{t("projectHub.knowledge")}</h2>
                {recentKnowledge.map((entry) => (
                  <ListRow
                    key={entry.id}
                    onSelect={() =>
                      selection?.select({ kind: "DOCUMENT", id: entry.id })
                    }
                    onOpen={() => onOpen({ kind: "DOCUMENT", id: entry.id })}
                  >
                    {entry.title}
                  </ListRow>
                ))}
              </section>
            )}
            <details
              onToggle={(event) => setTimelineOpen(event.currentTarget.open)}
            >
              <summary>
                {i18n.language.startsWith("zh")
                  ? "项目时间线"
                  : "Project timeline"}
              </summary>
              {timelineOpen && (
                <ProjectTimeline
                  tasks={[...tasks, ...milestones]}
                  items={liveItems}
                  onOpen={onOpen}
                />
              )}
            </details>
            <ProjectHistory
              projectId={project.id}
              projectIds={[...projectIds]}
              tasks={[...tasks, ...scoped.projects]}
              edges={edges}
              load={runtime.projectActivity}
              loadWork={runtime.activity}
            />
          </div>
        )}
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
                  <Button
                    type="button"
                    className="agenda-item"
                    key={entry.id}
                    onClick={() => onOpen({ kind: "DOCUMENT", id: entry.id })}
                  >
                    {entry.title}
                  </Button>
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
              inheritedSpaces={inheritedMaterials}
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
                    <Button
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
                    </Button>
                  ))}
              {!linked.length && (
                <p className="empty-small">{t("projectHub.emptyDocuments")}</p>
              )}
              {linked.map((entry) => (
                <div
                  className="project-material"
                  key={`${entry.ref.kind}:${entry.ref.id}`}
                >
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => onOpen(entry.ref)}
                  >
                    {entry.title}
                  </Button>
                  <small>
                    {liveItems.find((p) => p.id === entry.link.from.id)?.title}
                  </small>
                  <Button
                    type="button"
                    variant="toggle"
                    disabled={busy}
                    onClick={() => {
                      void onUnlink(entry.link);
                    }}
                  >
                    {t("projectHub.detach")}
                  </Button>
                </div>
              ))}
            </section>
          </>
        )}
        {tab === "tasks" && (
          <TasksWorkspace
            filterControls={
              <>
                <Button
                  ref={taskFilterAnchor}
                  variant="ghost"
                  aria-haspopup="dialog"
                  aria-expanded={taskFilterOpen}
                  onClick={() => setTaskFilterOpen((open) => !open)}
                >
                  {i18n.language.startsWith("zh") ? "任务筛选" : "Task filters"}
                </Button>
                {taskFilterOpen && (
                  <Popover
                    anchorRef={taskFilterAnchor}
                    label={
                      i18n.language.startsWith("zh")
                        ? "任务筛选"
                        : "Task filters"
                    }
                    onDismiss={() => setTaskFilterOpen(false)}
                  >
                    <label className="project-scope">
                      <span>{t("projectScope")}</span>
                      <Select
                        aria-label={t("projectScope")}
                        value={scope}
                        onChange={(event) =>
                          setScope(event.target.value as ProjectScope)
                        }
                      >
                        <option value="DIRECT">{t("scopeDirect")}</option>
                        <option value="SUBTREE">{t("scopeSubtree")}</option>
                      </Select>
                    </label>
                  </Popover>
                )}
              </>
            }
            presentation={taskPresentation}
            onPresentationChange={onTaskPresentationChange}
            timelineMode="gantt"
            taskIndex={selectedTasks}
            derived={selectedTasks.derived}
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
          <Button
            type="button"
            variant="secondary"
            aria-expanded={dependencyOpen}
            onClick={() => setDependencyOpen(!dependencyOpen)}
          >
            {i18n.language.startsWith("zh")
              ? "打开依赖视图"
              : "Open dependency view"}
          </Button>
        )}
        {tab === "tasks" && dependencyOpen && (
          <>
            <p className="muted">{t("inspectHint")}</p>
            <div className="project-canvas-layout">
              <ProjectDependencyGraph
                scopeProjectId={project.id}
                initialFocus={dependencyState.focus}
                initialHops={dependencyState.hops}
                initialScope={dependencyState.scope}
                initialTaskScope={dependencyState.taskScope}
                initialIncludeExternal={dependencyState.includeExternal}
                onStateChange={setDependencyState}
                onWorkspace={() =>
                  openGraph({
                    kind: "project",
                    id: project.id,
                    mode: "dependencies",
                    focus: dependencyState.focus,
                    hops: dependencyState.hops,
                    scope: dependencyState.scope,
                    taskScope: dependencyState.taskScope,
                    includeExternal: dependencyState.includeExternal,
                    selection: inspectedId,
                  })
                }
                inspector={
                  <ProjectInspector
                    workIndex={workIndex}
                    item={
                      snapshot.items.find((item) => item.id === inspectedId) ??
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
                          snapshot.items.find((item) => item.id === inspectedId)
                            ?.id ?? project.id,
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
