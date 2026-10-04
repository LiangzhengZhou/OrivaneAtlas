import type { EntityRef } from "@arclattice/application";
import { dependency } from "@arclattice/domain";
import { MarkerType } from "@xyflow/react";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Snapshot } from "../../bootstrap";
import { GraphViewport } from "../graph/GraphViewport";
import { dependencyNeighborhood } from "../graph/graph-scope";
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
  onStateChange,
  onWorkspace,
  workspace = false,
  selectionId,
}: {
  snapshot: Snapshot;
  fullSnapshot?: Snapshot;
  inspector?: ReactNode;
  onOpen(ref: EntityRef): void;
  onSelect?(ref: EntityRef): void;
  initialFocus?: string;
  initialHops?: number;
  initialScope?: string;
  onStateChange?(state: { focus: string; hops: number; scope: string }): void;
  onWorkspace?(): void;
  workspace?: boolean;
  selectionId?: string | undefined;
}) {
  const { i18n } = useTranslation();
  const text = (cn: string, en: string) =>
    i18n.language.startsWith("zh") ? cn : en;
  const [focus, setFocus] = useState(initialFocus),
    [hops, setHops] = useState(initialHops),
    [scope, setScope] = useState(initialScope),
    [includeExternal, setExternal] = useState(false);
  useEffect(() => {
    setFocus(initialFocus);
    setHops(initialHops);
    setScope(initialScope);
  }, [initialFocus, initialHops, initialScope]);
  const all = fullSnapshot ?? snapshot;
  const tasks = snapshot.items.filter((i) => i.type === "TASK" && !i.deletedAt);
  const scopedIds = new Set(tasks.map((i) => i.id));
  const update = (
    next: Partial<{ focus: string; hops: number; scope: string }>,
  ) => {
    const state = { focus, hops, scope, ...next };
    setFocus(state.focus);
    setHops(state.hops);
    setScope(state.scope);
    onStateChange?.(state);
  };
  const visible =
    scope === "project"
      ? all.items.filter(
          (i) =>
            i.type === "TASK" &&
            !i.deletedAt &&
            (scopedIds.has(i.id) ||
              (includeExternal &&
                all.edges.some((e) => {
                  const pair = dependency(e);
                  return pair && pair[0] === i.id && scopedIds.has(pair[1]);
                }))),
        )
      : dependencyNeighborhood(all.items, all.edges, focus, hops);
  const ids = new Set(visible.map((i) => i.id));
  const edges = all.edges.flatMap((edge) => {
    const pair = dependency(edge);
    return pair && ids.has(pair[0]) && ids.has(pair[1])
      ? [
          {
            id: edge.id,
            source: pair[0],
            target: pair[1],
            markerEnd: { type: MarkerType.ArrowClosed },
          },
        ]
      : [];
  });
  const positions = useStructuralLayout([...ids], edges, dependencyDagreLayout);
  const byId = new Map(positions.map((p) => [p.id, p.position]));
  const counts = new Map<string, { blockers: number; dependents: number }>();
  for (const edge of all.edges) {
    const pair = dependency(edge);
    if (!pair) continue;
    const source = counts.get(pair[0]) ?? { blockers: 0, dependents: 0 },
      target = counts.get(pair[1]) ?? { blockers: 0, dependents: 0 };
    source.dependents++;
    target.blockers++;
    counts.set(pair[0], source);
    counts.set(pair[1], target);
  }
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
            hops === 1 &&
            (counts.get(task.id)?.blockers ?? 0) +
              (counts.get(task.id)?.dependents ?? 0) >
              0 && (
              <button
                type="button"
                className="text-button"
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
              </button>
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
    <section className="dependency-focus-graph">
      <GraphViewport
        workspace={workspace}
        selectionId={selectionId}
        onWorkspace={onWorkspace}
        inspector={inspector}
        toolbar={
          <div className="action-row">
            <label>
              {text("焦点任务", "Focus task")}
              <TaskEntityPicker
                mode="single"
                disabled={false}
                label={text("选择焦点任务", "Choose focus task")}
                items={all.items}
                values={focus ? [focus] : []}
                onChange={(values) =>
                  update({ focus: values.at(-1) ?? "", scope: "focus" })
                }
              />
            </label>
            {[1, 2].map((value) => (
              <button
                type="button"
                className="chip"
                key={value}
                aria-pressed={scope === "focus" && hops === value}
                onClick={() => update({ hops: value, scope: "focus" })}
              >
                {value} {text("跳", "hop")}
              </button>
            ))}
            <button
              type="button"
              className="chip"
              aria-pressed={scope === "project"}
              onClick={() => update({ scope: "project" })}
            >
              {text("项目范围", "Project scope")}
            </button>
            {scope === "project" && (
              <label>
                <input
                  type="checkbox"
                  checked={includeExternal}
                  onChange={(e) => setExternal(e.target.checked)}
                />
                {text("外部阻塞", "External blockers")}
              </label>
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
