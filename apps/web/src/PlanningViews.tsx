import type { Note } from "@arclattice/application";
import type { WorkItem } from "@arclattice/domain";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  FolderKanban,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export function ProjectView({
  projects,
  items,
  onOpen,
  onTasks,
}: {
  projects: WorkItem[];
  items: WorkItem[];
  onOpen(item: WorkItem): void;
  onTasks(id: string): void;
}) {
  const { t } = useTranslation("desk");
  return (
    <div className="project-grid">
      {projects.length ? (
        projects.map((project) => {
          const members = items.filter((item) => item.projectId === project.id);
          const done = members.filter((item) => item.status === "DONE").length;
          return (
            <section className="panel project-card" key={project.id}>
              <div className="panel-heading">
                <FolderKanban size={22} />
                <span className="priority">
                  {t("work:statuses." + project.status)}
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
              {project.dueDate && (
                <p className="muted">
                  {t("dueDate")} · {project.dueDate}
                </p>
              )}
              <div className="progress-label">
                <span>{t("completion")}</span>
                <strong>
                  {done} / {members.length}
                </strong>
              </div>
              <progress max={Math.max(members.length, 1)} value={done} />
              <button
                type="button"
                className="text-button"
                onClick={() => onTasks(project.id)}
              >
                {t("projectTasks")}
                <ArrowUpRight size={16} />
              </button>
            </section>
          );
        })
      ) : (
        <div className="empty-state">
          <FolderKanban size={32} />
          <h2>{t("firstProject")}</h2>
          <p>{t("projectsHint")}</p>
        </div>
      )}
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
  const first = new Date(month + "-01T12:00:00");
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const offset = (first.getDay() + 6) % 7;
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
    const next = new Date(first.getFullYear(), first.getMonth() + by, 1, 12);
    if (next.getFullYear() < 1 || next.getFullYear() > 9999) return;
    setMonth(
      String(next.getFullYear()).padStart(4, "0") +
        "-" +
        String(next.getMonth() + 1).padStart(2, "0"),
    );
  };
  return (
    <div className="calendar-layout">
      <section className="panel calendar-panel">
        <div className="panel-heading">
          <h2>
            {new Intl.DateTimeFormat(i18n.language, {
              year: "numeric",
              month: "long",
            }).format(first)}
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
              {new Intl.DateTimeFormat(i18n.language, {
                weekday: "short",
              }).format(new Date(2026, 8, 14 + i))}
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
