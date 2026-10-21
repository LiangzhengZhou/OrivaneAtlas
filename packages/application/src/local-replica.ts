import type { LocalRecordWrite, LocalSyncState } from "./local-persistence";

/** Canonical data and its cursor/receipt become durable together. */
export interface LocalReplicaCommit {
  readonly workspaceId: string;
  readonly principalId: string;
  readonly expectedWorkspaceVersion: number | null;
  readonly binding: LocalSyncState;
  readonly nextCursor: number;
  readonly records: readonly LocalRecordWrite[];
  readonly acknowledgement?: LocalMutationAcknowledgement;
  readonly acknowledgements?: readonly LocalMutationAcknowledgement[];
}

export interface LocalMutationAcknowledgement {
  readonly mutationId: string;
  readonly deviceId: string;
  readonly attemptCount: number;
  readonly lastAttemptAt: string;
}

export interface LocalReplicaStore {
  commit(input: LocalReplicaCommit): Promise<void>;
}

export const replicaCollections: ReadonlySet<string> = new Set([
  "items",
  "edges",
  "categories",
  "workflows",
  "organization",
  "reminders",
  "entityMemos",
  "navigationPreference",
  "calendarSettings",
  "manualOrders",
  "notes",
  "library",
  "wikiLinks",
  "links",
  "projectMaterials",
  "files",
  "libraryAssets",
  "$local.remoteBase",
  "$local.entityMemoBootstrap",
  "$local.conflicts",
  "$local.noteBody",
  "$local.libraryBody",
  "$local.noteBodyAvailability",
  "$local.libraryBodyAvailability",
  "$local.noteRevision",
  "$local.libraryRevision",
  "$local.noteSearch",
  "$local.librarySearch",
  "$local.wikiSources",
]);
