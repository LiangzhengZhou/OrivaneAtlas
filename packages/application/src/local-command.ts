import type { LocalEntity, LocalJson } from "./local-persistence";

export const localWorkCommandNames = [
  "work.create",
  "work.update",
  "work.delete",
  "work.purge",
  "edge.create",
  "edge.delete",
  "calendar.settings",
  "navigation.save",
  "navigation.move",
  "note.save",
  "note.restore",
  "note.delete",
  "note.purge",
  "library.save",
  "library.move",
  "library.restore",
  "library.delete",
  "library.purge",
  "reminder.save",
  "memo.save",
  "manual-order.move",
  "category.save",
  "category.reorder",
  "organization.apply",
  "project.space.create",
  "project.space.link",
  "project.document.create",
  "project.material.delete",
  "recurrence.save",
  "recurrence.task",
  "recurrence.generate",
  "recurrence.skip",
  "recurrence.backfill",
  "link.create",
  "link.delete",
  "note.space.link",
  "note.document.promote",
  "plan.preview",
  "plan.publish",
  "file.upload",
  "file.rename",
  "file.delete",
  "file.policy",
] as const;

export interface LocalCommandIntent {
  readonly name: (typeof localWorkCommandNames)[number];
  readonly input: LocalJson;
}

export function validLocalCommandId(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "string" && value.length > 0 && value.length <= 240)
  );
}

export function localCommandMutationIds(
  entity: LocalEntity,
  workspaceId: string,
  principalId: string,
): readonly string[] | null {
  const value = entity.value;
  if (
    entity.workspaceId !== workspaceId ||
    entity.collection !== "$local.command" ||
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !("schemaVersion" in value) ||
    value.schemaVersion !== 1 ||
    !("id" in value) ||
    value.id !== entity.id ||
    !("workspaceId" in value) ||
    value.workspaceId !== workspaceId ||
    !("principalId" in value) ||
    value.principalId !== principalId ||
    !("name" in value) ||
    typeof value.name !== "string" ||
    !localWorkCommandNames.some((name) => name === value.name) ||
    !("input" in value) ||
    !value.input ||
    typeof value.input !== "object" ||
    Array.isArray(value.input) ||
    !("mutationIds" in value) ||
    !Array.isArray(value.mutationIds) ||
    !value.mutationIds.length ||
    value.mutationIds[0] !== entity.id ||
    value.mutationIds.some(
      (id) => typeof id !== "string" || !id || id.length > 240,
    ) ||
    new Set(value.mutationIds).size !== value.mutationIds.length
  )
    return null;
  return value.mutationIds as readonly string[];
}
