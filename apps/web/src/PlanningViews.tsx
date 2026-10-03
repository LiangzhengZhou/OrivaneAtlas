import type {
  CategoryService,
  Note,
  ProjectCategory,
} from "@arclattice/application";
import {
  calendarMonthInfo,
  effectiveCategoryId,
  formatCalendarDate,
  projectLifecycle,
  shiftCalendarMonth,
  type WorkItem,
} from "@arclattice/domain";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  FolderKanban,
} from "lucide-react";
import {
  memo,
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { CategoryManager } from "./CategoryManager";
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
  onTasks(id: string): void;
  onOrganize(item: WorkItem, action: "archive" | "unarchive"): void;
}) {
  const { t } = useTranslation("desk");
  const scoped = { completed, unfinished, canceled },
    actionableTotal = completed + unfinished;
  return (
    <section
      className="panel project-card project-compact-row"
      key={project.id}
    >
      {children ? (
        <button
          type="button"
          className="project-tree-toggle"
          aria-label={t(!expanded ? "expandProject" : "collapseProject", {
            title: project.title,
          })}
          aria-expanded={expanded}
          onClick={() => onToggle(project.id)}
        >
          {!expanded ? "▸" : "▾"}
        </button>
      ) : (
        <FolderKanban size={16} />
      )}
      <button
        type="button"
        className="project-title"
        onClick={() => onOpen(project)}
      >
        <h2>{project.title}</h2>
      </button>
      <span className="priority">
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
        <button
          type="button"
          className="text-button"
          onClick={() => onOpen(project)}
        >
          {t("openProject")}
        </button>
        <button
          type="button"
          className="text-button"
          disabled={busy || !!inheritedTitle}
          title={
            inheritedTitle
              ? t("inheritedArchive", { title: inheritedTitle })
              : undefined
          }
          onClick={() =>
            onOrganize(project, archived ? "unarchive" : "archive")
          }
        >
          {t(archived ? "unarchive" : "archive")}
        </button>
        <button
          type="button"
          className="text-button"
          onClick={() => onTasks(project.id)}
        >
          {t("projectTasks")}
          <ArrowUpRight size={14} />
        </button>
      </div>
      {inheritedTitle && (
        <small className="project-archive-explanation">
          {t("inheritedArchive", { title: inheritedTitle })}
        </small>
      )}
    </section>
  );
});

export function ProjectView({
  categories,
  onSaveCategory,
  projects,
  items,
  onOpen,
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
  onTasks(id: string): void;
  busy: boolean;
  isArchived(item: WorkItem): boolean;
  archiveSource(item: WorkItem): WorkItem | undefined;
  onOrganize(item: WorkItem, action: "archive" | "unarchive"): void;
}) {
  const { t } = useTranslation("desk");
  const [showArchived, setShowArchived] = useState(false);
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
  const actions = useRef({ onOpen, onTasks, onOrganize });
  actions.current = { onOpen, onTasks, onOrganize };
  const openRow = useCallback(
    (project: WorkItem) => actions.current.onOpen(project),
    [],
  );
  const taskRow = useCallback((id: string) => actions.current.onTasks(id), []);
  const organizeRow = useCallback(
    (project: WorkItem, action: "archive" | "unarchive") =>
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
        <button
          type="button"
          className="chip"
          aria-pressed={showArchived}
          onClick={() => setShowArchived(!showArchived)}
        >
          {t("archivedProjects")} · {projects.filter(isArchived).length}
        </button>
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
      <CategoryManager
        categories={categories}
        projects={projects}
        busy={busy}
        onSave={onSaveCategory}
      />
    </div>
  );
}

export function CalendarView({
  items,
  today,
  onOpen,
  journals = [],
  onJournal,
}: {
  items: WorkItem[];
  today: string;
  journals?: Note[];
  onJournal?: (day: string) => void;
  onOpen(item: WorkItem): void;
}) {
  const { t, i18n } = useTranslation("desk");
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const [mode, setMode] = useState<"day" | "overdue" | "unscheduled">("day");
  const { days, offset } = calendarMonthInfo(month);
  const open = (item: WorkItem) => !["DONE", "CANCELED"].includes(item.status);
  const overdue = items.filter(
    (item) => item.dueDate && item.dueDate < today && open(item),
  );
  const undated = items.filter(
    (item) => !item.dueDate && !item.startDate && open(item),
  );
  const onDay = (day: string) =>
    items.filter((item) => item.dueDate === day || item.startDate === day);
  const entries =
    mode === "overdue"
      ? overdue
      : mode === "unscheduled"
        ? undated
        : onDay(selected);
  const shift = (by: number) => {
    const next = shiftCalendarMonth(month, by);
    if (next) setMonth(next);
  };
  return (
    <div className="calendar-layout">
      <section className="panel calendar-panel">
        <div className="panel-heading">
          <h2>
            {formatCalendarDate(month + "-01", i18n.language, {
              year: "numeric",
              month: "long",
            })}
          </h2>
          <div className="calendar-controls">
            <button
              type="button"
              className="icon-button"
              aria-label={t("previousMonth")}
              onClick={() => shift(-1)}
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => {
                setMonth(today.slice(0, 7));
                setSelected(today);
                setMode("day");
              }}
            >
              {t("today")}
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={t("nextMonth")}
              onClick={() => shift(1)}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
        <div className="calendar-week">
          {Array.from({ length: 7 }, (_, i) => (
            <span key={i}>
              {formatCalendarDate("2026-09-" + (14 + i), i18n.language, {
                weekday: "short",
              })}
            </span>
          ))}
        </div>
        <div className="calendar-grid">
          {Array.from({ length: offset }, (_, i) => (
            <span className="calendar-blank" key={"blank" + i} />
          ))}
          {Array.from({ length: days }, (_, i) => {
            const day = month + "-" + String(i + 1).padStart(2, "0");
            const tasks = onDay(day);
            return (
              <button
                type="button"
                key={day}
                aria-label={day}
                aria-pressed={mode === "day" && selected === day}
                className={
                  "calendar-day " +
                  (today === day ? "is-today " : "") +
                  (selected === day && mode === "day" ? "selected" : "")
                }
                onClick={() => {
                  setSelected(day);
                  setMode("day");
                  onJournal?.(day);
                }}
              >
                <span>{i + 1}</span>
                {journals.some(
                  (n) => n.kind === "JOURNAL" && n.day === day && !n.deletedAt,
                ) && (
                  <small className="journal-marker" title={t("journal")}>
                    ●
                  </small>
                )}
                {tasks.length > 0 && (
                  <span className="calendar-count">{tasks.length}</span>
                )}
                <div className="calendar-preview">
                  {tasks.slice(0, 2).map((item) => (
                    <small key={item.id}>{item.title}</small>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </section>
      <section className="panel agenda-panel">
        <div className="agenda-tabs">
          <button
            type="button"
            className={"chip " + (mode === "overdue" ? "active" : "")}
            onClick={() => setMode("overdue")}
          >
            {t("overdue")} · {overdue.length}
          </button>
          <button
            type="button"
            className={"chip " + (mode === "unscheduled" ? "active" : "")}
            onClick={() => setMode("unscheduled")}
          >
            {t("unscheduled")} · {undated.length}
          </button>
        </div>
        <h2>{mode === "day" ? selected : t(mode)}</h2>
        <p className="muted">{t("calendarDatesHint")}</p>
        {entries.length ? (
          entries.map((item) => (
            <button
              type="button"
              className="agenda-item"
              key={item.id}
              onClick={() => onOpen(item)}
            >
              <strong>{item.title}</strong>
              <small>
                {t("work:statuses." + item.status)}
                {item.dueDate ? " · " + t("dueDate") + " " + item.dueDate : ""}
              </small>
            </button>
          ))
        ) : (
          <p className="empty-small">{t("scheduleEmpty")}</p>
        )}
      </section>
    </div>
  );
}
