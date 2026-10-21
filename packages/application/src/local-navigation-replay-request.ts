import {
  DomainError,
  type NavigationPreference,
  navigationViews,
  requireNavigationPreference,
} from "@arclattice/domain";
import type { LocalCommandPlan } from "./local-command-plan";
import { localDto, localObject } from "./local-dto";
import type { LocalSyncState } from "./local-persistence";
import type { LocalWorkReplayRequest } from "./local-work-replay-request";
import { requireStableUuid } from "./mutation-receipt";

export function buildLocalNavigationReplayRequest(
  input: LocalCommandPlan,
  bindingInput: LocalSyncState,
): LocalWorkReplayRequest | null {
  const plan = structuredClone(input),
    binding = structuredClone(bindingInput);
  if (
    !plan.command ||
    !["navigation.save", "navigation.move"].includes(plan.command.name) ||
    !["READY", "RECEIPT_REQUIRED"].includes(plan.state) ||
    plan.mutations.length !== 1 ||
    plan.mutationIds.length !== 1 ||
    plan.mutationIds[0] !== plan.id
  )
    return null;
  if (
    !binding.remotePrincipalId ||
    !binding.remoteWorkspaceId ||
    !binding.serverOrigin ||
    !binding.epoch
  )
    throw new DomainError("FORBIDDEN");
  const mutation = plan.mutations[0];
  if (!mutation) return null;
  const commandId = requireStableUuid(plan.id, "commandId"),
    deviceId = requireStableUuid(mutation.deviceId, "deviceId"),
    original = localObject(plan.command.input);
  const save = plan.command.name === "navigation.save";
  if (
    mutation.id !== plan.id ||
    mutation.commandId !== commandId ||
    mutation.workspaceId !== binding.workspaceId ||
    mutation.entityType !== "navigationPreference" ||
    mutation.entityId !== mutation.principalId ||
    !["CREATE", "PATCH"].includes(mutation.operation) ||
    !["PENDING", "SENDING"].includes(mutation.state) ||
    Object.keys(original).some(
      (key) =>
        !(
          save
            ? ["version", "desktop", "mobile"]
            : ["version", "movingId", "anchorId", "placement"]
        ).includes(key),
    ) ||
    typeof original.version !== "number" ||
    !Number.isSafeInteger(original.version) ||
    original.version < 0 ||
    original.version !== (mutation.baseVersion ?? 0)
  )
    throw new DomainError("VALIDATION_ERROR", { field: "navigationCommand" });
  if (save)
    requireNavigationPreference(original as unknown as NavigationPreference);
  else if (
    typeof original.movingId !== "string" ||
    !(navigationViews as readonly string[]).includes(original.movingId) ||
    typeof original.anchorId !== "string" ||
    !(navigationViews as readonly string[]).includes(original.anchorId) ||
    !["BEFORE", "AFTER"].includes(String(original.placement))
  )
    throw new DomainError("VALIDATION_ERROR", { field: "navigationCommand" });
  return {
    path: save
      ? "/api/v1/work/navigation-preference"
      : "/api/v1/work/navigation-move",
    idempotencyKey: commandId,
    deviceId,
    body: localDto({
      ...original,
      syncCommand: {
        commandId,
        deviceId,
        effects: [
          {
            collection: "navigationPreference",
            id: binding.remotePrincipalId,
            op: "UPSERT",
            baseVersion: original.version,
          },
        ],
      },
    }),
  };
}
