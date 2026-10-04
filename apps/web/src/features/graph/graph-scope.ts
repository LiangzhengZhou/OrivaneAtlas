import { dependency, type WorkEdge, type WorkItem } from "@arclattice/domain";
export function buildDependencyGraphIndex(
  items: readonly WorkItem[],
  edges: readonly WorkEdge[],
) {
  const tasks = new Map(
    items
      .filter((i) => i.type === "TASK" && !i.deletedAt)
      .map((i) => [i.id, i]),
  );
  const neighbors = new Map<string, Set<string>>();
  const counts = new Map<string, { blockers: number; dependents: number }>();
  const connections: { id: string; source: string; target: string }[] = [];
  const order = new Map([...tasks.keys()].map((id, index) => [id, index]));
  for (const edge of edges) {
    const pair = dependency(edge);
    if (!pair) continue;
    const source = counts.get(pair[0]) ?? { blockers: 0, dependents: 0 };
    const target = counts.get(pair[1]) ?? { blockers: 0, dependents: 0 };
    source.dependents++;
    target.blockers++;
    counts.set(pair[0], source);
    counts.set(pair[1], target);
    connections.push({ id: edge.id, source: pair[0], target: pair[1] });
    if (!tasks.has(pair[0]) || !tasks.has(pair[1])) continue;
    for (const [a, b] of [pair, [pair[1], pair[0]]] as [string, string][]) {
      const set = neighbors.get(a) ?? new Set<string>();
      set.add(b);
      neighbors.set(a, set);
    }
  }
  return { tasks, neighbors, counts, connections, order };
}

export function indexedDependencyNeighborhood(
  index: ReturnType<typeof buildDependencyGraphIndex>,
  focus: string,
  hops: number,
) {
  const { tasks, neighbors, order } = index;
  const visible = new Set<string>(tasks.has(focus) ? [focus] : []);
  let frontier = [...visible];
  for (let hop = 0; hop < Math.min(2, Math.max(0, hops)); hop++) {
    const next: string[] = [];
    for (const id of frontier)
      for (const neighbor of neighbors.get(id) ?? []) {
        if (!visible.has(neighbor)) {
          visible.add(neighbor);
          next.push(neighbor);
        }
      }
    frontier = next;
  }
  return [...visible]
    .sort((a, b) => order.get(a)! - order.get(b)!)
    .map((id) => tasks.get(id)!);
}

export function dependencyNeighborhood(
  items: readonly WorkItem[],
  edges: readonly WorkEdge[],
  focus: string,
  hops: number,
) {
  return indexedDependencyNeighborhood(
    buildDependencyGraphIndex(items, edges),
    focus,
    hops,
  );
}
export function projectDepth(
  items: readonly WorkItem[],
  root: string,
  depth: number,
) {
  const byParent = new Map<string, WorkItem[]>();
  const projects = items.filter((i) => i.type === "PROJECT" && !i.deletedAt);
  for (const project of projects) {
    const parent = project.parentProjectId ?? "";
    const list = byParent.get(parent) ?? [];
    list.push(project);
    byParent.set(parent, list);
  }
  const ids = new Set(projects.some((p) => p.id === root) ? [root] : []);
  let frontier = [...ids];
  for (let level = 0; level < Math.min(16, Math.max(0, depth)); level++) {
    const next: string[] = [];
    for (const id of frontier)
      for (const child of byParent.get(id) ?? []) {
        if (!ids.has(child.id)) {
          ids.add(child.id);
          next.push(child.id);
        }
      }
    frontier = next;
  }
  return projects.filter((p) => ids.has(p.id));
}
