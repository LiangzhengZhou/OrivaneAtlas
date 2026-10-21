import type { LocalMutation } from "./local-persistence";

export function validLocalMutationOrder(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const fields = value as Record<string, unknown>;
  return (
    Object.keys(fields).length === 2 &&
    Object.hasOwn(fields, "transactionVersion") &&
    Object.hasOwn(fields, "operationIndex") &&
    Number.isSafeInteger(fields.transactionVersion) &&
    Number(fields.transactionVersion) >= 1 &&
    Number.isSafeInteger(fields.operationIndex) &&
    Number(fields.operationIndex) >= 0
  );
}

/** Legacy fallback is deterministic inspection order, never a dependency proof. */
export function compareLocalMutations(
  left: LocalMutation,
  right: LocalMutation,
): number {
  if (
    !validLocalMutationOrder(left.order) ||
    !validLocalMutationOrder(right.order)
  )
    throw new Error("LOCAL_MUTATION_ORDER_CORRUPT");
  if (left.order && right.order)
    return (
      left.order.transactionVersion - right.order.transactionVersion ||
      left.order.operationIndex - right.order.operationIndex ||
      left.id.localeCompare(right.id)
    );
  if (left.order || right.order) return left.order ? 1 : -1;
  return (
    left.createdAt.localeCompare(right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}
