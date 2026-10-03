import type { EntityRef } from "@arclattice/application";
import { dependency, projectPath } from "@arclattice/domain";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Snapshot } from "../../bootstrap";
import { GraphViewport } from "../graph/GraphViewport";
import { dependencyDagreLayout } from "../graph/layouts/DependencyDagreLayout";
import { useStructuralLayout } from "../graph/layouts/useStructuralLayout";

export function ProjectDependencyGraph({
  snapshot,
  inspector,
  onOpen,
  onSelect,
  fullSnapshot,
}: {
  inspector?: ReactNode;
  snapshot: Snapshot;
  fullSnapshot?: Snapshot;
  onOpen(ref: EntityRef): void;
  onSelect?(ref: EntityRef): void;
}) {
  const { t, i18n } = useTranslation("work");
  const zh = i18n.language.startsWith("zh");
  const [includeExternal, setIncludeExternal] = useState(false);
  const tasks = snapshot.items.filter(
    (item) => item.type === "TASK" && !item.deletedAt,
  );
  const ids = new Set(tasks.map((task) => task.id));
  const external =
    includeExternal && fullSnapshot
      ? fullSnapshot.items.filter(
          (item) =>
            item.type === "TASK" &&
            !item.deletedAt &&
            !ids.has(item.id) &&
            fullSnapshot.edges.some((edge) => {
              const pair = dependency(edge);
              return pair && pair[0] === item.id && ids.has(pair[1]);
            }),
        )
      : [];
  const visibleTasks = [...tasks, ...external];
  const visibleIds = new Set(visibleTasks.map((task) => task.id));
  const edges = (fullSnapshot ?? snapshot).edges
    .filter(
      (edge) =>
        dependency(edge) &&
        visibleIds.has(edge.fromId) &&
        visibleIds.has(edge.toId) &&
        (ids.has(edge.fromId) || ids.has(edge.toId)),
    )
    .map((edge) => ({
      id: edge.id,
      source: edge.type === "REQUIRES" ? edge.toId : edge.fromId,
      target: edge.type === "REQUIRES" ? edge.fromId : edge.toId,
    }));
  const positions = useStructuralLayout(
    visibleTasks.map((task) => task.id),
    edges,
    dependencyDagreLayout,
  );
  const positionsById = new Map(
    positions.map((position) => [position.id, position.position]),
  );
  const nodes = visibleTasks.map((task) => ({
    id: task.id,
    data: {
      label:
        (ids.has(task.id) ? "" : zh ? "外部 · " : "External · ") +
        task.title +
        " · " +
        t("statuses." + task.status) +
        " · " +
        projectPath(task, (fullSnapshot ?? snapshot).items),
    },
    position: positionsById.get(task.id)!,
  }));
  return (
    <section>
      <GraphViewport
        inspector={inspector}
        toolbar={
          <>
            <label>
              <input
                type="checkbox"
                checked={includeExternal}
                onChange={(event) => setIncludeExternal(event.target.checked)}
              />
              {zh ? "外部阻塞" : "External blockers"}
            </label>
          </>
        }
        nodes={nodes}
        edges={edges}
        onOpen={(id) => onOpen({ kind: "WORK", id })}
        onSelect={(id) => onSelect?.({ kind: "WORK", id })}
      />
    </section>
  );
}
