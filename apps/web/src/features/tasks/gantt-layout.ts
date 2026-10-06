import type { WorkItem } from "@arclattice/domain";

const dayMs = 86_400_000;
export function ganttDay(day: string | null | undefined): number | null {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const value = Date.parse(day + "T00:00:00Z");
  return Number.isFinite(value) &&
    new Date(value).toISOString().slice(0, 10) === day
    ? Math.floor(value / dayMs)
    : null;
}
export function ganttDate(day: number): string {
  return new Date(day * dayMs).toISOString().slice(0, 10);
}
export function ganttLayout(items: readonly WorkItem[], today: string) {
  const current = ganttDay(today) ?? Math.floor(Date.now() / dayMs);
  let start = current - 7,
    end = current + 28;
  const rows = items
    .map((task) => {
      const from = ganttDay(task.startDate),
        due = ganttDay(task.dueDate);
      const first = from ?? due,
        last = due ?? from;
      if (first !== null) start = Math.min(start, first - 3);
      if (last !== null) end = Math.max(end, last + 7);
      return {
        task,
        from: first,
        to: first !== null && last !== null ? Math.max(first, last) : null,
        milestone: from === null && due !== null,
        unscheduled: first === null,
      };
    })
    .sort(
      (a, b) =>
        Number(a.unscheduled) - Number(b.unscheduled) ||
        (a.from ?? 0) - (b.from ?? 0) ||
        a.task.id.localeCompare(b.task.id),
    );
  return { start, end, days: end - start + 1, today: current, rows };
}
