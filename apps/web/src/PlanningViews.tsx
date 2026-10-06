import type { CategoryService, ProjectCategory } from "@arclattice/application";
import {
  effectiveCategoryId,
  projectLifecycle,
  type WorkItem,
} from "@arclattice/domain";
import { ArrowUpRight, FolderKanban, MoreHorizontal } from "lucide-react";
import {
  memo,
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useEntitySelection } from "./app/EntitySelection";
import { CategoryManager } from "./CategoryManager";
import { Button, IconButton } from "./components/ui/Button";
import { ListRow, MenuItem } from "./components/ui/Content";
import { Dialog, Menu } from "./components/ui/Surfaces";
import {
  projectProgressIndex,
  projectTreeIndex,
} from "./features/projects/project-tree";

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
  const selection = useEntitySelection();
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
      selected={
        selection?.selected?.kind === "WORK" &&
        selection.selected.id === project.id
      }
      onSelect={() => selection?.select({ kind: "WORK", id: project.id })}
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
        onClick={() =>
          selection
            ? selection.select({ kind: "WORK", id: project.id })
            : onOpen(project)
        }
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
            <MenuItem
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
  categories,
  onSaveCategory,
  projects,
  items,
  onOpen,
  onEdit,
  onTasks,
  busy,
  isArchived,
  archiveSource,
  onOrganize,
}: {
  categories: ProjectCategory[];
  onSaveCategory(
    input: Parameters<CategoryService["save"]>[1],
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
  const [showArchived, setShowArchived] = useState(false);
  const [manageCategories, setManageCategories] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnchor = useRef<HTMLButtonElement>(null);
  const { i18n } = useTranslation();
  const categoryLabel = i18n.language.startsWith("zh")
    ? "管理项目分类"
    : "Manage project categories";
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const visibleProjects = useMemo(
    () => projects.filter((project) => isArchived(project) === showArchived),
    [projects, isArchived, showArchived],
  );
  const childrenByParent = useMemo(
    () => projectTreeIndex(visibleProjects),
    [visibleProjects],
  );
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
    <ul className="project-tree-list">
      {nodes
        .filter((p) => !seen.has(p.id))
        .map((project) => {
          if (seen.has(project.id)) return null;
          seen.add(project.id);
          const children = childrenByParent.get(project.id) ?? [];
          return (
            <li key={project.id}>
              {renderCard(project)}
              {expanded.has(project.id) && children.length > 0
                ? renderTree(children)
                : null}
            </li>
          );
        })}
    </ul>
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
    const inheritedCategory = effectiveCategoryId(project, items),
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
    if (!categoryRoots.length) return null;
    return (
      <section key={category.id ?? "uncategorized"}>
        <h2>{category.name}</h2>
        {renderTree(categoryRoots)}
      </section>
    );
  });
  return (
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
          />
        </Dialog>
      )}
    </div>
  );
}

export { CalendarView } from "./features/calendar/CalendarWorkspace";
