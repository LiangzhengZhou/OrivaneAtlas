import {
  type ActorContext,
  DomainError,
  requireEntityMemoOwner,
  requireEntityMemoRecord,
} from "@arclattice/domain";
import type { EntityMemoIdentity } from "./entity-memos";
import type { LocalSyncState } from "./local-persistence";

/** Private replication boundary. Target access never substitutes for owner identity. */
export async function projectLocalEntityMemo(
  actorInput: ActorContext,
  bindingInput: LocalSyncState,
  value: unknown,
  identity: Pick<EntityMemoIdentity, "forTarget">,
) {
  const actor = Object.freeze({ ...actorInput });
  const binding = structuredClone(bindingInput);
  const remote = requireEntityMemoRecord(value);
  if (
    !actor.principalId ||
    !actor.workspaceId ||
    binding.workspaceId !== actor.workspaceId ||
    !binding.remoteWorkspaceId ||
    !binding.remotePrincipalId ||
    !binding.serverOrigin ||
    !binding.epoch ||
    !Number.isSafeInteger(binding.version) ||
    binding.version < 1 ||
    !Number.isSafeInteger(binding.cursor) ||
    binding.cursor < 0
  )
    throw new DomainError("FORBIDDEN");
  const remoteActor = Object.freeze({
    workspaceId: binding.remoteWorkspaceId,
    principalId: binding.remotePrincipalId,
  });
  requireEntityMemoOwner(remoteActor, remote);
  const target = Object.freeze({
    targetKind: remote.targetKind,
    targetId: remote.targetId,
  });
  if (remote.id !== (await identity.forTarget(remoteActor, target)))
    throw new DomainError("VALIDATION_ERROR", {
      field: "canonicalMemoIdentity",
    });
  const localId = await identity.forTarget(actor, target);
  return {
    remote,
    local: requireEntityMemoRecord({
      ...remote,
      id: localId,
      workspaceId: actor.workspaceId,
      ownerPrincipalId: actor.principalId,
      createdBy: actor.principalId,
      updatedBy: actor.principalId,
    }),
  };
}
