import dagre from "@dagrejs/dagre";

export function dependencyDagreLayout(
  ids: readonly string[],
  edges: readonly { source: string; target: string }[],
) {
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
