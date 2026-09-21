import type {
  CategoryService,
  Note,
  ProjectCategory,
} from "@arclattice/application";
import {
  calendarMonthInfo,
  formatCalendarDate,
  projectLifecycle,
  projectScope,
  shiftCalendarMonth,
  type WorkItem,
} from "@arclattice/domain";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  FolderKanban,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { CategoryManager } from "./CategoryManager";

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
  const [categoryId, setCategoryId] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const visibleProjects = projects.filter(
    (p) =>
      isArchived(p) === showArchived &&
      (!categoryId ||
        categories.some(
          (c) =>
            c.id === categoryId && !c.deletedAt && c.projectIds.includes(p.id),
        )),
  );
  const renderCard = (project: WorkItem) => {
    const inherited = archiveSource(project);
    const scoped = projectScope(project, items, "SUBTREE");
    const done = scoped.completed;
    const actionableTotal = scoped.completed + scoped.unfinished;
    return (
      <section className="panel project-card" key={project.id}>
        <div className="panel-heading">
          {visibleProjects.some((p) => p.projectId === project.id) ? (
            <button
              type="button"
              className="project-tree-toggle"
              aria-label={t(
                collapsed.has(project.id) ? "expandProject" : "collapseProject",
                { title: project.title },
              )}
              aria-expanded={!collapsed.has(project.id)}
              onClick={() =>
                setCollapsed((old) => {
                  const next = new Set(old);
                  if (next.has(project.id)) next.delete(project.id);
                  else next.add(project.id);
                  return next;
                })
              }
            >
              {collapsed.has(project.id) ? "▸" : "▾"}
            </button>
          ) : (
            <FolderKanban size={22} />
          )}
          <span className="priority">
            {t("projectLifecycles." + projectLifecycle(project))}
          </span>
        </div>
        <button
          type="button"
          className="project-title"
          onClick={() => onOpen(project)}
        >
          <h2>{project.title}</h2>
        </button>
        <p className="project-description">
          {project.descriptionMd || t("projectEmptyHint")}
        </p>
        {project.projectId && (
          <p className="muted">
            {t("parentProject")} ·{" "}
            {projects.find((parent) => parent.id === project.projectId)?.title}
          </p>
        )}
        {project.dueDate && (
          <p className="muted">
            {t("dueDate")} · {project.dueDate}
          </p>
        )}
        <div className="progress-label">
          <span>{t("completion")}</span>
          <strong>
            {done} / {actionableTotal}
          </strong>
        </div>
        <progress max={Math.max(actionableTotal, 1)} value={done} />
        <p className="muted">{t("projectProgress", scoped)}</p>
        <p className="muted">{t("recursiveProgress")}</p>
        {inherited && (
          <p className="muted">
            {t("inheritedArchive", { title: inherited.title })}
          </p>
        )}
        <div className="project-card-actions">
          <button
            type="button"
            className="button secondary"
            onClick={() => onOpen(project)}
          >
            {t("openProject")}
          </button>
          <button
            type="button"
            className="text-button"
            disabled={busy || !!inherited}
            onClick={() =>
              onOrganize(project, isArchived(project) ? "unarchive" : "archive")
            }
          >
            {t(isArchived(project) ? "unarchive" : "archive")}
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => onTasks(project.id)}
          >
            {t("projectTasks")}
            <ArrowUpRight size={16} />
          </button>
        </div>
      </section>
    );
  };
  const visibleIds = new Set(visibleProjects.map((p) => p.id));
  const seen = new Set<string>();
  const renderTree = (nodes: WorkItem[]): ReactNode => (
    <ul className="project-tree-list">
      {nodes
        .filter((p) => !seen.has(p.id))
        .map((project) => {
          if (seen.has(project.id)) return null;
          seen.add(project.id);
          const children = visibleProjects.filter(
            (p) => p.projectId === project.id && !seen.has(p.id),
          );
          const childTree = renderTree(children);
          return (
            <li key={project.id}>
              {renderCard(project)}
              <div hidden={collapsed.has(project.id)}>{childTree}</div>
            </li>
          );
        })}
    </ul>
  );
  const roots = visibleProjects.filter(
    (p) => !p.projectId || !visibleIds.has(p.projectId),
  );
  const tree = renderTree(roots);
  const recovered = renderTree(visibleProjects.filter((p) => !seen.has(p.id)));
  const hierarchy = (
    <>
      {tree}
      {recovered}
    </>
  );
  return (
    <div className="projects-overview">
      <div className="organization-toolbar">
        <label>
          {t("categories.filter")}
          <select
            aria-label={t("categories.filter")}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">{t("categories.all")}</option>
            {categories
              .filter((c) => !c.deletedAt)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
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
