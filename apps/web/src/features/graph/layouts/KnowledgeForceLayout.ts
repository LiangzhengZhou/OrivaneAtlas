import {
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationNodeDatum,
} from "d3-force";

export function knowledgeForceLayout(
  ids: readonly string[],
  edges: readonly { source: string; target: string }[],
) {
  const nodes: (SimulationNodeDatum & { id: string })[] = ids.map((id) => ({
    id,
  }));
  const simulation = forceSimulation(nodes)
    .force("charge", forceManyBody().strength(-1500))
    .force(
      "link",
      forceLink(edges.map((edge) => ({ ...edge })))
        .id((node) => (node as { id: string }).id)
        .distance(180),
    )
    .force("center", forceCenter(400, 280))
    .stop();
  for (let tick = 0; tick < 150; tick++) simulation.tick();
  return nodes.map((node) => ({
    id: node.id,
    position: { x: node.x ?? 0, y: node.y ?? 0 },
  }));
}
