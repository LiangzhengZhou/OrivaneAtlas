import { type ActorContext, DomainError } from "@arclattice/domain";
import { planLocalCommands } from "./local-command-plan";
import { localConflictSuccessors } from "./local-conflict-successors";
import { localObject } from "./local-dto";
import type { LocalWorkConflictReview } from "./local-pending-work-rebase";
import type {
  LocalMetadataStore,
  LocalOutboxStore,
  LocalSyncState,
} from "./local-persistence";

/** Detached three-way review. Reads no network and never resolves or discards an Outbox record. */
export async function listLocalWorkConflictReviews(
  actor: ActorContext,
  binding: LocalSyncState,
  metadata: LocalMetadataStore,
  outbox: LocalOutboxStore,
): Promise<LocalWorkConflictReview[]> {
  if (binding.workspaceId !== actor.workspaceId || !binding.remotePrincipalId)
    throw new DomainError("FORBIDDEN");
  const pending = await outbox.list(actor.workspaceId);
  const plans = await planLocalCommands(actor, metadata, pending);
  const revision = await metadata.get(
    actor.workspaceId,
    "$local.workspace",
    "revision",
  );
  const reviews: LocalWorkConflictReview[] = [];
  for (const plan of plans) {
    const original = plan.mutations[0];
    const followers = localConflictSuccessors(plan, plans);
    if (
      plan.state !== "CONFLICT" ||
      ![
        "work.update",
        "file.rename",
        "note.save",
        "library.save",
        "memo.save",
      ].includes(plan.command?.name ?? "") ||
      plan.mutations.length !== 1 ||
      !original ||
      (original.operation !== "PATCH" &&
        !(
          original.entityType === "entityMemos" &&
          original.operation === "CREATE"
        )) ||
      !["items", "files", "notes", "library", "entityMemos"].includes(
        original.entityType,
      ) ||
      original.basePayload === undefined ||
      (original.basePayload === null &&
        original.entityType !== "entityMemos") ||
      followers === null
    )
      continue;
    const refs = [
      { collection: "$local.command", id: plan.id },
      {
        collection: "$local.remoteBase",
        id: JSON.stringify([original.entityType, original.entityId]),
      },
      { collection: original.entityType, id: original.entityId },
    ];
    const [originalCommand, remoteBase, current] = await Promise.all(
      refs.map((ref) =>
        metadata.get(actor.workspaceId, ref.collection, ref.id),
      ),
    );
    if (!originalCommand || !remoteBase || !current) continue;
    for (const [index, record] of [
      originalCommand,
      remoteBase,
      current,
    ].entries())
      if (
        record.workspaceId !== actor.workspaceId ||
        record.collection !== refs[index]!.collection ||
        record.id !== refs[index]!.id
      )
        throw new DomainError("FORBIDDEN");
    const canonical = localObject(remoteBase.value);
    if (
      canonical.remoteWorkspaceId !== binding.remoteWorkspaceId ||
      canonical.remotePrincipalId !== binding.remotePrincipalId ||
      canonical.serverOrigin !== binding.serverOrigin ||
      canonical.epoch !== binding.epoch
    )
      throw new DomainError("FORBIDDEN");
    reviews.push(
      structuredClone({
        binding,
        expectedWorkspaceVersion: revision?.version ?? null,
        original,
        originalCommand,
        remoteBase,
        current,
        ...(followers.length ? { followers } : {}),
      }),
    );
  }
  const after = await metadata.get(
    actor.workspaceId,
    "$local.workspace",
    "revision",
  );
  if ((after?.version ?? null) !== (revision?.version ?? null))
    throw new DomainError("VERSION_CONFLICT", { field: "conflictReview" });
  return reviews;
}
