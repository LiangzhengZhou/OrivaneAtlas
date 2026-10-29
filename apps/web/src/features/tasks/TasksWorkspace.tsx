import type { Priority } from "@arclattice/domain";
import { Bookmark, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, SegmentedControl, Toolbar } from "../../components/ui/Button";
import { MenuItem } from "../../components/ui/Content";
import { Menu, Select } from "../../components/ui/Surfaces";
import {
  type TaskGrouping,
  TaskGroups,
  TaskList,
  WorkBoard,
  type WorkProps,
} from "../../WorkViews";
import {
  loadSavedTaskViews,
  type SavedTaskView,
  savedTaskViewId,
  saveSavedTaskViews,
} from "./saved-task-views";
import { TaskGantt } from "./TaskGantt";
import { TaskTimeline } from "./TaskTimeline";
export type TaskPresentation = {
  tab: "now" | "later" | "scheduled" | "completed" | "all";
  view: "list" | "board" | "timeline";
  group?: TaskGrouping;
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
  const [localGroup, setLocalGroup] = useState<TaskGrouping>("none");
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const tab = presentation?.tab ?? localTab;
  const view = presentation?.view ?? localView;
  const group = presentation?.group ?? localGroup;
  const chooseGroup = (next: TaskGrouping) => {
    if (!presentation) setLocalGroup(next);
    onPresentationChange?.({ tab, view, group: next });
  };
  const [savedViews, setSavedViews] =
    useState<readonly SavedTaskView[]>(loadSavedTaskViews);
  const [savedViewsOpen, setSavedViewsOpen] = useState(false);
  const savedViewsAnchor = useRef<HTMLButtonElement>(null);
  const applyPresentation = (next: TaskPresentation) => {
    setTab(next.tab);
    setView(next.view);
    setLocalGroup(next.group ?? "none");
    onPresentationChange?.(next);
  };
  const saveCurrentView = () => {
    const name = globalThis.prompt?.(
      i18n.language.startsWith("zh") ? "视图名称" : "View name",
    );
    if (!name?.trim()) return;
    const next = [
      ...savedViews,
      {
        id: savedTaskViewId(),
        name: name.trim().slice(0, 60),
        presentation: { tab, view, group },
      },
    ].slice(0, 12);
    setSavedViews(next);
    saveSavedTaskViews(next);
    setSavedViewsOpen(false);
  };
  const removeSavedView = (id: string) => {
    const next = savedViews.filter((entry) => entry.id !== id);
    setSavedViews(next);
    saveSavedTaskViews(next);
  };
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
        {view === "list" && (
          <label className="task-group-control">
            <span>{t("taskWorkspace.groupBy")}</span>
            <Select
              aria-label={t("taskWorkspace.groupBy")}
              value={group}
              onChange={(event) =>
                chooseGroup(event.target.value as TaskGrouping)
              }
            >
              <option value="none">{t("taskWorkspace.groupNone")}</option>
              <option value="project">{t("taskWorkspace.groupProject")}</option>
              <option value="priority">
                {t("taskWorkspace.groupPriority")}
              </option>
              <option value="status">{t("taskWorkspace.groupStatus")}</option>
            </Select>
          </label>
        )}
        {view === "list" && (
          <Button
            ref={savedViewsAnchor}
            type="button"
            variant="ghost"
            aria-expanded={savedViewsOpen}
            aria-haspopup="menu"
            onClick={() => setSavedViewsOpen((value) => !value)}
          >
            <Bookmark size={14} />
            {t("taskWorkspace.savedViews")}
          </Button>
        )}
        {savedViewsOpen && (
          <Menu
            anchorRef={savedViewsAnchor}
            label={t("taskWorkspace.savedViews")}
            onDismiss={() => setSavedViewsOpen(false)}
          >
            <MenuItem onClick={saveCurrentView}>
              <Bookmark size={14} /> {t("taskWorkspace.saveCurrentView")}
            </MenuItem>
            {savedViews.map((entry) => (
              <MenuItem
                key={entry.id}
                onClick={() => {
                  applyPresentation(entry.presentation);
                  setSavedViewsOpen(false);
                }}
              >
                {entry.name}
              </MenuItem>
            ))}
            {savedViews.map((entry) => (
              <MenuItem
                key={`delete:${entry.id}`}
                className="ui-menu-item-danger"
                onClick={() => removeSavedView(entry.id)}
              >
                <Trash2 size={14} /> {t("taskWorkspace.deleteView")}:{" "}
                {entry.name}
              </MenuItem>
            ))}
          </Menu>
        )}
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
      ) : group === "none" ? (
        <TaskList
          {...props}
          items={items}
          derived={props.derived ?? selected.derived}
          taskSelection={taskSelection}
        />
      ) : (
        <TaskGroups
          {...props}
          items={items}
          grouping={group}
          derived={props.derived ?? selected.derived}
          taskSelection={taskSelection}
        />
      )}
    </section>
  );
}
