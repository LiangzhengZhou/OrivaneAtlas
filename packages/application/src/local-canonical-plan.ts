import { DomainError } from "@arclattice/domain";
import { localObject } from "./local-dto";
import type { LocalJson } from "./local-persistence";
import { parseProjectPlan } from "./workflows";

function invalid(): never {
  throw new DomainError("VALIDATION_ERROR", { field: "canonicalPlan" });
}
const identity = (v: LocalJson | undefined): v is string =>
  typeof v === "string" && !!v && v.length <= 240;
const timestamp = (v: LocalJson | undefined) =>
  typeof v === "string" && Number.isFinite(Date.parse(v));
function revision(value: LocalJson | undefined, names: readonly string[]) {
  if (typeof value !== "string" || !value || value.length > 2000000) invalid();
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    invalid();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) invalid();
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).some((k) => !names.includes(k))) invalid();
  for (const name of names) {
    const rows = record[name];
    if (!Array.isArray(rows) || rows.length > 100000) invalid();
    const ids = new Set<string>();
    for (const row of rows) {
      if (
        !Array.isArray(row) ||
        typeof row[0] !== "string" ||
        !row[0] ||
        ids.has(row[0])
      )
        invalid();
      ids.add(row[0]);
      if (name === "edges") {
        if (row.length !== 4 || !row.every((v) => typeof v === "string" && !!v))
          invalid();
      } else if (
        row.length !== 2 ||
        !Number.isSafeInteger(row[1]) ||
        row[1] < 1
      )
        invalid();
    }
  }
}
/** Canonical validation only; ordinary WorkflowService owns planning and publication. */
export function validateLocalCanonicalPlanValue(
  id: string,
  workspaceId: string,
  version: number,
  input: LocalJson,
): void {
  const value = localObject(input);
  if (
    value.id !== id ||
    value.workspaceId !== workspaceId ||
    value.version !== version ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    !identity(value.createdBy) ||
    !identity(value.updatedBy) ||
    !timestamp(value.createdAt) ||
    !timestamp(value.updatedAt) ||
    (value.deletedAt !== null && !timestamp(value.deletedAt))
  )
    invalid();
  const payload = localObject(value.payload ?? null);
  if (
    payload.kind !== "PLAN" ||
    payload.policy !== "manifest-v1" ||
    (payload.origin !== undefined &&
      !["HUMAN", "EXTERNAL_AI"].some((o) => o === payload.origin)) ||
    (payload.projectId !== null && !identity(payload.projectId)) ||
    typeof payload.published !== "boolean"
  )
    invalid();
  revision(payload.baseRevision, ["categories", "items", "edges"]);
  if (payload.documentRevision !== undefined && payload.documentRevision !== "")
    revision(payload.documentRevision, ["library", "materials"]);
  const parsed = parseProjectPlan({
    version: 1,
    projects: payload.projects ?? [],
    tasks: payload.tasks,
    categories: payload.categories ?? [],
    recurrences: payload.recurrences ?? [],
    spaces: payload.spaces ?? [],
    documents: payload.documents ?? [],
  });
  const result = localObject(payload.result ?? null);
  if (!Array.isArray(payload.provenance)) invalid();
  const entities = [
    ...parsed.projects,
    ...parsed.tasks,
    ...parsed.categories,
    ...parsed.recurrences,
    ...parsed.spaces,
    ...parsed.documents,
  ];
  if (!payload.published) {
    if (Object.keys(result).length || payload.provenance.length) invalid();
    return;
  }
  if (
    Object.keys(result).length !== entities.length ||
    payload.provenance.length !== entities.length
  )
    invalid();
  for (const [i, entity] of entities.entries()) {
    if (!identity(result[entity.tempId])) invalid();
    const provenance = localObject(payload.provenance[i]!);
    if (
      provenance.taskId !== result[entity.tempId] ||
      provenance.source !== "IMPORTED" ||
      !identity(provenance.confirmedBy) ||
      !timestamp(provenance.confirmedAt) ||
      !Array.isArray(provenance.fields) ||
      provenance.fields.some((f) => typeof f !== "string" || !f)
    )
      invalid();
  }
}
