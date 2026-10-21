export const dragMime = "application/x-orivane-drag+json";
export type DragIntent =
  | "REORDER"
  | "MOVE_STATUS"
  | "PROJECT_REPARENT"
  | "MOVE_CATEGORY"
  | "NAV_REORDER";
export type EntityDrag = {
  version: 1;
  intent: DragIntent;
  entityId: string;
  scopeKey: string;
};
const intents = new Set<DragIntent>([
  "REORDER",
  "MOVE_STATUS",
  "PROJECT_REPARENT",
  "MOVE_CATEGORY",
  "NAV_REORDER",
]);

/** DataTransfer is untrusted input, and a reorder is not a status transition. */
export function readEntityDrag(value: string): EntityDrag | null {
  if (!value || value.length > 2048) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const data = parsed as Record<string, unknown>;
  if (
    data.version !== 1 ||
    !intents.has(data.intent as DragIntent) ||
    typeof data.entityId !== "string" ||
    !data.entityId ||
    data.entityId.length > 256 ||
    typeof data.scopeKey !== "string" ||
    !data.scopeKey ||
    data.scopeKey.length > 512
  )
    return null;
  return {
    version: 1,
    intent: data.intent as DragIntent,
    entityId: data.entityId,
    scopeKey: data.scopeKey,
  };
}

export function acceptsReorder(
  input: EntityDrag | null,
  intent: "REORDER" | "NAV_REORDER",
  scopeKey: string,
  targetId: string,
): input is EntityDrag {
  return !!(
    input &&
    input.intent === intent &&
    input.scopeKey === scopeKey &&
    input.entityId !== targetId
  );
}
