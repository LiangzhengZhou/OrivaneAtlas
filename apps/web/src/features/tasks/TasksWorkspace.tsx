import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, SegmentedControl, Toolbar } from "../../components/ui/Button";
import { MenuItem } from "../../components/ui/Content";
import { Menu } from "../../components/ui/Surfaces";
import { TaskList, WorkBoard, type WorkProps } from "../../WorkViews";
import { TaskGantt } from "./TaskGantt";
import { TaskTimeline } from "./TaskTimeline";
export type TaskPresentation = {
  tab: "now" | "later" | "scheduled" | "completed" | "all";
  view: "list" | "board" | "timeline";
};

function TaskScopeMenu({
  tab,
  onChoose,
  onDependencies,
}: {
  tab: TaskPresentation["tab"];
  onChoose(tab: TaskPresentation["tab"]): void;
  onDependencies?: (() => void) | undefined;
}) {
  const { t, i18n } = useTranslation("desk");
  const zh = i18n.language.startsWith("zh");
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const label = zh ? "更多任务范围" : "More task scopes";
  return (
    <>
      <Button
        ref={anchor}
        variant="ghost"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
      >
        {tab === "all" || tab === "completed"
          ? t("taskWorkspace." + tab)
          : zh
            ? "更多"
            : "More"}
      </Button>
      {open && (
        <Menu anchorRef={anchor} label={label} onDismiss={() => setOpen(false)}>
          {(["completed", "all"] as const).map((value) => (
            <MenuItem
              key={value}
              role="menuitemradio"
              aria-checked={tab === value}
              onClick={() => {
                setOpen(false);
                onChoose(value);
              }}
            >
              {t("taskWorkspace." + value)}
            </MenuItem>
          ))}
          {onDependencies && (
            <MenuItem
              onClick={() => {
                setOpen(false);
                onDependencies();
              }}
            >
              {t("dependencies")}
            </MenuItem>
          )}
        </Menu>
      )}
    </>
  );
}

export function TasksWorkspace({
  initialTab = "now",
  initialBoard = false,
  includeArchived = false,
  onDependencies,
  presentation,
  onPresentationChange,
  timelineMode = "timeline",
  filterControls,
  ...props
}: WorkProps & {
  initialTab?: "now" | "later" | "scheduled" | "completed" | "all";
  initialBoard?: boolean;
  includeArchived?: boolean;
  onDependencies?: () => void;
  presentation?: TaskPresentation;
  onPresentationChange?(state: TaskPresentation): void;
  timelineMode?: "timeline" | "gantt";
  filterControls?: ReactNode;
}) {
  const { t, i18n } = useTranslation("desk");
  const [localTab, setTab] = useState(initialTab);
  useEffect(() => setTab(initialTab), [initialTab]);
  const [localView, setView] = useState<"list" | "board" | "timeline">(
    initialBoard ? "board" : "list",
  );
  const tab = presentation?.tab ?? localTab;
  const view = presentation?.view ?? localView;
  const zh = i18n.language.startsWith("zh");
  const chooseTab = (next: TaskPresentation["tab"]) => {
    if (!presentation) setTab(next);
    onPresentationChange?.({ tab: next, view });
  };
  const selected = props.taskIndex;
  const ids = useMemo(
    () => new Set(props.items.map((item) => item.id)),
    [props.items],
  );
  const items = useMemo(() => {
    const views = {
      now: selected.openActiveTasks,
      later: selected.laterTasks,
      scheduled: selected.scheduledTasks,
      completed: selected.completedTasks,
      all: selected.tasks,
    };
    return views[tab].filter((item) => ids.has(item.id));
  }, [selected, tab, ids]);
  return (
    <section className="tasks-workspace">
      <Toolbar
        className="organization-toolbar"
        role="tablist"
        aria-label={t("tasks")}
      >
        {(["now", "later", "scheduled"] as const).map((value) => (
          <Button
            type="button"
            role="tab"
            aria-selected={tab === value}
            variant="toggle"
            aria-pressed={tab === value}
            key={value}
            onClick={() => chooseTab(value)}
          >
            {t("taskWorkspace." + value)}
          </Button>
        ))}
        <TaskScopeMenu
          tab={tab}
          onChoose={chooseTab}
          onDependencies={onDependencies}
        />
        {filterControls}
        <span
          className="muted"
          data-testid="task-scope-count"
          data-count={items.length}
        >
          {items.length} {t("tasks")}
        </span>
      </Toolbar>
      <SegmentedControl<"list" | "board" | "timeline">
        label={t("tasks")}
        value={view}
        options={[
          { value: "list", label: t("taskWorkspace.list") },
          { value: "board", label: t("taskWorkspace.board") },
          {
            value: "timeline",
            label:
              timelineMode === "gantt"
                ? zh
                  ? "甘特图"
                  : "Gantt"
                : zh
                  ? "时间线"
                  : "Timeline",
          },
        ]}
        onChange={(next) => {
          if (!presentation) setView(next);
          onPresentationChange?.({ tab, view: next });
        }}
      />
      {view === "timeline" ? (
        timelineMode === "gantt" ? (
          <TaskGantt {...props} items={items} />
        ) : (
          <TaskTimeline {...props} items={items} />
        )
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
