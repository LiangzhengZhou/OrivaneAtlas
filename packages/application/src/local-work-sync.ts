import { type ActorContext, DomainError } from "@arclattice/domain";
import type { EntityMemoIdentity } from "./entity-memos";
import { buildLocalCalendarReplayRequest } from "./local-calendar-replay-request";
import { buildLocalCategoryReplayRequest } from "./local-category-replay-request";
import { type LocalCommandPlan, planLocalCommands } from "./local-command-plan";
import { hydrateLocalConflictBody } from "./local-conflict-body";
import { initializeLocalEntityMemoHistory } from "./local-entity-memo-bootstrap";
import { buildLocalEntityMemoReplayRequest } from "./local-entity-memo-replay-request";
import {
  type LocalFileBinaryTransport,
  syncLocalFileBinary,
} from "./local-file-binary-sync";
import { buildLocalFileReplayRequest } from "./local-file-replay-request";
import { prepareLocalKnowledgeReplayAcknowledgement } from "./local-knowledge-replay-ack";
import { buildLocalKnowledgeReplayRequest } from "./local-knowledge-replay-request";
import type { LocalWikiIndexer } from "./local-library-store";
import { buildLocalLinkedKnowledgeReplayRequest } from "./local-linked-knowledge-replay-request";
import { buildLocalManualOrderReplayRequest } from "./local-manual-order-replay-request";
import { buildLocalNavigationReplayRequest } from "./local-navigation-replay-request";
import { buildLocalNoteKnowledgeReplayRequest } from "./local-note-knowledge-replay-request";
import { buildLocalOrganizationReplayRequest } from "./local-organization-replay-request";
import {
  type LocalPendingWorkRebaseStore,
  prepareLocalPendingWorkRebase,
} from "./local-pending-work-rebase";
import type {
  LocalBlobStore,
  LocalMetadataStore,
  LocalOutboxStore,
  LocalSyncState,
  LocalSyncStateStore,
} from "./local-persistence";
import { buildLocalPlanReplayRequest } from "./local-plan-replay-request";
import { buildLocalProjectKnowledgeReplayRequest } from "./local-project-knowledge-replay-request";
import { buildLocalPurgeReplayRequest } from "./local-purge-replay-request";
import {
  type LocalReceiptTransport,
  recoverLocalWorkReceipts,
} from "./local-receipt-recovery";
import { buildLocalRecurrenceReplayRequest } from "./local-recurrence-replay-request";
import { buildLocalReminderReplayRequest } from "./local-reminder-replay-request";
import type { LocalReplicaStore } from "./local-replica";
import { prepareLocalWorkPull } from "./local-work-pull";
import { prepareLocalWorkReplayAcknowledgement } from "./local-work-replay-ack";
import {
  buildLocalWorkReplayRequest,
  type LocalWorkReplayRequest,
} from "./local-work-replay-request";

export interface LocalWorkSyncTransport extends LocalReceiptTransport {
  pullPrivateMemos?(binding: LocalSyncState, after: number): Promise<unknown>;
  readKnowledge?(
    binding: LocalSyncState,
    collection: "notes" | "library",
    id: string,
  ): Promise<unknown>;
  pull(binding: LocalSyncState): Promise<unknown>;
  send(
    binding: LocalSyncState,
    request: LocalWorkReplayRequest,
  ): Promise<unknown>;
}
export interface LocalWorkSyncPorts {
  memoIdentity?: Pick<EntityMemoIdentity, "forTarget">;
  pendingRebase?: {
    store: LocalPendingWorkRebaseStore;
    ids: { next(): string };
  };
  fileBinary?: { blobs: LocalBlobStore; transport: LocalFileBinaryTransport };
  knowledgeWiki?: LocalWikiIndexer;
  metadata: LocalMetadataStore;
  outbox: LocalOutboxStore;
  syncState: LocalSyncStateStore;
  replica: LocalReplicaStore;
  transport: LocalWorkSyncTransport;
  clock: { now(): string };
}
export interface LocalWorkSyncResult {
  accepted: string[];
  conflicted: string[];
  unresolved: string[];
  cursor: number;
}

/** Guarded Work/knowledge coordinator. Other families remain unresolved, never silently dropped. */
export class LocalWorkSyncCoordinator {
  private readonly actor: ActorContext;
  private flight: Promise<LocalWorkSyncResult> | null = null;
  private requested = false;
  constructor(
    actor: ActorContext,
    private readonly ports: LocalWorkSyncPorts,
  ) {
    this.actor = Object.freeze({ ...actor });
  }
  run(): Promise<LocalWorkSyncResult> {
    this.requested = true;
    if (this.flight) return this.flight;
    const execute = async () => {
      const accepted = new Set<string>();
      let result: LocalWorkSyncResult;
      do {
        this.requested = false;
        result = await this.cycle();
        for (const id of result.accepted) accepted.add(id);
      } while (this.requested);
      return { ...result, accepted: [...accepted] };
    };
    this.flight = execute().finally(() => {
      this.flight = null;
    });
    return this.flight;
  }
  private async cycle(): Promise<LocalWorkSyncResult> {
    const { actor, ports } = this;
    const original = structuredClone(
      await ports.syncState.get(actor.workspaceId),
    );
    if (
      !original?.remotePrincipalId ||
      !original.remoteWorkspaceId ||
      !original.serverOrigin ||
      !original.epoch ||
      original.workspaceId !== actor.workspaceId
    )
      throw new DomainError("FORBIDDEN");
    const remoteWorkspaceId = original.remoteWorkspaceId;
    const serverOrigin = original.serverOrigin;
    const binding = async () => {
      const current = structuredClone(
        await ports.syncState.get(actor.workspaceId),
      );
      if (
        !current ||
        current.workspaceId !== actor.workspaceId ||
        current.remotePrincipalId !== original.remotePrincipalId ||
        current.remoteWorkspaceId !== original.remoteWorkspaceId ||
        current.serverOrigin !== original.serverOrigin ||
        current.epoch !== original.epoch
      )
        throw new DomainError("VERSION_CONFLICT", { field: "syncBinding" });
      return { ...current, remoteWorkspaceId, serverOrigin };
    };
    const pull = async () => {
      let hasMore: boolean;
      do {
        const scope = await binding();
        const page = await ports.transport.pull(scope);
        const prepared = await prepareLocalWorkPull(
          actor,
          scope,
          page,
          await ports.outbox.list(actor.workspaceId),
          ports.metadata,
          ports.memoIdentity,
        );
        hasMore =
          typeof page === "object" &&
          page !== null &&
          "hasMore" in page &&
          page.hasMore === true;
        if (hasMore && (!prepared || prepared.nextCursor <= scope.cursor))
          throw new DomainError("VALIDATION_ERROR", { field: "syncCursor" });
        if (prepared) await ports.replica.commit(prepared);
      } while (hasMore);
    };
    if (ports.memoIdentity) {
      if (!ports.transport.pullPrivateMemos)
        throw new Error("LOCAL_MEMO_BOOTSTRAP_PORT_INCOMPLETE");
      await initializeLocalEntityMemoHistory(actor, binding, {
        identity: ports.memoIdentity,
        metadata: ports.metadata,
        outbox: ports.outbox,
        replica: ports.replica,
        pull: (scope, after) => ports.transport.pullPrivateMemos!(scope, after),
      });
    }
    await pull();
    const recovered = await recoverLocalWorkReceipts(actor, ports);
    const accepted = new Set(recovered.acknowledged);
    let plans = await planLocalCommands(
      actor,
      ports.metadata,
      await ports.outbox.list(actor.workspaceId),
    );
    if (ports.pendingRebase) {
      let changed = false;
      let pending = await ports.outbox.list(actor.workspaceId);
      for (const plan of plans) {
        if (
          plan.state === "READY" &&
          plan.mutations.length === 1 &&
          plan.mutations[0]?.attemptCount === 0 &&
          ports.transport.readKnowledge
        )
          await hydrateLocalConflictBody(
            actor,
            await binding(),
            plan.mutations[0],
            ports.metadata,
            ports.replica,
            (captured, collection, id) =>
              ports.transport.readKnowledge!(captured, collection, id),
          );
        const prepared = await prepareLocalPendingWorkRebase(
          actor,
          await binding(),
          plan,
          pending,
          ports.metadata,
          ports.pendingRebase.ids,
          ports.clock,
          undefined,
          ports.knowledgeWiki,
          ports.memoIdentity,
        );
        if (prepared) {
          await ports.pendingRebase.store.commit(prepared);
          pending = await ports.outbox.list(actor.workspaceId);
          changed = true;
        }
      }
      if (changed)
        plans = await planLocalCommands(
          actor,
          ports.metadata,
          await ports.outbox.list(actor.workspaceId),
        );
    }
    const acknowledge = async (plan: LocalCommandPlan, receipt: unknown) => {
      const pending = await ports.outbox.list(actor.workspaceId);
      if (!pending.some((mutation) => plan.mutationIds.includes(mutation.id)))
        return;
      const knowledge =
        ports.knowledgeWiki &&
        (plan.command?.name.startsWith("note.") ||
          plan.command?.name.startsWith("library."));
      const prepared =
        knowledge && ports.knowledgeWiki
          ? await prepareLocalKnowledgeReplayAcknowledgement(
              actor,
              await binding(),
              plan,
              receipt,
              pending,
              ports.metadata,
              ports.knowledgeWiki,
            )
          : await prepareLocalWorkReplayAcknowledgement(
              actor,
              await binding(),
              plan,
              receipt,
              pending,
              ports.metadata,
              ports.knowledgeWiki,
              ports.memoIdentity,
            );
      await ports.replica.commit(prepared);
    };
    const blockedEntities = new Set<string>();
    const planIndex = new Map<string, number>(),
      lastEntityPlan = new Map<string, number>();
    for (const [index, plan] of plans.entries()) {
      planIndex.set(plan.id, index);
      for (const mutation of plan.mutations)
        lastEntityPlan.set(
          JSON.stringify([mutation.entityType, mutation.entityId]),
          index,
        );
    }
    const block = (plan: LocalCommandPlan) => {
      for (const mutation of plan.mutations)
        blockedEntities.add(
          JSON.stringify([mutation.entityType, mutation.entityId]),
        );
    };
    const acceptedPlan = (plan: LocalCommandPlan) => {
      accepted.add(plan.id);
      const index = planIndex.get(plan.id);
      if (index === undefined) throw new DomainError("VALIDATION_ERROR");
      if (
        plan.mutations.some(
          (mutation) =>
            (lastEntityPlan.get(
              JSON.stringify([mutation.entityType, mutation.entityId]),
            ) ?? -1) > index,
        )
      ) {
        // A predecessor ACK changes the canonical base. Never send a successor
        // from this stale plan set; the next cycle rechecks/rebases its original
        // intent through the existing transaction and CAS guards.
        block(plan);
        this.requested = true;
      }
    };
    for (const plan of plans) {
      if (
        plan.mutations.some((mutation) =>
          blockedEntities.has(
            JSON.stringify([mutation.entityType, mutation.entityId]),
          ),
        ) ||
        (plan.state !== "READY" && plan.state !== "RECEIPT_REQUIRED")
      ) {
        block(plan);
        continue;
      }
      const request =
        (ports.memoIdentity
          ? await buildLocalEntityMemoReplayRequest(
              plan,
              await binding(),
              ports.memoIdentity,
            )
          : null) ??
        (await buildLocalPurgeReplayRequest(
          plan,
          await binding(),
          ports.memoIdentity,
        )) ??
        buildLocalWorkReplayRequest(plan) ??
        buildLocalReminderReplayRequest(plan) ??
        buildLocalCalendarReplayRequest(plan) ??
        buildLocalNavigationReplayRequest(plan, await binding()) ??
        buildLocalManualOrderReplayRequest(plan) ??
        buildLocalCategoryReplayRequest(plan) ??
        buildLocalOrganizationReplayRequest(plan) ??
        buildLocalProjectKnowledgeReplayRequest(plan) ??
        buildLocalRecurrenceReplayRequest(plan) ??
        buildLocalLinkedKnowledgeReplayRequest(plan) ??
        buildLocalNoteKnowledgeReplayRequest(plan) ??
        buildLocalPlanReplayRequest(plan) ??
        buildLocalFileReplayRequest(plan) ??
        (ports.knowledgeWiki ? buildLocalKnowledgeReplayRequest(plan) : null);
      if (
        !request ||
        (plan.state === "RECEIPT_REQUIRED" &&
          plan.mutations.some((mutation) => mutation.state !== "SENDING"))
      ) {
        block(plan);
        continue;
      }
      let sending = plan;
      if (plan.command?.name === "file.upload" && !ports.fileBinary) {
        block(plan);
        continue;
      }
      if (plan.state === "READY") {
        const scope = await binding();
        const mutations = await ports.outbox.transitionMany(
          plan.mutations.map((mutation) => ({
            workspaceId: actor.workspaceId,
            mutationId: mutation.id,
            binding: scope,
            expectedState: "PENDING",
            expectedAttemptCount: mutation.attemptCount,
            expectedLastAttemptAt: mutation.lastAttemptAt,
            nextState: "SENDING",
            at: ports.clock.now(),
          })),
        );
        sending = { ...plan, state: "RECEIPT_REQUIRED", mutations };
      } else {
        const receipt = await ports.transport.lookup(
          await binding(),
          request.idempotencyKey,
          request.deviceId,
        );
        if (receipt !== null) {
          await acknowledge(sending, receipt);
          acceptedPlan(plan);
          continue;
        }
      }
      let receipt: unknown;
      if (plan.command?.name === "file.upload" && ports.fileBinary)
        await syncLocalFileBinary(
          actor,
          plan,
          ports.fileBinary.blobs,
          ports.fileBinary.transport,
          binding,
        );
      try {
        receipt = await ports.transport.send(await binding(), request);
      } catch (error) {
        // Recover receipts first. A missing Memo target also needs explicit
        // conflict review; retain the command until an owner-scoped pull proves
        // what was removed. A 404 never authorizes dropping or recreating it.
        if (
          !(error instanceof DomainError) ||
          !(
            error.code === "VERSION_CONFLICT" ||
            (error.code === "NOT_FOUND" && plan.command?.name === "memo.save")
          )
        )
          throw error;
        receipt = await ports.transport.lookup(
          await binding(),
          request.idempotencyKey,
          request.deviceId,
        );
        if (receipt === null) {
          const scope = await binding();
          await ports.outbox.transitionMany(
            sending.mutations.map((mutation) => ({
              workspaceId: actor.workspaceId,
              mutationId: mutation.id,
              binding: scope,
              expectedState: "SENDING",
              expectedAttemptCount: mutation.attemptCount,
              expectedLastAttemptAt: mutation.lastAttemptAt,
              nextState: "CONFLICT",
              at: ports.clock.now(),
            })),
          );
          block(plan);
          continue;
        }
      }
      await acknowledge(sending, receipt);
      acceptedPlan(plan);
    }
    await pull();
    const remaining = await planLocalCommands(
      actor,
      ports.metadata,
      await ports.outbox.list(actor.workspaceId),
    );
    return {
      accepted: [...accepted],
      conflicted: remaining
        .filter((plan) => plan.state === "CONFLICT")
        .map((plan) => plan.id),
      unresolved: remaining
        .filter((plan) => plan.state !== "CONFLICT")
        .map((plan) => plan.id),
      cursor: (await binding()).cursor,
    };
  }
}
