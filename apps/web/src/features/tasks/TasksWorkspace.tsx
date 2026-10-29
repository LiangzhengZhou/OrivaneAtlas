import type { Priority } from "@arclattice/domain";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, SegmentedControl, Toolbar } from "../../components/ui/Button";
import { MenuItem } from "../../components/ui/Content";
import { Menu, Select } from "../../components/ui/Surfaces";
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
  const { t: tWork } = useTranslation("work");
  const [localTab, setTab] = useState(initialTab);
  useEffect(() => setTab(initialTab), [initialTab]);
  const [localView, setView] = useState<"list" | "board" | "timeline">(
    initialBoard ? "board" : "list",
  );
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const tab = presentation?.tab ?? localTab;
  const view = presentation?.view ?? localView;
  const zh = i18n.language.startsWith("zh");
  const chooseTab = (next: TaskPresentation["tab"]) => {
    if (!presentation) setTab(next);
    onPresentationChange?.({ tab: next, view });
  };
  const selected = props.taskIndex;
  const scopedCollections = useMemo(() => {
    const views = {
      now: selected.openActiveTasks,
      later: selected.laterTasks,
      scheduled: selected.scheduledTasks,
      completed: selected.completedTasks,
      all: selected.tasks,
    };
    const intersect = (collection: readonly (typeof props.items)[number][]) => {
      const eligible = new Set(collection.map((item) => item.id));
      return props.items.filter((item) => eligible.has(item.id));
    };
    // Preserve the caller's project/filter/manual ordering once per input
    // revision. Scope switches only choose an existing collection.
    return {
      now: intersect(views.now),
      later: intersect(views.later),
      scheduled: intersect(views.scheduled),
      completed: intersect(views.completed),
      all: intersect(views.all),
    };
  }, [selected, props.items]);
  const items = scopedCollections[tab];
  const selectedItems = items.filter((item) => selectedIds.has(item.id));
  const toggleSelection = (id: string) =>
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const taskSelection = {
    active: selecting,
    selected: selectedIds,
    toggle: toggleSelection,
  };
  function applyBatch(patch: { priority?: Priority; status?: "DONE" }) {
    if (!props.onBatch || !selectedItems.length) return;
    props.onBatch(selectedItems, patch);
    setSelectedIds(new Set());
    setSelecting(false);
  }
  useEffect(() => {
    if (view !== "list") {
      setSelecting(false);
      setSelectedIds(new Set());
    }
  }, [view]);
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
        {view === "list" && (
          <Button
            type="button"
            variant={selecting ? "secondary" : "ghost"}
            aria-pressed={selecting}
            onClick={() => {
              setSelecting((value) => !value);
              setSelectedIds(new Set());
            }}
          >
            {selecting
              ? t("taskWorkspace.exitSelection")
              : t("taskWorkspace.select")}
          </Button>
        )}
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
      {selecting && (
        <div
          className="task-selection-bar"
          role="region"
          aria-label={t("taskWorkspace.selection")}
        >
          <strong>
            {t("taskWorkspace.selectedCount", {
              count: selectedItems.length,
            })}
          </strong>
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              setSelectedIds(new Set(items.map((item) => item.id)))
            }
          >
            {t("taskWorkspace.selectAll")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setSelectedIds(new Set())}
          >
            {t("taskWorkspace.clearSelection")}
          </Button>
          <label>
            <span>{t("taskWorkspace.batchPriority")}</span>
            <Select
              aria-label={t("taskWorkspace.batchPriority")}
              value=""
              disabled={!selectedItems.length}
              onChange={(event) => {
                const priority = event.target.value as Priority;
                if (priority) applyBatch({ priority });
              }}
            >
              <option value="">—</option>
              {(["LOW", "MEDIUM", "HIGH", "URGENT"] as const).map(
                (priority) => (
                  <option key={priority} value={priority}>
                    {tWork("priorities." + priority)}
                  </option>
                ),
              )}
            </Select>
          </label>
          <Button
            type="button"
            variant="secondary"
            disabled={!selectedItems.length}
            onClick={() => applyBatch({ status: "DONE" })}
          >
            {t("taskWorkspace.completeSelected")}
          </Button>
        </div>
      )}
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
          taskSelection={taskSelection}
        />
      )}
    </section>
  );
}
