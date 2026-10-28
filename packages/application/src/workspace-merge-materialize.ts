import { DomainError } from "@arclattice/domain";
import { localObject } from "./local-dto";
import type { LocalJson } from "./local-persistence";
import type { BindingPreviewSide } from "./workspace-binding-preview";
import type { planWorkspaceMergeSelection } from "./workspace-merge-selection";

export interface WorkspaceMergeCopy {
  readonly collection: string;
  readonly sourceId: string;
  readonly sourceVersion: number;
  readonly targetId: string;
  /** An intent draft, NOT a canonical row; formal services assign attribution/version. */
  readonly value: LocalJson;
}

/** Apply only declared structural references. Markdown prose is never string-replaced. */
export function materializeWorkspaceMergeCopies(
  sourceInput: BindingPreviewSide,
  planInput: ReturnType<typeof planWorkspaceMergeSelection>,
): readonly WorkspaceMergeCopy[] {
  const source = structuredClone(sourceInput),
    plan = structuredClone(planInput);
  if (
    source.workspaceId !== plan.localWorkspaceId ||
    source.revision !== plan.localRevision
  )
    throw new DomainError("VERSION_CONFLICT");
  const key = (collection: string, id: string) =>
    JSON.stringify([collection, id]);
  const records = new Map(
    source.records.map((row) => [key(row.collection, row.id), row]),
  );
  if (records.size !== source.records.length)
    throw new DomainError("VALIDATION_ERROR");
  const mapped = new Set(
    plan.mappings.map((entry) => key(entry.collection, entry.sourceId)),
  );
  const destinations = new Set(plan.mappings.map((entry) => entry.targetId));
  // Folder rows target `FOLDER:<id>`; their own field references use the bare id.
  for (const mapping of plan.mappings)
    if (mapping.targetId.startsWith("FOLDER:"))
      destinations.add(mapping.targetId.slice("FOLDER:".length));
  for (const reference of plan.references)
    if (
      !mapped.has(key(reference.collection, reference.sourceId)) ||
      !destinations.has(reference.targetId) ||
      reference.path.some(
        (segment) =>
          typeof segment === "string" &&
          ["__proto__", "prototype", "constructor"].includes(segment),
      )
    )
      throw new DomainError("VALIDATION_ERROR");
  return plan.mappings
    .filter((entry) => entry.action === "COPY")
    .map((mapping) => {
      const row = records.get(key(mapping.collection, mapping.sourceId));
      if (
        !row ||
        row.workspaceId !== source.workspaceId ||
        row.version !== mapping.sourceVersion ||
        localObject(row.value).deletedAt
      )
        throw new DomainError("VERSION_CONFLICT");
      const value = structuredClone(localObject(row.value)) as Record<
        string,
        LocalJson
      >;
      // Organization's row key is kind:id, but its business id remains the referenced entity.
      if (mapping.collection !== "organization") value.id = mapping.targetId;
      for (const reference of plan.references.filter(
        (entry) =>
          entry.collection === mapping.collection &&
          entry.sourceId === mapping.sourceId,
      )) {
        if (!reference.path.length) throw new DomainError("VALIDATION_ERROR");
        let cursor: LocalJson = value;
        for (const segment of reference.path.slice(0, -1)) {
          const next: LocalJson | undefined =
            Array.isArray(cursor) && typeof segment === "number"
              ? cursor[segment]
              : localObject(cursor)[String(segment)];
          if (!next || typeof next !== "object")
            throw new DomainError("VALIDATION_ERROR", {
              field: "mergeReference",
            });
          cursor = next;
        }
        const last = reference.path.at(-1)!;
        if (Array.isArray(cursor) && typeof last === "number") {
          if (!Number.isSafeInteger(last) || last < 0 || last >= cursor.length)
            throw new DomainError("VALIDATION_ERROR");
          (cursor as LocalJson[])[last] = reference.targetId;
        } else {
          localObject(cursor);
          (cursor as Record<string, LocalJson>)[String(last)] =
            reference.targetId;
        }
      }
      return {
        collection: mapping.collection,
        sourceId: mapping.sourceId,
        sourceVersion: mapping.sourceVersion,
        targetId: mapping.targetId,
        value,
      };
    });
}
