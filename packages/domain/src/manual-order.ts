import { DomainError } from "./index";

export type ManualOrderScope =
  | { readonly kind: "WORKSPACE_TASKS" }
  | { readonly kind: "PROJECT_TASKS"; readonly projectId: string }
  | {
      readonly kind: "PROJECT_CHILDREN";
      readonly parentProjectId: string | null;
    }
  | { readonly kind: "PROJECT_CATEGORIES" };

export interface ManualOrderEntry {
  readonly workspaceId: string;
  readonly scopeKey: string;
  readonly entityId: string;
  readonly position: number;
  readonly version: number;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

/** Versioned scope aggregate; entry versions survive scope-level synchronization. */
export interface ManualOrderState {
  readonly id: string;
  readonly workspaceId: string;
  readonly scope: Exclude<
    ManualOrderScope,
    { readonly kind: "PROJECT_CATEGORIES" }
  >;
  readonly entries: readonly ManualOrderEntry[];
  readonly version: number;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

const spacing = 1024;

export function requireManualOrderScope(
  input: unknown,
): ManualOrderState["scope"] {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new DomainError("VALIDATION_ERROR");
  const value = input as Record<string, unknown>;
  switch (value.kind) {
    case "WORKSPACE_TASKS":
      if (Object.keys(value).some((key) => key !== "kind"))
        throw new DomainError("VALIDATION_ERROR");
      return { kind: "WORKSPACE_TASKS" };
    case "PROJECT_TASKS":
      if (
        Object.keys(value).some(
          (key) => !["kind", "projectId"].includes(key),
        ) ||
        typeof value.projectId !== "string"
      )
        throw new DomainError("VALIDATION_ERROR");
      identity(value.projectId);
      return { kind: "PROJECT_TASKS", projectId: value.projectId };
    case "PROJECT_CHILDREN":
      if (
        Object.keys(value).some(
          (key) => !["kind", "parentProjectId"].includes(key),
        ) ||
        (value.parentProjectId !== null &&
          typeof value.parentProjectId !== "string")
      )
        throw new DomainError("VALIDATION_ERROR");
      if (value.parentProjectId !== null)
        identity(value.parentProjectId as string);
      return {
        kind: "PROJECT_CHILDREN",
        parentProjectId: value.parentProjectId as string | null,
      };
    default:
      throw new DomainError("VALIDATION_ERROR");
  }
}

/** Canonical aggregate validation shared by persistence and synchronization boundaries. */
export function requireManualOrderState(input: unknown): ManualOrderState {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new DomainError("VALIDATION_ERROR");
  const value = input as Record<string, unknown>,
    scope = requireManualOrderScope(value.scope);
  const key = manualOrderScopeKey(scope);
  if (
    value.id !== key ||
    typeof value.workspaceId !== "string" ||
    !value.workspaceId ||
    typeof value.version !== "number" ||
    !Number.isSafeInteger(value.version) ||
    value.version < 1 ||
    typeof value.updatedBy !== "string" ||
    !value.updatedBy ||
    typeof value.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(value.updatedAt)) ||
    !Array.isArray(value.entries)
  )
    throw new DomainError("VALIDATION_ERROR");
  for (const entry of value.entries) {
    if (
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      entry.workspaceId !== value.workspaceId ||
      entry.scopeKey !== key ||
      typeof entry.entityId !== "string" ||
      typeof entry.version !== "number" ||
      !Number.isSafeInteger(entry.version) ||
      entry.version < 1 ||
      typeof entry.updatedBy !== "string" ||
      !entry.updatedBy ||
      typeof entry.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(entry.updatedAt))
    )
      throw new DomainError("VALIDATION_ERROR");
  }
  const state = input as ManualOrderState;
  const first = state.entries[0];
  if (first)
    planOrderMove(state.entries, first.entityId, first.entityId, "BEFORE");
  return structuredClone(state);
}

function identity(value: string): string {
  if (!value.trim() || value.length > 256) {
    throw new DomainError("VALIDATION_ERROR", {
      reason: "INVALID_ORDER_SCOPE",
    });
  }
  return encodeURIComponent(value);
}

export function manualOrderScopeKey(scope: ManualOrderScope): string {
  switch (scope.kind) {
    case "WORKSPACE_TASKS":
    case "PROJECT_CATEGORIES":
      return scope.kind;
    case "PROJECT_TASKS":
      return `PROJECT_TASKS:${identity(scope.projectId)}`;
    case "PROJECT_CHILDREN":
      return scope.parentProjectId === null
        ? "PROJECT_CHILDREN:ROOT"
        : `PROJECT_CHILDREN:ID:${identity(scope.parentProjectId)}`;
  }
}

export interface OrderPosition {
  readonly entityId: string;
  readonly position: number;
}

/** Pure position planning; callers authorize scope membership and commit with CAS. */
export function planOrderMove(
  entries: readonly OrderPosition[],
  entityId: string,
  anchorId: string | null,
  placement: "BEFORE" | "AFTER",
): readonly OrderPosition[] {
  const ids = new Set<string>();
  const positions = new Set<number>();
  for (const entry of entries) {
    identity(entry.entityId);
    if (
      ids.has(entry.entityId) ||
      positions.has(entry.position) ||
      !Number.isSafeInteger(entry.position) ||
      entry.position <= 0
    ) {
      throw new DomainError("VALIDATION_ERROR", {
        reason: "INVALID_ORDER_ENTRIES",
      });
    }
    ids.add(entry.entityId);
    positions.add(entry.position);
  }
  if (!ids.has(entityId) || (anchorId !== null && !ids.has(anchorId))) {
    throw new DomainError("NOT_FOUND", { reason: "ORDER_MEMBER_NOT_FOUND" });
  }
  if (anchorId === entityId) return [];
  const sorted = [...entries].sort((a, b) => a.position - b.position);
  const remaining = sorted.filter((entry) => entry.entityId !== entityId);
  const insertion =
    anchorId === null
      ? placement === "BEFORE"
        ? 0
        : remaining.length
      : remaining.findIndex((entry) => entry.entityId === anchorId) +
        (placement === "AFTER" ? 1 : 0);
  const orderedIds = remaining.map((entry) => entry.entityId);
  orderedIds.splice(insertion, 0, entityId);
  if (orderedIds.every((id, index) => id === sorted[index]?.entityId))
    return [];
  const lower = remaining[insertion - 1]?.position ?? 0;
  const upper = remaining[insertion]?.position;
  const candidate =
    upper === undefined
      ? lower + spacing
      : lower + Math.floor((upper - lower) / 2);
  if (
    Number.isSafeInteger(candidate) &&
    candidate > lower &&
    (upper === undefined || candidate < upper)
  ) {
    return [{ entityId, position: candidate }];
  }
  const existingPositions = new Map(
    entries.map((entry) => [entry.entityId, entry.position]),
  );
  return orderedIds.flatMap((id, index) => {
    const position = (index + 1) * spacing;
    if (!Number.isSafeInteger(position)) {
      throw new DomainError("VALIDATION_ERROR", {
        reason: "ORDER_SCOPE_TOO_LARGE",
      });
    }
    return existingPositions.get(id) === position
      ? []
      : [{ entityId: id, position }];
  });
}

/** Append an explicitly ordered subset while preserving other members' relative order. */
export function planOrderSequence(
  entries: readonly OrderPosition[],
  orderedEntityIds: readonly string[],
): readonly OrderPosition[] {
  const selected = new Set(orderedEntityIds),
    byId = new Map(entries.map((entry) => [entry.entityId, entry]));
  if (
    !orderedEntityIds.length ||
    selected.size !== orderedEntityIds.length ||
    byId.size !== entries.length ||
    orderedEntityIds.some((id) => !byId.has(id))
  )
    throw new DomainError("VALIDATION_ERROR");
  planOrderMove(entries, orderedEntityIds[0]!, orderedEntityIds[0]!, "AFTER");
  const sorted = [...entries].sort((a, b) => a.position - b.position);
  const result = [
    ...sorted
      .filter((entry) => !selected.has(entry.entityId))
      .map((entry) => entry.entityId),
    ...orderedEntityIds,
  ];
  if (result.every((id, index) => id === sorted[index]?.entityId)) return [];
  return result.map((entityId, index) => ({
    entityId,
    position: (index + 1) * spacing,
  }));
}
