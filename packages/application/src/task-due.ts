import type { WorkItem } from "@arclattice/domain";
import { notificationLocalTimeInstant } from "./notifications";

/** Stable discriminator for due-day/due-minute notifications. */
export function taskDueOccasion(
  item: Pick<WorkItem, "dueDate" | "dueTime">,
): string | null {
  if (!item.dueDate) return null;
  return item.dueTime ? `${item.dueDate}T${item.dueTime}` : item.dueDate;
}

/**
 * Exact due moment in the workspace timezone. Date-only tasks keep their
 * existing calendar-day semantics and return null here.
 */
export function taskDueInstant(
  item: Pick<WorkItem, "dueDate" | "dueTime">,
  timezone: string,
): number | null {
  if (!item.dueDate || !item.dueTime) return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(item.dueTime);
  if (!match) return null;
  return notificationLocalTimeInstant(
    item.dueDate,
    timezone,
    Number(match[1]),
    Number(match[2]),
  );
}
