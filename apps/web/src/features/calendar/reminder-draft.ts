import type { ReminderInput } from "@arclattice/domain";

const fields = [
  "title",
  "bodyMd",
  "day",
  "time",
  "timezone",
  "notifyMode",
  "notifyOffsetMinutes",
  "linkedProjectId",
  "linkedTaskId",
  "state",
] as const satisfies readonly (keyof ReminderInput)[];

/** Compares editable fields only; server IDs/revisions do not discard a local form. */
export function reminderDraftChanged(
  draft: ReminderInput,
  baseline: ReminderInput,
): boolean {
  return fields.some((field) => draft[field] !== baseline[field]);
}
