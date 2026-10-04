import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, SegmentedControl, Toolbar } from "../../components/ui/Button";
import { TaskList, WorkBoard, type WorkProps } from "../../WorkViews";
import { TaskTimeline } from "./TaskTimeline";

export function TasksWorkspace({
  initialTab = "now",
  initialBoard = false,
  includeArchived = false,
  onDependencies,
  ...props
}: WorkProps & {
  initialTab?: "now" | "later" | "scheduled" | "completed" | "all";
  initialBoard?: boolean;
  includeArchived?: boolean;
  onDependencies?: () => void;
}) {
  const { t, i18n } = useTranslation("desk");
  const [tab, setTab] = useState(initialTab);
  useEffect(() => setTab(initialTab), [initialTab]);
  const [view, setView] = useState<"list" | "board" | "timeline">(
    initialBoard ? "board" : "list",
  );
  const selected = props.taskIndex;
  const ids = useMemo(
    () => new Set(props.items.map((item) => item.id)),
    [props.items],
  );
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
      <Toolbar
        className="organization-toolbar"
        role="tablist"
        aria-label={t("tasks")}
      >
        {(["now", "later", "scheduled", "completed", "all"] as const).map(
          (value) => (
            <Button
              type="button"
              role="tab"
              aria-selected={tab === value}
              className={tab === value ? "chip active" : "chip"}
              key={value}
              onClick={() => setTab(value)}
            >
              {t("taskWorkspace." + value)}
            </Button>
          ),
        )}
      </Toolbar>
      <SegmentedControl<"list" | "board" | "timeline">
        label={t("tasks")}
        value={view}
        options={[
          { value: "list", label: t("taskWorkspace.list") },
          { value: "board", label: t("taskWorkspace.board") },
          {
            value: "timeline",
            label: i18n.language.startsWith("zh") ? "时间线" : "Timeline",
          },
        ]}
        onChange={setView}
      />
      {onDependencies && (
        <Button type="button" className="chip" onClick={onDependencies}>
          {t("dependencies")}
        </Button>
      )}
      {view === "timeline" ? (
        <TaskTimeline {...props} items={items} />
      ) : view === "board" ? (
        <WorkBoard
          {...props}
          items={items}
          derived={props.derived ?? selected.derived}
        />
      ) : (
        <TaskList
          {...props}
          items={items}
          derived={props.derived ?? selected.derived}
        />
      )}
    </section>
  );
}
