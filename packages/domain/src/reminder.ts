import {
  DomainError,
  requireCalendarTimezone,
  requireTitle,
  validateSchedule,
} from "./index";

export interface Reminder {
  readonly id: string;
  readonly workspaceId: string;
  readonly version: number;
  readonly title: string;
  readonly bodyMd: string;
  readonly day: string;
  readonly time: string | null;
  readonly timezone: string;
  readonly notifyMode: "NONE" | "AT_TIME" | "MINUTES_BEFORE";
  readonly notifyOffsetMinutes: number | null;
  readonly linkedProjectId: string | null;
  readonly linkedTaskId: string | null;
  readonly state: "ACTIVE" | "DONE" | "DISMISSED";
  readonly deletedAt: string | null;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
}
export type ReminderInput = Pick<
  Reminder,
  | "title"
  | "bodyMd"
  | "day"
  | "time"
  | "timezone"
  | "notifyMode"
  | "notifyOffsetMinutes"
  | "linkedProjectId"
  | "linkedTaskId"
  | "state"
>;
export function requireReminder(input: ReminderInput): ReminderInput {
  if (
    !input ||
    typeof input !== "object" ||
    typeof input.title !== "string" ||
    typeof input.day !== "string" ||
    typeof input.timezone !== "string"
  )
    throw new DomainError("VALIDATION_ERROR");
  const title = requireTitle(input.title);
  validateSchedule(input.day, input.day);
  if (
    !input.day ||
    (input.time !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) ||
    typeof input.bodyMd !== "string" ||
    input.bodyMd.length > 100000 ||
    !["NONE", "AT_TIME", "MINUTES_BEFORE"].includes(input.notifyMode) ||
    !["ACTIVE", "DONE", "DISMISSED"].includes(input.state)
  )
    throw new DomainError("VALIDATION_ERROR");
  requireCalendarTimezone(input.timezone);
  if (input.notifyMode !== "NONE" && input.time === null)
    throw new DomainError("VALIDATION_ERROR");
  if (
    input.notifyMode === "MINUTES_BEFORE" &&
    (!Number.isSafeInteger(input.notifyOffsetMinutes) ||
      input.notifyOffsetMinutes! < 1 ||
      input.notifyOffsetMinutes! > 43200)
  )
    throw new DomainError("VALIDATION_ERROR");
  for (const id of [input.linkedProjectId, input.linkedTaskId])
    if (id !== null && (typeof id !== "string" || !id || id.length > 240))
      throw new DomainError("VALIDATION_ERROR");
  return {
    ...input,
    title,
    notifyOffsetMinutes:
      input.notifyMode === "MINUTES_BEFORE" ? input.notifyOffsetMinutes : null,
  };
}
