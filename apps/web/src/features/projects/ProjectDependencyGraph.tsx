import type { EntityRef } from "@arclattice/application";
import { dependency } from "@arclattice/domain";
import type { Snapshot } from "../../bootstrap";
import { GraphViewport } from "../graph/GraphViewport";
import { dependencyDagreLayout } from "../graph/layouts/DependencyDagreLayout";

export function ProjectDependencyGraph({
  snapshot,
  onOpen,
  onSelect,
}: {
  snapshot: Snapshot;
  onOpen(ref: EntityRef): void;
  onSelect?(ref: EntityRef): void;
}) {
  const tasks = snapshot.items.filter(
    (item) => item.type === "TASK" && !item.deletedAt,
  );
  const ids = new Set(tasks.map((task) => task.id));
  const edges = snapshot.edges
    .filter(
      (edge) => dependency(edge) && ids.has(edge.fromId) && ids.has(edge.toId),
    )
    .map((edge) => ({
      id: edge.id,
      source: edge.type === "REQUIRES" ? edge.toId : edge.fromId,
      target: edge.type === "REQUIRES" ? edge.fromId : edge.toId,
    }));
  const positions = dependencyDagreLayout(
    tasks.map((task) => task.id),
    edges,
  );
  const nodes = tasks.map((task) => ({
    id: task.id,
    data: { label: task.title },
    position: positions.find((position) => position.id === task.id)!.position,
  }));
  return (
    <GraphViewport
      nodes={nodes}
      edges={edges}
      onOpen={(id) => onOpen({ kind: "WORK", id })}
      onSelect={(id) => onSelect?.({ kind: "WORK", id })}
    />
  );
}
