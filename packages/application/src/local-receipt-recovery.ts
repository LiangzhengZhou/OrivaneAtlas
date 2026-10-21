import { type ActorContext, DomainError } from "@arclattice/domain";
import type { EntityMemoIdentity } from "./entity-memos";
import { buildLocalCalendarReplayRequest } from "./local-calendar-replay-request";
import { buildLocalCategoryReplayRequest } from "./local-category-replay-request";
import { planLocalCommands } from "./local-command-plan";
import { buildLocalEntityMemoReplayRequest } from "./local-entity-memo-replay-request";
import { buildLocalFileReplayRequest } from "./local-file-replay-request";
import { prepareLocalKnowledgeReplayAcknowledgement } from "./local-knowledge-replay-ack";
import { buildLocalKnowledgeReplayRequest } from "./local-knowledge-replay-request";
import type { LocalWikiIndexer } from "./local-library-store";
import { buildLocalLinkedKnowledgeReplayRequest } from "./local-linked-knowledge-replay-request";
import { buildLocalManualOrderReplayRequest } from "./local-manual-order-replay-request";
import { buildLocalNavigationReplayRequest } from "./local-navigation-replay-request";
import { buildLocalNoteKnowledgeReplayRequest } from "./local-note-knowledge-replay-request";
import { buildLocalOrganizationReplayRequest } from "./local-organization-replay-request";
import type {
  LocalMetadataStore,
  LocalOutboxStore,
  LocalSyncState,
  LocalSyncStateStore,
} from "./local-persistence";
import { buildLocalPlanReplayRequest } from "./local-plan-replay-request";
import { buildLocalProjectKnowledgeReplayRequest } from "./local-project-knowledge-replay-request";
import { buildLocalPurgeReplayRequest } from "./local-purge-replay-request";
import { buildLocalRecurrenceReplayRequest } from "./local-recurrence-replay-request";
import { buildLocalReminderReplayRequest } from "./local-reminder-replay-request";
import type { LocalReplicaStore } from "./local-replica";
import { prepareLocalWorkReplayAcknowledgement } from "./local-work-replay-ack";
import { buildLocalWorkReplayRequest } from "./local-work-replay-request";

export interface LocalReceiptTransport {
  /** Adapter must authenticate and pin origin/workspace/principal before and after IO. */
  lookup(
    binding: LocalSyncState,
    commandId: string,
    deviceId: string,
  ): Promise<unknown | null>;
}

/** Recover accepted attempted commands; never send, rebase, reset or change the cursor. */
export async function recoverLocalWorkReceipts(
  actorInput: ActorContext,
  ports: {
    metadata: LocalMetadataStore;
    outbox: LocalOutboxStore;
    syncState: LocalSyncStateStore;
    replica: LocalReplicaStore;
    transport: LocalReceiptTransport;
    knowledgeWiki?: LocalWikiIndexer;
    memoIdentity?: Pick<EntityMemoIdentity, "forTarget">;
  },
): Promise<{ acknowledged: string[]; unresolved: string[] }> {
  const actor = Object.freeze({ ...actorInput });
  const original = structuredClone(
    await ports.syncState.get(actor.workspaceId),
  );
  if (
    !original?.remotePrincipalId ||
    original.workspaceId !== actor.workspaceId ||
    !original.remoteWorkspaceId ||
    !original.serverOrigin ||
    !original.epoch
  )
    throw new DomainError("FORBIDDEN");
  const plans = await planLocalCommands(
    actor,
    ports.metadata,
    await ports.outbox.list(actor.workspaceId),
  );
  const acknowledged: string[] = [],
    unresolved: string[] = [];
  for (const plan of plans) {
    if (plan.state !== "RECEIPT_REQUIRED") continue;
    const knowledge =
      (!!ports.knowledgeWiki && plan.command?.name.startsWith("note.")) ||
      (!!ports.knowledgeWiki && plan.command?.name.startsWith("library."));
    const request =
      (await buildLocalPurgeReplayRequest(
        plan,
        original,
        ports.memoIdentity,
      )) ??
      (ports.memoIdentity
        ? await buildLocalEntityMemoReplayRequest(
            plan,
            original,
            ports.memoIdentity,
          )
        : null) ??
      buildLocalReminderReplayRequest(plan) ??
      buildLocalCalendarReplayRequest(plan) ??
      buildLocalNavigationReplayRequest(plan, original) ??
      buildLocalManualOrderReplayRequest(plan) ??
      buildLocalCategoryReplayRequest(plan) ??
      buildLocalOrganizationReplayRequest(plan) ??
      buildLocalProjectKnowledgeReplayRequest(plan) ??
      buildLocalRecurrenceReplayRequest(plan) ??
      buildLocalLinkedKnowledgeReplayRequest(plan) ??
      buildLocalNoteKnowledgeReplayRequest(plan) ??
      buildLocalPlanReplayRequest(plan) ??
      buildLocalFileReplayRequest(plan) ??
      (knowledge
        ? buildLocalKnowledgeReplayRequest(plan)
        : buildLocalWorkReplayRequest(plan));
    if (
      !request ||
      plan.mutations.some((mutation) => mutation.state !== "SENDING")
    ) {
      unresolved.push(plan.id);
      continue;
    }
    const binding = structuredClone(
      await ports.syncState.get(actor.workspaceId),
    );
    if (
      !binding ||
      binding.remotePrincipalId !== original.remotePrincipalId ||
      binding.remoteWorkspaceId !== original.remoteWorkspaceId ||
      binding.serverOrigin !== original.serverOrigin ||
      binding.epoch !== original.epoch
    )
      throw new DomainError("VERSION_CONFLICT");
    const receipt = await ports.transport.lookup(
      binding,
      request.idempotencyKey,
      request.deviceId,
    );
    if (receipt === null) {
      unresolved.push(plan.id);
      continue;
    }
    const pending = await ports.outbox.list(actor.workspaceId);
    const current = (
      await planLocalCommands(actor, ports.metadata, pending)
    ).find((candidate) => candidate.id === plan.id);
    // Another transaction may have acknowledged it; do not manufacture a second ACK.
    if (!current) continue;
    const prepared =
      knowledge && ports.knowledgeWiki
        ? await prepareLocalKnowledgeReplayAcknowledgement(
            actor,
            binding,
            current,
            receipt,
            pending,
            ports.metadata,
            ports.knowledgeWiki,
          )
        : await prepareLocalWorkReplayAcknowledgement(
            actor,
            binding,
            current,
            receipt,
            pending,
            ports.metadata,
            ports.knowledgeWiki,
            ports.memoIdentity,
          );
    await ports.replica.commit(prepared);
    acknowledged.push(plan.id);
  }
  return { acknowledged, unresolved };
}
