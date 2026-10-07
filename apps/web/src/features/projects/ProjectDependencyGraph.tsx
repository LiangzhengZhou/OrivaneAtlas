import type { EntityRef } from "@arclattice/application";
import { MarkerType } from "@xyflow/react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Snapshot } from "../../bootstrap";
import { Button, SegmentedControl } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/Surfaces";
import {
  GraphViewport,
  type GraphViewportStateProps,
} from "../graph/GraphViewport";
import { collectionRevision } from "../graph/graph-revision";
import {
  buildDependencyGraphIndex,
  indexedDependencyNeighborhood,
  type ProjectTaskScope,
  projectDependencyMembership,
} from "../graph/graph-scope";
import { dependencyDagreLayout } from "../graph/layouts/DependencyDagreLayout";
import { useStructuralLayout } from "../graph/layouts/useStructuralLayout";
import { TaskEntityPicker } from "../tasks/TaskEntityPicker";
export function ProjectDependencyGraph({
  snapshot,
  fullSnapshot,
  inspector,
  onOpen,
  onSelect,
  initialFocus = "",
  initialHops = 1,
  initialScope = "focus",
  initialTaskScope = "DIRECT_PROJECT",
  initialIncludeExternal = false,
  onStateChange,
  onWorkspace,
  workspace = false,
  selectionId,
  scopeProjectId,
  initialViewport,
  onViewportChange,
}: {
  snapshot: Snapshot;
  fullSnapshot?: Snapshot;
  inspector?: ReactNode;
  onOpen(ref: EntityRef): void;
  onSelect?(ref: EntityRef): void;
  initialFocus?: string;
  initialHops?: number;
  initialScope?: string;
  initialTaskScope?: ProjectTaskScope;
  initialIncludeExternal?: boolean;
  onStateChange?(state: {
    focus: string;
    hops: number;
    scope: string;
    taskScope: ProjectTaskScope;
    includeExternal: boolean;
  }): void;
  onWorkspace?(): void;
  workspace?: boolean;
  selectionId?: string | undefined;
  scopeProjectId?: string;
} & GraphViewportStateProps) {
  const { i18n } = useTranslation();
  const text = (cn: string, en: string) =>
    i18n.language.startsWith("zh") ? cn : en;
  const [focus, setFocus] = useState(initialFocus),
    [hops, setHops] = useState(initialHops),
    [scope, setScope] = useState(initialScope),
    [taskScope, setTaskScope] = useState(initialTaskScope),
    [includeExternal, setExternal] = useState(initialIncludeExternal),
    [focusCleared, setFocusCleared] = useState(false);
  useEffect(() => {
    setFocus(initialFocus);
    setHops(initialHops);
    setScope(initialScope);
    setTaskScope(initialTaskScope);
    setExternal(initialIncludeExternal);
  }, [
    initialFocus,
    initialHops,
    initialScope,
    initialTaskScope,
    initialIncludeExternal,
  ]);
  const all = fullSnapshot ?? snapshot;
  const index = useMemo(
    () => buildDependencyGraphIndex(all.items, all.edges),
    [all.items, all.edges],
  );
  const { counts } = index;
  const membership = useMemo(
    () =>
      scopeProjectId
        ? projectDependencyMembership(index, scopeProjectId, taskScope)
        : null,
    [index, scopeProjectId, taskScope],
  );
  const scopedIds = useMemo(
    () =>
      membership?.taskIds ??
      new Set(
        snapshot.items
          .filter((i) => i.type === "TASK" && !i.deletedAt)
          .map((i) => i.id),
      ),
    [snapshot.items, membership],
  );
  const pickerItems = useMemo(
    () =>
      membership
        ? all.items.filter(
            (item) =>
              membership.taskIds.has(item.id) ||
              membership.projectIds.has(item.id),
          )
        : snapshot.items,
    [all.items, membership, snapshot.items],
  );
  useEffect(() => {
    if (focus && !scopedIds.has(focus)) {
      setFocus("");
      setFocusCleared(true);
      onStateChange?.({ focus: "", hops, scope, taskScope, includeExternal });
    }
  }, [
    focus,
    scopedIds,
    hops,
    scope,
    taskScope,
    includeExternal,
    onStateChange,
  ]);
  const externalBlockers = useMemo(() => {
    const ids = new Set<string>();
    for (const edge of index.connections) {
      if (scopedIds.has(edge.target)) ids.add(edge.source);
    }
    return ids;
  }, [scopedIds, index]);
  const update = (
    next: Partial<{
      focus: string;
      hops: number;
      scope: string;
      taskScope: ProjectTaskScope;
      includeExternal: boolean;
    }>,
  ) => {
    const state = { focus, hops, scope, taskScope, includeExternal, ...next };
    if (scopeProjectId && next.taskScope) {
      const members = projectDependencyMembership(
        index,
        scopeProjectId,
        next.taskScope,
      );
      if (state.focus && !members.taskIds.has(state.focus)) {
        state.focus = "";
        setFocusCleared(true);
      }
    }
    setFocus(state.focus);
    setHops(state.hops);
    setScope(state.scope);
    setTaskScope(state.taskScope);
    setExternal(state.includeExternal);
    onStateChange?.(state);
  };
  const visible =
    !focus || !scopedIds.has(focus)
      ? []
      : scope === "project"
        ? all.items.filter(
            (i) =>
              i.type === "TASK" &&
              !i.deletedAt &&
              (scopedIds.has(i.id) ||
                (includeExternal && externalBlockers.has(i.id))),
          )
        : indexedDependencyNeighborhood(
            index,
            scopedIds.has(focus) ? focus : "",
            hops,
          ).filter(
            (task) =>
              scopedIds.has(task.id) ||
              (includeExternal && externalBlockers.has(task.id)),
          );
  const ids = new Set(visible.map((i) => i.id));
  const edges = index.connections.flatMap((edge) => {
    return ids.has(edge.source) && ids.has(edge.target)
      ? [
          {
            id: edge.id,
            source: edge.source,
            target: edge.target,
            markerEnd: { type: MarkerType.ArrowClosed },
          },
        ]
      : [];
  });
  const layoutKey = `${collectionRevision(all.items)}:${collectionRevision(all.edges)}:${scope}:${focus}:${hops}:${includeExternal}:${[...scopedIds].join(",")}`;
  const positions = useStructuralLayout(
    [...ids],
    edges,
    dependencyDagreLayout,
    layoutKey,
  );
  const byId = new Map(positions.map((p) => [p.id, p.position]));
  const nodes = visible.map((task) => ({
    id: task.id,
    data: {
      title: task.title,
      label: (
        <div className="dependency-node-label">
          <span>{task.title}</span>
          <small>
            {text("前置", "Blockers")} {counts.get(task.id)?.blockers ?? 0} ·{" "}
            {text("后续", "Dependents")} {counts.get(task.id)?.dependents ?? 0}
          </small>
          {scope !== "project" &&
            scopedIds.has(task.id) &&
            hops === 1 &&
            (counts.get(task.id)?.blockers ?? 0) +
              (counts.get(task.id)?.dependents ?? 0) >
              0 && (
              <Button
                variant="ghost"
                type="button"
                aria-label={
                  text("展开关系", "Expand relations") + ": " + task.title
                }
                onClick={(event) => {
                  event.stopPropagation();
                  update({ focus: task.id, hops: 2, scope: "focus" });
                }}
              >
                +
                {(counts.get(task.id)?.blockers ?? 0) +
                  (counts.get(task.id)?.dependents ?? 0)}
              </Button>
            )}
        </div>
      ),
    },
    position: byId.get(task.id)!,
    style: {
      opacity: task.status === "DONE" ? 0.55 : 1,
      borderStyle: scopedIds.has(task.id) ? "solid" : "dashed",
      borderWidth: task.id === focus ? 2 : 1,
    },
  }));
  return (
    <section
      className="dependency-focus-graph"
      data-project-id={scopeProjectId}
    >
      <GraphViewport
        initialViewport={initialViewport}
        onViewportChange={onViewportChange}
        emptyState={
          !focus ? (
            <EmptyState
              title={text("选择一个焦点任务", "Select a focus task")}
            />
          ) : undefined
        }
        layoutKey={layoutKey}
        workspace={workspace}
        selectionId={selectionId}
        onWorkspace={onWorkspace}
        inspector={inspector}
        toolbar={
          <div className="action-row">
            {scopeProjectId && (
              <SegmentedControl
                label={text("任务依赖范围", "Task dependency scope")}
                value={taskScope}
                options={[
                  {
                    value: "DIRECT_PROJECT",
                    label: text("本项目", "This project"),
                  },
                  {
                    value: "PROJECT_TREE",
                    label: text("包含子项目", "Include subprojects"),
                  },
                ]}
                onChange={(taskScope) => update({ taskScope })}
              />
            )}
            <label>
              {text("焦点任务", "Focus task")}
              <TaskEntityPicker
                key={`${scopeProjectId ?? "workspace"}:${taskScope}`}
                {...(scopeProjectId ? { scopeProjectId } : {})}
                mode="single"
                disabled={false}
                label={text("选择焦点任务", "Choose focus task")}
                items={pickerItems}
                values={focus ? [focus] : []}
                onChange={(values) =>
                  update({ focus: values.at(-1) ?? "", scope: "focus" })
                }
              />
            </label>
            {[1, 2].map((value) => (
              <Button
                type="button"
                variant="toggle"
                key={value}
                disabled={!focus}
                aria-pressed={scope === "focus" && hops === value}
                onClick={() => update({ hops: value, scope: "focus" })}
              >
                {value === 1
                  ? text("直接关系", "Direct relations")
                  : text("扩展两层", "Expand two levels")}
              </Button>
            ))}
            <Button
              type="button"
              variant="toggle"
              disabled={!focus}
              aria-pressed={scope === "project"}
              onClick={() => update({ scope: "project" })}
            >
              {text("范围内全部任务", "All tasks in scope")}
            </Button>
            {
              <label>
                <input
                  type="checkbox"
                  checked={includeExternal}
                  onChange={(e) =>
                    update({ includeExternal: e.target.checked })
                  }
                />
                {text("显示项目外阻塞", "Show external blockers")}
              </label>
            }
            {focusCleared && !focus && (
              <p role="status">
                {text(
                  "当前焦点不在此范围内，请重新选择任务。",
                  "The focus task is outside this scope. Choose another task.",
                )}
              </p>
            )}
            {!focus && scope === "focus" && (
              <p>
                {text(
                  "选择一个任务查看局部依赖",
                  "Choose a task to inspect its dependencies",
                )}
              </p>
            )}
            {focus && counts.has(focus) && (
              <small>
                {text("前置", "Blockers")} {counts.get(focus)?.blockers} ·{" "}
                {text("后续", "Dependents")} {counts.get(focus)?.dependents}
              </small>
            )}
          </div>
        }
        nodes={nodes}
        edges={edges}
        onOpen={(id) => onOpen({ kind: "WORK", id })}
        onSelect={(id) => onSelect?.({ kind: "WORK", id })}
      />
    </section>
  );
}
