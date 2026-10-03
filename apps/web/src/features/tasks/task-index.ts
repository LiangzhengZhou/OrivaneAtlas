import {
  type AvailabilityState,
  availability,
  dependency,
  type WorkEdge,
  type WorkItem,
} from "@arclattice/domain";

export function taskDerivedIndex(
  items: readonly WorkItem[],
  edges: readonly WorkEdge[],
  today: string,
) {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const edgesByTaskId = new Map<string, WorkEdge[]>();
  const blockersByTaskId = new Map<string, string[]>();
  for (const edge of edges) {
    const pair = dependency(edge);
    if (!pair) continue;
    const target = itemsById.get(pair[1]);
    if (!target || target.workspaceId !== edge.workspaceId) continue;
    const list = edgesByTaskId.get(target.id) ?? [];
    list.push(edge);
    edgesByTaskId.set(target.id, list);
    const source = itemsById.get(pair[0]);
    if (
      !source ||
      source.deletedAt ||
      source.workspaceId !== target.workspaceId ||
      source.status !== "DONE"
    ) {
      const blocked = blockersByTaskId.get(target.id) ?? [];
      blocked.push(pair[0]);
      blockersByTaskId.set(target.id, blocked);
    }
  }
  const projectTitlesByTaskId = new Map<string, string>();
  const availabilityByTaskId = new Map<string, AvailabilityState>();
  for (const item of items) {
    if (item.type !== "TASK") continue;
    projectTitlesByTaskId.set(
      item.id,
      (item.projectIds ?? [])
        .map((id) => itemsById.get(id))
        .filter(
          (project): project is WorkItem =>
            !!project &&
            project.workspaceId === item.workspaceId &&
            !project.deletedAt,
        )
        .map((project) => project.title)
        .join(" · "),
    );
    const prerequisites = (edgesByTaskId.get(item.id) ?? []).flatMap((edge) => {
      const pair = dependency(edge);
      const source = pair ? itemsById.get(pair[0]) : undefined;
      return source ? [source] : [];
    });
    availabilityByTaskId.set(
      item.id,
      availability(
        item,
        prerequisites,
        edgesByTaskId.get(item.id) ?? [],
        today,
      ),
    );
  }
  return { blockersByTaskId, projectTitlesByTaskId, availabilityByTaskId };
}
