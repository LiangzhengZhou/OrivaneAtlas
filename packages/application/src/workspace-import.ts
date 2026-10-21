import { type ActorContext, DomainError } from "@arclattice/domain";
import { localObject } from "./local-dto";
import type { LocalJson } from "./local-persistence";
import {
  requireStableUuid,
  requireWorkspaceMutationPrecondition,
  type WorkspaceMutationPrecondition,
} from "./mutation-receipt";
import {
  resolveWorkspaceImportSteps,
  type WorkspaceImportResolution,
} from "./workspace-import-resolution";
import type { WorkspaceMergeBackup } from "./workspace-merge-backup";

/** Payloads are prepared by formal entity planners, never raw database rows. */
export interface WorkspaceImportStep {
  readonly id: string;
  readonly path: string;
  readonly payload: LocalJson;
  readonly binary?: {
    readonly contentHash: string;
    readonly size: number;
    readonly mime: string;
  };
  readonly source?: {
    readonly collection: string;
    readonly id: string;
    readonly version: number;
  };
}
export interface WorkspaceImportJournal {
  readonly id: string;
  readonly reviewedChanges?: readonly WorkspaceImportResolution[];
  readonly parent?: {
    readonly id: string;
    readonly version: number;
    readonly acceptedSteps: number;
  };
  readonly version: number;
  readonly backupId: string;
  readonly backupSha256: string;
  readonly sourceWorkspaceId: string;
  readonly sourcePrincipalId: string;
  readonly sourceRevision: number;
  readonly targetWorkspaceId: string;
  readonly targetPrincipalId: string;
  readonly targetOrigin: string;
  readonly initialRevision: WorkspaceMutationPrecondition;
  readonly revision: WorkspaceMutationPrecondition;
  readonly steps: readonly WorkspaceImportStep[];
  readonly accepted: readonly {
    readonly stepId: string;
    readonly result: LocalJson;
    readonly revision: WorkspaceMutationPrecondition;
  }[];
}
/** Recovery catalogue deliberately excludes command payloads and accepted entity bodies. */
export interface WorkspaceImportSummary {
  readonly id: string;
  readonly backupId: string;
  readonly targetWorkspaceId: string;
  readonly targetPrincipalId: string;
  readonly targetOrigin: string;
  readonly version: number;
  readonly completedSteps: number;
  readonly totalSteps: number;
  readonly complete: boolean;
  readonly supersededBy?: string;
}

export interface WorkspaceImportStore {
  create(journal: WorkspaceImportJournal): Promise<void>;
  get(id: string): Promise<WorkspaceImportJournal | null>;
  advance(
    expected: WorkspaceImportJournal,
    next: WorkspaceImportJournal,
  ): Promise<void>;
  close(): void;
}
const paths = new Set([
  "/api/memo/save",
  "/api/categories/save",
  "/api/organize",
  "/api/manual-orders/sequence",
  "/api/files/register",
  "/api/files/rename",
  "/api/work/create",
  "/api/work/update",
  "/api/edge/create",
  "/api/link/create",
  "/api/projects/space/link",
  "/api/projects/link",
  "/api/projects/space/create",
  "/api/projects/document/create",
  "/api/note/save",
  "/api/library/save",
  "/api/reminders/save",
]);

/** Validate even persisted journals before issuing any request. */
export function requireWorkspaceImportJournal(
  input: WorkspaceImportJournal,
): void {
  requireStableUuid(input.id);
  requireStableUuid(input.backupId);
  if (
    input.reviewedChanges &&
    (!input.parent || !Array.isArray(input.reviewedChanges))
  )
    throw new DomainError("VALIDATION_ERROR");
  if (input.parent) {
    requireStableUuid(input.parent.id);
    if (
      input.parent.id === input.id ||
      !Number.isSafeInteger(input.parent.version) ||
      input.parent.version < 1 ||
      !Number.isSafeInteger(input.parent.acceptedSteps) ||
      input.parent.acceptedSteps < 0 ||
      input.parent.version !== input.parent.acceptedSteps + 1
    )
      throw new DomainError("VALIDATION_ERROR", {
        field: "workspaceImportParent",
      });
  }
  if (
    !/^[a-f0-9]{64}$/.test(input.backupSha256) ||
    !Number.isSafeInteger(input.version) ||
    input.version !== input.accepted.length + 1 ||
    !Number.isSafeInteger(input.sourceRevision) ||
    input.sourceRevision < 0 ||
    !input.sourceWorkspaceId ||
    !input.sourcePrincipalId ||
    !input.targetWorkspaceId ||
    !input.targetPrincipalId ||
    input.sourceWorkspaceId === input.targetWorkspaceId ||
    !input.targetOrigin ||
    input.accepted.length > input.steps.length
  )
    throw new DomainError("VALIDATION_ERROR", { field: "workspaceImport" });
  requireWorkspaceMutationPrecondition(input.initialRevision);
  requireWorkspaceMutationPrecondition(input.revision);
  const ids = new Set<string>();
  for (const step of input.steps) {
    requireStableUuid(step.id);
    if (
      step.binary &&
      (step.path !== "/api/files/register" ||
        !/^[a-f0-9]{64}$/.test(step.binary.contentHash) ||
        !Number.isSafeInteger(step.binary.size) ||
        step.binary.size < 0 ||
        typeof step.binary.mime !== "string")
    )
      throw new DomainError("VALIDATION_ERROR", {
        field: "workspaceImportBinary",
      });
    if (
      step.source &&
      (!step.source.collection ||
        typeof step.source.collection !== "string" ||
        typeof step.source.id !== "string" ||
        !step.source.id ||
        !Number.isSafeInteger(step.source.version) ||
        step.source.version < 1)
    )
      throw new DomainError("VALIDATION_ERROR", {
        field: "workspaceImportSource",
      });
    if (
      ids.has(step.id) ||
      !paths.has(step.path) ||
      !step.payload ||
      typeof step.payload !== "object" ||
      Array.isArray(step.payload)
    )
      throw new DomainError("VALIDATION_ERROR", {
        field: "workspaceImportStep",
      });
    ids.add(step.id);
    if (step.path === "/api/files/register") {
      const payload = localObject(step.payload);
      if (
        !step.binary ||
        payload.contentHash !== step.binary.contentHash ||
        payload.size !== step.binary.size ||
        payload.mime !== step.binary.mime
      )
        throw new DomainError("VALIDATION_ERROR", {
          field: "workspaceImportBinary",
        });
    }
  }
  let revision = input.initialRevision;
  for (const [index, accepted] of input.accepted.entries()) {
    requireWorkspaceMutationPrecondition(accepted.revision);
    if (
      accepted.stepId !== input.steps[index]?.id ||
      accepted.revision.epoch !== revision.epoch ||
      accepted.revision.cursor < revision.cursor
    )
      throw new DomainError("VALIDATION_ERROR", {
        field: "workspaceImportReceipt",
      });
    revision = accepted.revision;
  }
  if (
    input.revision.epoch !== revision.epoch ||
    input.revision.cursor !== revision.cursor
  )
    throw new DomainError("VALIDATION_ERROR", {
      field: "workspaceImportRevision",
    });
}

export function createWorkspaceImportJournal(
  actor: ActorContext,
  backup: WorkspaceMergeBackup,
  id: string,
  steps: readonly WorkspaceImportStep[],
): WorkspaceImportJournal {
  if (
    backup.sourceWorkspaceId !== actor.workspaceId ||
    backup.sourcePrincipalId !== actor.principalId
  )
    throw new DomainError("FORBIDDEN");
  const revision = { epoch: backup.targetEpoch, cursor: backup.targetRevision };
  const journal: WorkspaceImportJournal = structuredClone({
    id,
    version: 1,
    backupId: backup.id,
    backupSha256: backup.sha256,
    sourceWorkspaceId: backup.sourceWorkspaceId,
    sourcePrincipalId: backup.sourcePrincipalId,
    sourceRevision: backup.sourceRevision,
    targetWorkspaceId: backup.targetWorkspaceId,
    targetPrincipalId: backup.targetPrincipalId,
    targetOrigin: backup.targetOrigin,
    initialRevision: revision,
    revision,
    steps,
    accepted: [],
  });
  requireWorkspaceImportJournal(journal);
  return journal;
}

export interface WorkspaceImportPorts {
  store: WorkspaceImportStore;
  /** Must check captured account/origin/generation and source revision. */
  assertScope(journal: WorkspaceImportJournal): Promise<void>;
  verifyBackup(journal: WorkspaceImportJournal): Promise<void>;
  apply(
    step: WorkspaceImportStep,
    journal: WorkspaceImportJournal,
  ): Promise<{
    result: LocalJson;
    workspaceRevision: WorkspaceMutationPrecondition;
  }>;
}

/** Additive, resumable steps. This service NEVER binds or activates a source replica. */
export async function continueWorkspaceImport(
  actorInput: ActorContext,
  id: string,
  ports: WorkspaceImportPorts,
): Promise<WorkspaceImportJournal> {
  return advanceWorkspaceImport(actorInput, id, ports, (step, journal) =>
    ports.apply(step, journal),
  );
}

/** Read-only remote recovery; a missing receipt never executes an unaccepted command. */
export function recoverWorkspaceImportReceipts(
  actor: ActorContext,
  id: string,
  ports: Omit<WorkspaceImportPorts, "apply"> & {
    lookup(
      step: WorkspaceImportStep,
      journal: WorkspaceImportJournal,
    ):
      | ReturnType<WorkspaceImportPorts["apply"]>
      | Promise<Awaited<ReturnType<WorkspaceImportPorts["apply"]>> | null>;
  },
): Promise<WorkspaceImportJournal> {
  return advanceWorkspaceImport(actor, id, ports, (step, journal) =>
    ports.lookup(step, journal),
  );
}

async function advanceWorkspaceImport(
  actorInput: ActorContext,
  id: string,
  ports: Omit<WorkspaceImportPorts, "apply">,
  apply: (
    step: WorkspaceImportStep,
    journal: WorkspaceImportJournal,
  ) => Promise<Awaited<ReturnType<WorkspaceImportPorts["apply"]>> | null>,
): Promise<WorkspaceImportJournal> {
  const actor = Object.freeze({ ...actorInput });
  const saved = await ports.store.get(id);
  if (!saved) throw new DomainError("NOT_FOUND");
  let journal = structuredClone(saved);
  requireWorkspaceImportJournal(journal);
  if (
    journal.sourceWorkspaceId !== actor.workspaceId ||
    journal.sourcePrincipalId !== actor.principalId
  )
    throw new DomainError("FORBIDDEN");
  await ports.assertScope(journal);
  await ports.verifyBackup(journal);
  while (journal.accepted.length < journal.steps.length) {
    await ports.assertScope(journal);
    const step = journal.steps[journal.accepted.length]!;
    const reply = await apply(structuredClone(step), structuredClone(journal));
    await ports.assertScope(journal);
    if (reply === null) break;
    const next: WorkspaceImportJournal = structuredClone({
      ...journal,
      version: journal.version + 1,
      revision: reply.workspaceRevision,
      accepted: [
        ...journal.accepted,
        {
          stepId: step.id,
          result: reply.result,
          revision: reply.workspaceRevision,
        },
      ],
    });
    requireWorkspaceImportJournal(next);
    await ports.store.advance(journal, next);
    journal = next;
  }
  await ports.assertScope(journal);
  return journal;
}

/** Fork only the unaccepted suffix; old receipts/backup remain immutable evidence. */
export function createWorkspaceImportFork(
  actor: ActorContext,
  originalInput: WorkspaceImportJournal,
  backup: WorkspaceMergeBackup,
  id: string,
  ids: { next(): string },
  resolutions: readonly WorkspaceImportResolution[] = [],
): WorkspaceImportJournal {
  const original = structuredClone(originalInput);
  requireWorkspaceImportJournal(original);
  if (
    actor.workspaceId !== original.sourceWorkspaceId ||
    actor.principalId !== original.sourcePrincipalId
  )
    throw new DomainError("FORBIDDEN");
  const used = new Set([
    original.id,
    id,
    ...original.steps.map((step) => step.id),
  ]);
  const steps = resolveWorkspaceImportSteps(original, resolutions).map(
    (step) => {
      const nextId = requireStableUuid(ids.next());
      if (used.has(nextId)) throw new DomainError("VALIDATION_ERROR");
      used.add(nextId);
      const payload = structuredClone(localObject(step.payload));
      if (payload.syncCommand !== undefined)
        payload.syncCommand = {
          ...localObject(payload.syncCommand),
          commandId: nextId,
        };
      return { ...step, id: nextId, payload };
    },
  );
  const child = {
    ...createWorkspaceImportJournal(actor, backup, id, steps),
    ...(resolutions.length
      ? { reviewedChanges: structuredClone(resolutions) }
      : {}),
    parent: {
      id: original.id,
      version: original.version,
      acceptedSteps: original.accepted.length,
    },
  };
  requireWorkspaceImportFork(original, child);
  return child;
}

/** Adapter checks lineage under its strict create transaction, never outside its CAS. */
export function requireWorkspaceImportFork(
  original: WorkspaceImportJournal,
  child: WorkspaceImportJournal,
): void {
  requireWorkspaceImportJournal(original);
  requireWorkspaceImportJournal(child);
  if (
    !child.parent ||
    child.parent.id !== original.id ||
    child.parent.version !== original.version ||
    child.parent.acceptedSteps !== original.accepted.length ||
    child.version !== 1 ||
    child.accepted.length !== 0 ||
    child.steps.length !== original.steps.length - original.accepted.length ||
    !child.steps.length ||
    child.backupId === original.backupId ||
    child.initialRevision.epoch !== original.revision.epoch ||
    child.initialRevision.cursor <= original.revision.cursor ||
    [
      "sourceWorkspaceId",
      "sourcePrincipalId",
      "sourceRevision",
      "targetWorkspaceId",
      "targetPrincipalId",
      "targetOrigin",
    ].some(
      (field) =>
        original[field as keyof WorkspaceImportJournal] !==
        child[field as keyof WorkspaceImportJournal],
    )
  )
    throw new DomainError("VERSION_CONFLICT", {
      field: "workspaceImportParent",
    });
  const oldIds = new Set(original.steps.map((step) => step.id));
  const reviewed = resolveWorkspaceImportSteps(
    original,
    child.reviewedChanges ?? [],
  );
  for (const [index, step] of child.steps.entries()) {
    const previous = reviewed[index]!;
    const expectedPayload = structuredClone(localObject(previous.payload));
    if (expectedPayload.syncCommand !== undefined)
      expectedPayload.syncCommand = {
        ...localObject(expectedPayload.syncCommand),
        commandId: step.id,
      };
    if (
      oldIds.has(step.id) ||
      step.id === original.id ||
      step.id === child.id ||
      JSON.stringify({ ...previous, id: step.id, payload: expectedPayload }) !==
        JSON.stringify(step)
    )
      throw new DomainError("VERSION_CONFLICT", {
        field: "workspaceImportSuffix",
      });
  }
}
