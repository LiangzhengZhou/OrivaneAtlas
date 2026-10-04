import dagre from "@dagrejs/dagre";

export function dependencyDagreLayout(
  ids: readonly string[],
  edges: readonly { source: string; target: string }[],
) {
  // Local acyclic neighborhoods need ranks, not Dagre's global crossing sweeps.
  // Keep the full layout for larger graphs and cycles.
  if (ids.length <= 40) {
    const incoming = new Map(ids.map((id) => [id, 0]));
    const outgoing = new Map(ids.map((id) => [id, new Set<string>()]));
    const rank = new Map(ids.map((id) => [id, 0]));
    for (const { source, target } of edges) {
      const targets = outgoing.get(source);
      if (!targets || !incoming.has(target) || targets.has(target)) continue;
      targets.add(target);
      incoming.set(target, incoming.get(target)! + 1);
    }
    const queue = ids.filter((id) => incoming.get(id) === 0);
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const source = queue[cursor]!;
      for (const target of outgoing.get(source)!) {
        rank.set(target, Math.max(rank.get(target)!, rank.get(source)! + 1));
        incoming.set(target, incoming.get(target)! - 1);
        if (incoming.get(target) === 0) queue.push(target);
      }
    }
    if (queue.length === ids.length) {
      const columns = new Map<number, string[]>();
      for (const id of ids) {
        const level = rank.get(id)!;
        const column = columns.get(level) ?? [];
        column.push(id);
        columns.set(level, column);
      }
      const height = Math.max(
        0,
        ...[...columns.values()].map((column) => column.length),
      );
      const positions = new Map<string, { x: number; y: number }>();
      for (const [level, column] of columns)
        column.forEach((id, row) => {
          positions.set(id, {
            x: level * 300,
            y: ((height - column.length) / 2 + row) * 115,
          });
        });
      return ids.map((id) => ({ id, position: positions.get(id)! }));
    }
  }
  const graph = new dagre.graphlib.Graph()
    .setGraph({ rankdir: "LR", nodesep: 50, ranksep: 100 })
    .setDefaultEdgeLabel(() => ({}));
  for (const id of ids) graph.setNode(id, { width: 200, height: 65 });
  for (const edge of edges) graph.setEdge(edge.source, edge.target);
  dagre.layout(graph);
  return ids.map((id) => ({
    id,
    position: { x: graph.node(id).x, y: graph.node(id).y },
  }));
}
