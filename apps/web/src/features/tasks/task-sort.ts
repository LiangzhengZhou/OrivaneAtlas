import { priorities, type WorkItem } from "@arclattice/domain";

export function taskPresentationComparator(
  sort: string,
  locale: string,
  positions: ReadonlyMap<string, number>,
): (a: WorkItem, b: WorkItem) => number {
  return (a, b) => {
    if (sort === "manual")
      return (
        (positions.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
          (positions.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id)
      );
    if (sort === "due")
      return (
        (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31") ||
        a.id.localeCompare(b.id)
      );
    if (sort === "priority")
      return (
        priorities.indexOf(b.priority) - priorities.indexOf(a.priority) ||
        a.id.localeCompare(b.id)
      );
    if (sort === "title")
      return a.title.localeCompare(b.title, locale) || a.id.localeCompare(b.id);
    return b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);
  };
}
