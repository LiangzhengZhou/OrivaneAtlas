import dagre from "@dagrejs/dagre";
import {
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationNodeDatum,
} from "d3-force";

self.onmessage = (
  event: MessageEvent<{
    id: number;
    kind: string;
    nodes: string[];
    edges: { source: string; target: string }[];
  }>,
) => {
  const { id, kind, nodes, edges } = event.data;
  let positions: { id: string; x: number; y: number }[];
  if (kind === "tasks") {
    const graph = new dagre.graphlib.Graph()
      .setGraph({ rankdir: "LR", nodesep: 50, ranksep: 100 })
      .setDefaultEdgeLabel(() => ({}));
    for (const node of nodes) graph.setNode(node, { width: 200, height: 65 });
    for (const edge of edges) graph.setEdge(edge.source, edge.target);
    dagre.layout(graph);
    positions = nodes.map((id) => ({
      id,
      x: graph.node(id).x,
      y: graph.node(id).y,
    }));
  } else {
    const points: (SimulationNodeDatum & { id: string })[] = nodes.map(
      (id) => ({ id }),
    );
    const simulation = forceSimulation(points)
      .force("charge", forceManyBody().strength(-2000))
      .force(
        "link",
        forceLink(edges.map((e) => ({ ...e })))
          .id((n) => (n as { id: string }).id)
          .distance(220),
      )
      .force("center", forceCenter(500, 350))
      .stop();
    for (let i = 0; i < 180; i++) simulation.tick();
    positions = points.map((n) => ({ id: n.id, x: n.x ?? 0, y: n.y ?? 0 }));
  }
  self.postMessage({ id, positions });
};
