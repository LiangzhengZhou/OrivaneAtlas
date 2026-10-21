import { type ActorContext, DomainError } from "@arclattice/domain";
import type { EntityMemoIdentity } from "./entity-memos";
import { localDto, localObject } from "./local-dto";
import type {
  LocalMetadataStore,
  LocalMutation,
  LocalOutboxStore,
  LocalSyncState,
} from "./local-persistence";
import type { LocalReplicaCommit, LocalReplicaStore } from "./local-replica";
import { prepareLocalWorkPull } from "./local-work-pull";

const collection = "$local.entityMemoBootstrap";
const id = "owner";
export async function initializeLocalEntityMemoHistory(
  actorInput: ActorContext,
  binding: () => Promise<LocalSyncState>,
  ports: {
    identity: Pick<EntityMemoIdentity, "forTarget">;
    metadata: LocalMetadataStore;
    outbox: LocalOutboxStore;
    replica: LocalReplicaStore;
    pull(scope: LocalSyncState, after: number): Promise<unknown>;
  },
) {
  const actor = { ...actorInput };
  let changed = false;
  for (;;) {
    const scope = await binding(),
      after = await localEntityMemoBootstrapCursor(
        actor,
        scope,
        ports.metadata,
      );
    if (after === null) return changed;
    const page = await ports.pull(scope, after);
    await ports.replica.commit(
      await prepareLocalEntityMemoBootstrap(
        actor,
        scope,
        page,
        await ports.outbox.list(actor.workspaceId),
        ports.metadata,
        ports.identity,
      ),
    );
    changed = true;
  }
}
function invalid(): never {
  throw new DomainError("VALIDATION_ERROR", { field: "memoBootstrap" });
}

async function state(
  actor: ActorContext,
  binding: LocalSyncState,
  metadata: LocalMetadataStore,
) {
  if (
    binding.workspaceId !== actor.workspaceId ||
    !actor.principalId ||
    !binding.remotePrincipalId ||
    !binding.remoteWorkspaceId ||
    !binding.epoch ||
    !binding.serverOrigin
  )
    throw new DomainError("FORBIDDEN");
  const record = await metadata.get(actor.workspaceId, collection, id);
  if (!record) return { record, after: 0, complete: false };
  const value = localObject(record.value);
  if (
    record.workspaceId !== actor.workspaceId ||
    record.collection !== collection ||
    record.id !== id ||
    !Number.isSafeInteger(record.version) ||
    record.version < 1 ||
    value.principalId !== actor.principalId ||
    value.remoteWorkspaceId !== binding.remoteWorkspaceId ||
    value.remotePrincipalId !== binding.remotePrincipalId ||
    value.serverOrigin !== binding.serverOrigin ||
    value.epoch !== binding.epoch
  )
    throw new DomainError("FORBIDDEN", { field: "memoOwnerBinding" });
  if (
    typeof value.after !== "number" ||
    !Number.isSafeInteger(value.after) ||
    value.after < 0 ||
    typeof value.complete !== "boolean" ||
    Object.keys(value).some(
      (key) =>
        ![
          "principalId",
          "remoteWorkspaceId",
          "remotePrincipalId",
          "serverOrigin",
          "epoch",
          "after",
          "complete",
        ].includes(key),
    )
  )
    invalid();
  return { record, after: value.after, complete: value.complete };
}

/** One-time journal migration, not a second daily cursor. Never rewinds/advances
 * the shared cursor past public changes; progress is atomic with private bases. */
export async function localEntityMemoBootstrapCursor(
  actor: ActorContext,
  binding: LocalSyncState,
  metadata: LocalMetadataStore,
): Promise<number | null> {
  const current = await state({ ...actor }, structuredClone(binding), metadata);
  return current.complete ? null : current.after;
}

export async function prepareLocalEntityMemoBootstrap(
  actorInput: ActorContext,
  bindingInput: LocalSyncState,
  pageInput: unknown,
  pending: readonly LocalMutation[],
  metadata: LocalMetadataStore,
  identity: Pick<EntityMemoIdentity, "forTarget">,
): Promise<LocalReplicaCommit> {
  const actor = { ...actorInput },
    binding = structuredClone(bindingInput);
  const current = await state(actor, binding, metadata);
  if (current.complete) throw new DomainError("VERSION_CONFLICT");
  const page = localObject(localDto(pageInput));
  const changes = localObject(page.changes!);
  if (
    Object.keys(localObject(changes.values!)).length ||
    Object.keys(localObject(changes.collections!)).some(
      (name) => name !== "entityMemos",
    ) ||
    !Array.isArray(page.records) ||
    page.records.some(
      (record) => localObject(record).collection !== "entityMemos",
    )
  )
    invalid();
  const prepared = await prepareLocalWorkPull(
    actor,
    { ...binding, cursor: current.after },
    page,
    pending,
    metadata,
    identity,
  );
  if (
    typeof page.cursor !== "number" ||
    typeof page.hasMore !== "boolean" ||
    (page.hasMore && page.cursor <= current.after) ||
    (!page.hasMore && page.cursor < binding.cursor)
  )
    invalid();
  const revision = prepared
    ? null
    : await metadata.get(actor.workspaceId, "$local.workspace", "revision");
  return {
    workspaceId: actor.workspaceId,
    principalId: actor.principalId,
    binding,
    nextCursor: binding.cursor,
    expectedWorkspaceVersion:
      prepared?.expectedWorkspaceVersion ?? revision?.version ?? null,
    records: [
      ...(prepared?.records ?? []),
      {
        expectedVersion: current.record?.version ?? null,
        entity: {
          workspaceId: actor.workspaceId,
          collection,
          id,
          version: (current.record?.version ?? 0) + 1,
          value: localDto({
            principalId: actor.principalId,
            remoteWorkspaceId: binding.remoteWorkspaceId,
            remotePrincipalId: binding.remotePrincipalId,
            serverOrigin: binding.serverOrigin,
            epoch: binding.epoch,
            after: page.cursor,
            complete: !page.hasMore,
          }),
        },
      },
    ],
  };
}
