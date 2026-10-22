import type { CategoryService, ProjectCategory } from "@arclattice/application";
import {
  eligibleProjectParents,
  type ManualOrderState,
  manualOrderScopeKey,
  projectLifecycle,
  type WorkItem,
} from "@arclattice/domain";
import { ArrowUpRight, FolderKanban, MoreHorizontal } from "lucide-react";
import {
  memo,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { CategoryManager } from "./CategoryManager";
import { Button, IconButton } from "./components/ui/Button";
import { ListRow, MenuItem } from "./components/ui/Content";
import { dragMime, type EntityDrag } from "./components/ui/drag-intent";
import { HierarchyDropTarget } from "./components/ui/HierarchyDropTarget";
import {
  DragHandle,
  SortableList,
  SortableRow,
} from "./components/ui/Sortable";
import { Dialog, Menu } from "./components/ui/Surfaces";
import { TouchReorderScope } from "./components/ui/TouchReorder";
import {
  projectProgressIndex,
  projectTreeIndex,
} from "./features/projects/project-tree";
import { taskPresentationComparator } from "./features/tasks/task-sort";
import {
  buildWorkspaceWorkIndex,
  WorkspaceWorkIndexContext,
} from "./features/tasks/workspace-work-index";

const ProjectRow = memo(function ProjectRow({
  project,
  completed,
  unfinished,
  canceled,
  children,
  expanded,
  busy,
  archived,
  inheritedTitle,
  onToggle,
  onOpen,
  onEdit,
  onTasks,
  onOrganize,
}: {
  project: WorkItem;
  completed: number;
  unfinished: number;
  canceled: number;
  children: boolean;
  expanded: boolean;
  busy: boolean;
  archived: boolean;
  inheritedTitle: string | undefined;
  onToggle(id: string): void;
  onOpen(item: WorkItem): void;
  onEdit(item: WorkItem): void;
  onTasks(id: string): void;
  onOrganize(item: WorkItem, action: "archive" | "unarchive" | "delete"): void;
}) {
  const { t, i18n } = useTranslation("desk");
  const menuAnchor = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const moreLabel =
    (i18n.language.startsWith("zh") ? "项目操作：" : "Project actions: ") +
    project.title;
  const scoped = { completed, unfinished, canceled },
    actionableTotal = completed + unfinished;
  return (
    <ListRow
      className="project-card project-compact-row"
      key={project.id}
      intent="NAVIGATE"
      onOpen={() => onOpen(project)}
    >
      {children ? (
        <Button
          variant="ghost"
          type="button"
          className="project-tree-toggle"
          aria-label={t(!expanded ? "expandProject" : "collapseProject", {
            title: project.title,
          })}
          aria-expanded={expanded}
          onClick={() => onToggle(project.id)}
        >
          {!expanded ? "▸" : "▾"}
        </Button>
      ) : (
        <FolderKanban size={16} />
      )}
      <Button
        type="button"
        variant="text"
        className="project-title"
        data-reorder-surface="true"
        onClick={() => onOpen(project)}
        onDoubleClick={() => onOpen(project)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onOpen(project);
          }
        }}
      >
        <h2>{project.title}</h2>
      </Button>
      <span className="muted project-lifecycle">
        {t("projectLifecycles." + projectLifecycle(project))}
      </span>
      <span
        className="project-compact-progress"
        title={t("projectProgress", scoped)}
      >
        <progress
          aria-label={t("completion")}
          max={Math.max(actionableTotal, 1)}
          value={scoped.completed}
        />
        <span>
          {scoped.completed} / {actionableTotal}
        </span>
      </span>
      <div className="project-card-actions">
        <IconButton
          ref={menuAnchor}
          label={moreLabel}
          disabled={busy}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <MoreHorizontal />
        </IconButton>
        {menuOpen && (
          <Menu
            anchorRef={menuAnchor}
            label={moreLabel}
            onDismiss={() => setMenuOpen(false)}
          >
            <MenuItem
              onClick={() => {
                setMenuOpen(false);
                onOpen(project);
              }}
            >
              {t("openProject")}
            </MenuItem>
            <MenuItem
              disabled={busy || !!inheritedTitle}
              title={
                inheritedTitle
                  ? t("inheritedArchive", { title: inheritedTitle })
                  : undefined
              }
              onClick={() => {
                setMenuOpen(false);
                onOrganize(project, archived ? "unarchive" : "archive");
              }}
            >
              {t(archived ? "unarchive" : "archive")}
            </MenuItem>
            <MenuItem
              disabled={busy}
              onClick={() => {
                setMenuOpen(false);
                onEdit(project);
              }}
            >
              {i18n.language.startsWith("zh")
                ? "移动 / 设置"
                : "Move / settings"}
            </MenuItem>
            <MenuItem
              onClick={() => {
                setMenuOpen(false);
                onTasks(project.id);
              }}
            >
              {t("projectTasks")}
              <ArrowUpRight size={14} />
            </MenuItem>
            <hr className="ui-menu-separator" />
            <MenuItem
              className="ui-menu-item-danger"
              disabled={busy}
              onClick={() => {
                setMenuOpen(false);
                onOrganize(project, "delete");
              }}
            >
              {t("deleteItem")}
            </MenuItem>
          </Menu>
        )}
      </div>
      {inheritedTitle && (
        <small className="project-archive-explanation">
          {t("inheritedArchive", { title: inheritedTitle })}
        </small>
      )}
    </ListRow>
  );
});

export function ProjectView({
  manualOrders,
  onMoveSibling,
  onReparent,
  onMoveCategory,
  categories,
  onSaveCategory,
  onReorderCategories,
  projects,
  items,
  onOpen,
  onEdit,
  onTasks,
  busy,
  isArchived,
  archiveSource,
  onOrganize,
  onReviewWorkspace,
}: {
  onReviewWorkspace?(): void;
  manualOrders: readonly ManualOrderState[];
  onReparent(movingId: string, parentProjectId: string): void;
  onMoveCategory(movingId: string, categoryId: string | null): void;
  onMoveSibling(
    parentProjectId: string | null,
    movingId: string,
    anchorId: string,
    placement: "BEFORE" | "AFTER",
  ): void;
  categories: ProjectCategory[];
  onSaveCategory(
    input: Parameters<CategoryService["save"]>[1],
  ): Promise<boolean>;
  onReorderCategories(
    ordered: Parameters<CategoryService["reorder"]>[1],
  ): Promise<boolean>;
  projects: WorkItem[];
  items: WorkItem[];
  onOpen(item: WorkItem): void;
  onEdit(item: WorkItem): void;
  onTasks(id: string): void;
  busy: boolean;
  isArchived(item: WorkItem): boolean;
  archiveSource(item: WorkItem): WorkItem | undefined;
  onOrganize(item: WorkItem, action: "archive" | "unarchive" | "delete"): void;
}) {
  const { t } = useTranslation("desk");
  const sharedWorkIndex = useContext(WorkspaceWorkIndexContext);
  const workIndex = useMemo(
    () => sharedWorkIndex ?? buildWorkspaceWorkIndex(items, []),
    [sharedWorkIndex, items],
  );
  const [showArchived, setShowArchived] = useState(false);
  const [showCompleted, setShowCompleted] = useState(true);
  const [manageCategories, setManageCategories] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnchor = useRef<HTMLButtonElement>(null);
  const { i18n } = useTranslation();
  const categoryLabel = i18n.language.startsWith("zh")
    ? "管理项目分类"
    : "Manage project categories";
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activeDrag, setActiveDrag] = useState<EntityDrag | null>(null);
  const projectsById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );
  const eligibleParents = useMemo(() => {
    const moving = activeDrag && projectsById.get(activeDrag.entityId);
    return new Set(
      moving
        ? eligibleProjectParents(moving, items).map((project) => project.id)
        : [],
    );
  }, [activeDrag, projectsById, items]);
  const isProjectDrag = (input: EntityDrag) =>
    activeDrag?.entityId === input.entityId &&
    activeDrag.scopeKey === input.scopeKey &&
    input.intent === "REORDER" &&
    input.scopeKey.startsWith("PROJECT_CHILDREN:") &&
    !!projectsById.get(input.entityId) &&
    !isArchived(projectsById.get(input.entityId)!);
  const visibleProjects = useMemo(
    () =>
      projects.filter(
        (project) =>
          isArchived(project) === showArchived &&
          (showCompleted || projectLifecycle(project) !== "COMPLETED"),
      ),
    [projects, isArchived, showArchived, showCompleted],
  );
  const childrenByParent = useMemo(() => {
    const tree = projectTreeIndex(visibleProjects);
    const orderByScope = new Map(
      manualOrders.map((order) => [order.id, order]),
    );
    for (const [parentProjectId, children] of tree) {
      const scopeKey = manualOrderScopeKey({
        kind: "PROJECT_CHILDREN",
        parentProjectId,
      });
      const positions = new Map(
        orderByScope
          .get(scopeKey)
          ?.entries.map((entry) => [entry.entityId, entry.position]) ?? [],
      );
      children.sort(
        taskPresentationComparator("manual", i18n.language, positions),
      );
    }
    return tree;
  }, [visibleProjects, manualOrders, i18n.language]);
  const progressById = useMemo(() => projectProgressIndex(items), [items]);
  const actions = useRef({ onOpen, onEdit, onTasks, onOrganize });
  actions.current = { onOpen, onEdit, onTasks, onOrganize };
  const editRow = useCallback(
    (project: WorkItem) => actions.current.onEdit(project),
    [],
  );
  const openRow = useCallback(
    (project: WorkItem) => actions.current.onOpen(project),
    [],
  );
  const taskRow = useCallback((id: string) => actions.current.onTasks(id), []);
  const organizeRow = useCallback(
    (project: WorkItem, action: "archive" | "unarchive" | "delete") =>
      actions.current.onOrganize(project, action),
    [],
  );
  const toggleRow = useCallback(
    (id: string) =>
      setExpanded((old) => {
        const next = new Set(old);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );
  const renderCard = (project: WorkItem) => {
    const progress = progressById.get(project.id);
    return (
      <ProjectRow
        project={project}
        completed={progress?.completed ?? 0}
        unfinished={progress?.unfinished ?? 0}
        canceled={progress?.canceled ?? 0}
        children={!!childrenByParent.get(project.id)?.length}
        expanded={expanded.has(project.id)}
        busy={busy}
        archived={showArchived}
        inheritedTitle={archiveSource(project)?.title}
        onToggle={toggleRow}
        onOpen={openRow}
        onEdit={editRow}
        onTasks={taskRow}
        onOrganize={organizeRow}
      />
    );
  };
  const seen = new Set<string>();
  const renderTree = (nodes: WorkItem[]): ReactNode => (
    <SortableList className="project-tree-list" touchScope={false}>
      {nodes
        .filter((p) => !seen.has(p.id))
        .map((project) => {
          if (seen.has(project.id)) return null;
          seen.add(project.id);
          const children = childrenByParent.get(project.id) ?? [];
          const parentProjectId = project.parentProjectId ?? null;
          const scopeKey = manualOrderScopeKey({
            kind: "PROJECT_CHILDREN",
            parentProjectId,
          });
          const position = nodes.indexOf(project);
          return (
            <SortableRow
              key={project.id}
              entityId={project.id}
              scopeKey={scopeKey}
              disabled={busy || showArchived}
              onStart={setActiveDrag}
              onMoveBefore={(moving, anchor) =>
                onMoveSibling(parentProjectId, moving, anchor, "BEFORE")
              }
              onMoveAfter={(moving, anchor) =>
                onMoveSibling(parentProjectId, moving, anchor, "AFTER")
              }
            >
              <div
                className="project-sortable-content"
                draggable={!busy && !showArchived}
                onDragStart={(event) => {
                  const input = {
                    version: 1 as const,
                    intent: "REORDER" as const,
                    entityId: project.id,
                    scopeKey,
                  };
                  setActiveDrag(input);
                  event.dataTransfer.setData(dragMime, JSON.stringify(input));
                }}
                onDragEnd={() => setActiveDrag(null)}
              >
                {!showArchived && nodes.length > 1 && (
                  <DragHandle
                    label={t("moveProject", { title: project.title })}
                    disabled={busy}
                    onStart={setActiveDrag}
                    onEnd={() => setActiveDrag(null)}
                    input={{
                      version: 1,
                      intent: "REORDER",
                      entityId: project.id,
                      scopeKey,
                    }}
                    onMove={(direction) => {
                      const anchor =
                        nodes[position + (direction === "UP" ? -1 : 1)];
                      if (anchor)
                        onMoveSibling(
                          parentProjectId,
                          project.id,
                          anchor.id,
                          direction === "UP" ? "BEFORE" : "AFTER",
                        );
                    }}
                  />
                )}
                <HierarchyDropTarget
                  activeDrag={activeDrag}
                  dropIntent="PROJECT_REPARENT"
                  disabled={busy || showArchived}
                  label={t("moveIntoProject", { title: project.title })}
                  canDrop={(input) =>
                    isProjectDrag(input) &&
                    eligibleParents.has(project.id) &&
                    projectsById.get(input.entityId)?.parentProjectId !==
                      project.id
                  }
                  onDrop={(input) => {
                    setActiveDrag(null);
                    onReparent(input.entityId, project.id);
                  }}
                >
                  {renderCard(project)}
                </HierarchyDropTarget>
              </div>
              {expanded.has(project.id) && children.length > 0
                ? renderTree(children)
                : null}
            </SortableRow>
          );
        })}
    </SortableList>
  );
  const roots = childrenByParent.get(null) ?? [];
  const sections = [
    ...categories
      .filter((category) => !category.deletedAt)
      .map((category) => ({ id: category.id, name: category.name })),
    { id: null, name: t("uncategorized") },
  ];
  const liveCategoryIds = new Set(
    categories
      .filter((category) => !category.deletedAt)
      .map((category) => category.id),
  );
  const rootsByCategory = new Map<string | null, WorkItem[]>();
  for (const project of roots) {
    const inheritedCategory = workIndex.categoryIdByProjectId.get(project.id),
      categoryId =
        inheritedCategory && liveCategoryIds.has(inheritedCategory)
          ? inheritedCategory
          : null;
    const grouped = rootsByCategory.get(categoryId) ?? [];
    grouped.push(project);
    rootsByCategory.set(categoryId, grouped);
  }
  const hierarchy = sections.map((category) => {
    const categoryRoots = rootsByCategory.get(category.id) ?? [];
    return (
      <section key={category.id ?? "uncategorized"}>
        <HierarchyDropTarget
          activeDrag={activeDrag}
          dropIntent="MOVE_CATEGORY"
          disabled={busy || showArchived}
          edges={false}
          label={t("moveIntoCategory", { title: category.name })}
          canDrop={isProjectDrag}
          onDrop={(input) => {
            setActiveDrag(null);
            onMoveCategory(input.entityId, category.id);
          }}
        >
          <h2>{category.name}</h2>
        </HierarchyDropTarget>
        {renderTree(categoryRoots)}
      </section>
    );
  });
  return (
    <TouchReorderScope>
      <div className="projects-overview">
        <div className="organization-toolbar">
          <IconButton
            ref={menuAnchor}
            label={
              i18n.language.startsWith("zh")
                ? "项目列表选项"
                : "Project list options"
            }
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MoreHorizontal />
          </IconButton>
          {menuOpen && (
            <Menu
              anchorRef={menuAnchor}
              label={categoryLabel}
              onDismiss={() => setMenuOpen(false)}
            >
              <MenuItem
                onClick={() => {
                  setMenuOpen(false);
                  setManageCategories(true);
                }}
              >
                {categoryLabel}
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setShowCompleted((value) => !value);
                  setMenuOpen(false);
                }}
              >
                {i18n.language.startsWith("zh")
                  ? showCompleted
                    ? "隐藏已完成项目"
                    : "显示已完成项目"
                  : showCompleted
                    ? "Hide completed projects"
                    : "Show completed projects"}
              </MenuItem>
            </Menu>
          )}
          <Button
            type="button"
            variant="toggle"
            aria-pressed={showArchived}
            onClick={() => setShowArchived(!showArchived)}
          >
            {t("archivedProjects")} · {projects.filter(isArchived).length}
          </Button>
        </div>
        <div className="project-grid project-hierarchy">
          {visibleProjects.length ? (
            hierarchy
          ) : (
            <div className="empty-state">
              <FolderKanban size={32} />
              <h2>{t(showArchived ? "noArchivedProjects" : "firstProject")}</h2>
              {!showArchived && <p>{t("projectsHint")}</p>}
              {!showArchived && projects.length === 0 && onReviewWorkspace && (
                <>
                  <p>
                    {i18n.language.startsWith("zh")
                      ? "当前工作区没有可显示的项目。升级后找不到已有项目时，请先核对账户、服务器和本机工作区。"
                      : "This workspace has no visible projects. If existing projects are missing after an upgrade, review your account, server and device workspaces."}
                  </p>
                  <Button variant="secondary" onClick={onReviewWorkspace}>
                    {i18n.language.startsWith("zh")
                      ? "检查账户与工作区"
                      : "Review account and workspaces"}
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
        {manageCategories && (
          <Dialog
            aria-label={categoryLabel}
            onRequestClose={() => setManageCategories(false)}
          >
            <Button variant="ghost" onClick={() => setManageCategories(false)}>
              {i18n.language.startsWith("zh") ? "关闭" : "Close"}
            </Button>
            <CategoryManager
              categories={categories}
              projects={projects}
              busy={busy}
              onSave={onSaveCategory}
              onReorder={onReorderCategories}
            />
          </Dialog>
        )}
      </div>
    </TouchReorderScope>
  );
}

export { CalendarView } from "./features/calendar/CalendarWorkspace";
