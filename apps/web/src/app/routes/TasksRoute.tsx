import type { ActorContext, WorkItem } from "@arclattice/domain";
import { ChevronDown, ListFilter, ListTodo } from "lucide-react";
import { type ReactNode, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import type { Runtime, Snapshot } from "../../bootstrap";
import { Button } from "../../components/ui/Button";
import { ProjectDependencyGraph } from "../../features/projects/ProjectDependencyGraph";
import { TasksWorkspace } from "../../features/tasks/TasksWorkspace";
import { RecurrenceManager } from "../../RecurrenceManager";
import { RecurrenceSummary } from "../../RecurrenceSummary";
import { Dependencies, type WorkProps } from "../../WorkViews";
import { DismissibleDialog } from "../DismissibleDialog";
import type { TaskPresentationStore } from "../hooks/task-presentation-store";

interface Props {
  runtime: Runtime;
  context: ActorContext;
  snapshot: Snapshot;
  calendarTimezone: string;
  projects: WorkItem[];
  workProps: Omit<WorkProps, "items">;
  visible: WorkItem[];
  showArchived: boolean;
  status: string;
  taskDependenciesOpen: boolean;
  onToggleDependencies(): void;
  run(action: () => Promise<unknown>): Promise<boolean>;
  onOpen(item: WorkItem): void;
  presentationStore: TaskPresentationStore;
  filterFields: ReactNode;
  filterLabels: string[];
  sortLabel: string;
  searching: boolean;
  loading: boolean;
  onCreate(): void;
  onClearFilters(): void;
}
export function TasksRoute({
  runtime,
  context,
  snapshot,
  calendarTimezone,
  projects,
  workProps,
  visible,
  showArchived,
  status,
  taskDependenciesOpen,
  onToggleDependencies,
  run,
  onOpen,
  presentationStore,
  filterFields,
  filterLabels,
  sortLabel,
  searching,
  loading,
  onCreate,
  onClearFilters,
}: Props) {
  const presentation = useSyncExternalStore(
    presentationStore.subscribe,
    presentationStore.getSnapshot,
  );
  const [manage, setManage] = useState(false);
  const { t, i18n } = useTranslation("desk");
  const querySummary = useRef<HTMLElement>(null);
  const label = i18n.language.startsWith("zh")
    ? "管理周期任务"
    : "Manage recurring tasks";
  const filtered = searching || filterLabels.length > 0;
  const scopeEmpty =
    workProps.taskIndex.tasks.length > 0 && presentation.tab !== "all";
  const emptyTitle = filtered
    ? t("taskWorkspace.noMatches")
    : scopeEmpty
      ? t("taskWorkspace.emptyScope", {
          scope: t("taskWorkspace." + presentation.tab),
        })
      : t("taskWorkspace.firstTask");
  function recoverEmptyList() {
    if (!filtered && !scopeEmpty) {
      onCreate();
      return;
    }
    if (filtered) onClearFilters();
    else presentationStore.set({ ...presentation, tab: "all" });
    querySummary.current?.focus();
  }
  return (
    <div className="personal-tasks">
      {manage && (
        <DismissibleDialog
          className="recurring-series-dialog"
          aria-label={label}
          onRequestClose={() => setManage(false)}
        >
          <Button type="button" onClick={() => setManage(false)}>
            {i18n.language.startsWith("zh") ? "关闭" : "Close"}
          </Button>
          <RecurrenceManager
            skip={(id, version) =>
              run(() => runtime.skipOccurrence(id, version))
            }
            calendarTimezone={calendarTimezone}
            records={snapshot.workflows ?? []}
            projects={projects}
            items={workProps.allItems}
            busy={false}
            preview={(projectId, manifest) =>
              run(() => runtime.previewPlan(projectId, manifest))
            }
            publish={(id, version) =>
              run(() => runtime.publishPlan(id, version))
            }
            save={(input) => run(() => runtime.saveRecurrence(input))}
            generate={(id, version, from, to) =>
              run(() => runtime.generateRecurrence(id, version, from, to))
            }
            backfill={(id, version, completedAt) =>
              run(() => runtime.backfillOccurrence(id, version, completedAt))
            }
          />
        </DismissibleDialog>
      )}
      {taskDependenciesOpen && (
        <>
          <ProjectDependencyGraph
            snapshot={snapshot}
            onOpen={(ref) => {
              const item = snapshot.items.find((i) => i.id === ref.id);
              if (item) onOpen(item);
            }}
          />
          <Dependencies
            items={workProps.allItems}
            edges={snapshot.edges}
            busy={false}
            onAdd={(from, to) =>
              run(() => runtime.service.addEdge(context, from, to))
            }
            onRemove={(id) =>
              run(() => runtime.service.removeEdge(context, id))
            }
          />
        </>
      )}
      <TasksWorkspace
        viewActions={
          <>
            <details className="task-query-panel">
              <summary ref={querySummary}>
                <ListFilter size={16} aria-hidden="true" />
                {t("taskWorkspace.filters")}
                {(filterLabels.length > 0 || sortLabel) && (
                  <span className="task-filter-summary">
                    {[...filterLabels, sortLabel].filter(Boolean).join(" · ")}
                  </span>
                )}
                <ChevronDown size={14} aria-hidden="true" />
              </summary>
              {filterFields}
              {filtered && (
                <Button variant="text" onClick={recoverEmptyList}>
                  {t("taskWorkspace.clearFilters")}
                </Button>
              )}
            </details>
            <RecurrenceSummary
              records={snapshot.workflows ?? []}
              timezone={calendarTimezone}
              onManage={() => setManage(true)}
            />
          </>
        }
        emptyList={
          loading ? (
            <p role="status">{t("taskWorkspace.loadingTasks")}</p>
          ) : (
            <div className="task-list-empty">
              <ListTodo size={24} aria-hidden="true" />
              <strong>{emptyTitle}</strong>
              <Button
                variant="secondary"
                disabled={workProps.busy}
                onClick={recoverEmptyList}
              >
                {t(
                  filtered
                    ? "taskWorkspace.clearFilters"
                    : scopeEmpty
                      ? "taskWorkspace.viewAll"
                      : "taskWorkspace.createFirst",
                )}
              </Button>
            </div>
          )
        }
        onDependencies={onToggleDependencies}
        presentation={presentation}
        onPresentationChange={presentationStore.set}
        {...workProps}
        items={visible}
        includeArchived={showArchived}
        initialTab={
          status === "DONE"
            ? "completed"
            : status === "ALL" ||
                new URLSearchParams(location.hash.split("?")[1]).get("tab") ===
                  "all"
              ? "all"
              : "now"
        }
        initialBoard={
          new URLSearchParams(location.hash.split("?")[1]).get("view") ===
          "board"
        }
      />
    </div>
  );
}
