import type { ActorContext, WorkItem } from "@arclattice/domain";
import type { Runtime, Snapshot } from "../../bootstrap";
import { ProjectDependencyGraph } from "../../features/projects/ProjectDependencyGraph";
import { TasksWorkspace } from "../../features/tasks/TasksWorkspace";
import { RecurrenceManager } from "../../RecurrenceManager";
import { Dependencies, type WorkProps } from "../../WorkViews";

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
}: Props) {
  return (
    <>
      <RecurrenceManager
        calendarTimezone={calendarTimezone}
        records={snapshot.workflows ?? []}
        projects={projects}
        items={workProps.allItems}
        busy={false}
        preview={(projectId, manifest) =>
          run(() => runtime.previewPlan(projectId, manifest))
        }
        publish={(id, version) => run(() => runtime.publishPlan(id, version))}
        save={(input) => run(() => runtime.saveRecurrence(input))}
        generate={(id, version, from, to) =>
          run(() => runtime.generateRecurrence(id, version, from, to))
        }
        backfill={(id, version, completedAt) =>
          run(() => runtime.backfillOccurrence(id, version, completedAt))
        }
      />
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
        onDependencies={onToggleDependencies}
        key={location.hash}
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
    </>
  );
}
