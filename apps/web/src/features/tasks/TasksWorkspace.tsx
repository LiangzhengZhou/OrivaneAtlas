import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { TaskList, WorkBoard, type WorkProps } from "../../WorkViews";
import { selectTasks } from "./task-selectors";

export function TasksWorkspace({
  initialTab = "now",
  initialBoard = false,
  includeArchived = false,
  ...props
}: WorkProps & {
  initialTab?: "now" | "later" | "scheduled" | "completed" | "all";
  initialBoard?: boolean;
  includeArchived?: boolean;
}) {
  const { t } = useTranslation("desk");
  const [tab, setTab] = useState(initialTab);
  useEffect(() => setTab(initialTab), [initialTab]);
  const [board, setBoard] = useState(initialBoard);
  const selected = selectTasks(
    props.allItems,
    props.edges,
    props.today,
    (item) =>
      includeArchived ? !props.isArchived(item) : props.isArchived(item),
  );
  const ids = new Set(props.items.map((item) => item.id));
  const views = {
    now: selected.openActiveTasks,
    later: selected.laterTasks,
    scheduled: selected.scheduledTasks,
    completed: selected.completedTasks,
    all: selected.tasks,
  };
  const items = views[tab].filter((item) => ids.has(item.id));
  return (
    <section className="tasks-workspace">
      <div className="view-count">
        <span>{items.length}</span>
      </div>
      <div
        className="organization-toolbar"
        role="tablist"
        aria-label={t("tasks")}
      >
        {(["now", "later", "scheduled", "completed", "all"] as const).map(
          (value) => (
            <button
              type="button"
              role="tab"
              aria-selected={tab === value}
              className={tab === value ? "chip active" : "chip"}
              key={value}
              onClick={() => setTab(value)}
            >
              {t("taskWorkspace." + value)}
            </button>
          ),
        )}
        <button
          type="button"
          className="chip"
          aria-pressed={!board}
          onClick={() => setBoard(false)}
        >
          {t("taskWorkspace.list")}
        </button>
        <button
          type="button"
          className="chip"
          aria-pressed={board}
          onClick={() => setBoard(true)}
        >
          {t("taskWorkspace.board")}
        </button>
      </div>
      {board ? (
        <WorkBoard {...props} items={items} />
      ) : (
        <TaskList {...props} items={items} />
      )}
    </section>
  );
}
