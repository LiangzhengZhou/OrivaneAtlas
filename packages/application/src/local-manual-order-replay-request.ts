import {
  DomainError,
  manualOrderScopeKey,
  requireManualOrderScope,
} from "@arclattice/domain";
import type { LocalCommandPlan } from "./local-command-plan";
import { localDto, localObject } from "./local-dto";
import type { LocalWorkReplayRequest } from "./local-work-replay-request";
import { requireStableUuid } from "./mutation-receipt";

export function buildLocalManualOrderReplayRequest(
  input: LocalCommandPlan,
): LocalWorkReplayRequest | null {
  const plan = structuredClone(input);
  if (
    plan.command?.name !== "manual-order.move" ||
    !["READY", "RECEIPT_REQUIRED"].includes(plan.state) ||
    plan.mutations.length !== 1 ||
    plan.mutationIds.length !== 1 ||
    plan.mutationIds[0] !== plan.id
  )
    return null;
  const mutation = plan.mutations[0];
  if (!mutation) return null;
  const original = localObject(plan.command.input),
    scope = requireManualOrderScope(original.scope),
    scopeKey = manualOrderScopeKey(scope),
    commandId = requireStableUuid(plan.id, "commandId"),
    deviceId = requireStableUuid(mutation.deviceId, "deviceId");
  if (
    mutation.id !== plan.id ||
    mutation.commandId !== commandId ||
    mutation.entityType !== "manualOrders" ||
    mutation.entityId !== scopeKey ||
    !["CREATE", "PATCH"].includes(mutation.operation) ||
    !["PENDING", "SENDING"].includes(mutation.state) ||
    Object.keys(original).some(
      (key) =>
        !["scope", "version", "entityId", "anchorId", "placement"].includes(
          key,
        ),
    ) ||
    typeof original.version !== "number" ||
    !Number.isSafeInteger(original.version) ||
    original.version < 0 ||
    original.version !== (mutation.baseVersion ?? 0) ||
    typeof original.entityId !== "string" ||
    !original.entityId ||
    (original.anchorId !== null &&
      (typeof original.anchorId !== "string" || !original.anchorId)) ||
    !["BEFORE", "AFTER"].includes(String(original.placement))
  )
    throw new DomainError("VALIDATION_ERROR", { field: "manualOrderCommand" });
  return {
    path: "/api/v1/manual-orders/move",
    idempotencyKey: commandId,
    deviceId,
    body: localDto({
      ...original,
      scope,
      syncCommand: {
        commandId,
        deviceId,
        effects: [
          {
            collection: "manualOrders",
            id: scopeKey,
            op: "UPSERT",
            baseVersion: original.version,
          },
        ],
      },
    }),
  };
}
