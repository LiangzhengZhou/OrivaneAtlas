import {
  DomainError,
  type ReminderInput,
  requireReminder,
} from "@arclattice/domain";
import { localDto, localObject } from "./local-dto";
import { equalLocalJson } from "./local-json-equal";
import type { LocalJson } from "./local-persistence";

export function validateLocalCanonicalReminderValue(
  id: string,
  workspaceId: string,
  version: number,
  value: LocalJson,
): void {
  const entity = localObject(value);
  if (
    entity.id !== id ||
    entity.workspaceId !== workspaceId ||
    entity.version !== version ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    typeof entity.createdBy !== "string" ||
    !entity.createdBy ||
    typeof entity.updatedBy !== "string" ||
    !entity.updatedBy ||
    typeof entity.createdAt !== "string" ||
    !Number.isFinite(Date.parse(entity.createdAt)) ||
    typeof entity.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(entity.updatedAt)) ||
    (entity.deletedAt !== null &&
      (typeof entity.deletedAt !== "string" ||
        !Number.isFinite(Date.parse(entity.deletedAt))))
  )
    throw new DomainError("VALIDATION_ERROR", { field: "canonicalReminder" });
  const input = Object.fromEntries(
    [
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
    ].map((key) => [key, entity[key]]),
  );
  if (
    !equalLocalJson(
      localDto(requireReminder(input as unknown as ReminderInput)),
      localDto(input),
    )
  )
    throw new DomainError("VALIDATION_ERROR", { field: "canonicalReminder" });
}
