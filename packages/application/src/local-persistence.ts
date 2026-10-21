import type { FileExtractionStore } from "./file-extraction";
import type { FileProcessingStore } from "./file-processing";
import type { DocumentWikiLink } from "./library";

export type LocalJson =
  | null
  | boolean
  | number
  | string
  | readonly LocalJson[]
  | { readonly [key: string]: LocalJson };

export interface LocalEntity {
  readonly workspaceId: string;
  readonly collection: string;
  readonly id: string;
  readonly version: number;
  readonly value: LocalJson;
}

export interface LocalMutation {
  readonly commandId?: string;
  readonly basePayload?: LocalJson;
  readonly order?: {
    readonly transactionVersion: number;
    readonly operationIndex: number;
  };
  readonly id: string;
  readonly deviceId: string;
  readonly workspaceId: string;
  readonly principalId: string;
  readonly operation:
    | "CREATE"
    | "PATCH"
    | "DELETE"
    | "MOVE"
    | "LINK"
    | "UNLINK";
  readonly entityType: string;
  readonly entityId: string;
  readonly baseVersion: number | null;
  readonly payload: LocalJson;
  readonly createdAt: string;
  readonly attemptCount: number;
  readonly lastAttemptAt: string | null;
  readonly state: "PENDING" | "SENDING" | "CONFLICT" | "REJECTED";
}

export interface LocalRecordWrite {
  readonly entity: LocalEntity;
  readonly expectedVersion: number | null;
}

export interface LocalWrite extends LocalRecordWrite {
  readonly mutation: LocalMutation;
}

/** Promise resolution means transaction completion, never request success. */
export interface LocalMetadataStore {
  readonly detachedReads?: true;
  readCanonicalWikiLinks?(
    workspaceId: string,
    sourceIds: readonly string[],
  ): Promise<readonly DocumentWikiLink[]>;
  validateLibraryBodyAvailability?(
    workspaceId: string,
    checks: readonly {
      readonly manifest: LocalEntity;
      readonly availability: LocalEntity | null;
    }[],
  ): Promise<readonly boolean[]>;
  /** Derived File index invalidation; never a global business snapshot notification. */
  subscribeFileIndex?(workspaceId: string, listener: () => void): () => void;
  subscribeFileProcessing?(
    workspaceId: string,
    fileId: string,
    listener: () => void,
  ): () => void;
  readonly fileExtractions?: FileExtractionStore;
  readonly fileProcessing?: FileProcessingStore;
  /** Ordered scoped reads in one consistent local snapshot when supported. */
  getMany?(
    workspaceId: string,
    refs: readonly { readonly collection: string; readonly id: string }[],
  ): Promise<readonly (LocalEntity | null)[]>;
  searchCandidates?(
    workspaceId: string,
    collection: string,
    gram: string,
  ): Promise<readonly LocalEntity[]>;
  assertEmptyWorkspace?(): Promise<void>;
  restoreEmptyWorkspace?(
    archive: LocalWorkspaceArchive,
    newDeviceId: string,
  ): Promise<void>;
  exportWorkspace?(workspaceId: string): Promise<LocalWorkspaceArchive>;
  repairWikiIndex?(
    workspaceId: string,
    principalId: string,
    records: readonly LocalRecordWrite[],
  ): Promise<void>;
  /** Invalidation hints only; durable reads remain authoritative. */
  subscribe?(workspaceId: string, listener: () => void): () => void;
  get(
    workspaceId: string,
    collection: string,
    id: string,
  ): Promise<LocalEntity | null>;
  list(
    workspaceId: string,
    collection: string,
  ): Promise<readonly LocalEntity[]>;
  commit(
    workspaceId: string,
    principalId: string,
    writes: readonly LocalWrite[],
    /** Internal bodies/revisions/activity/read-set guard; same atomic commit. */
    records?: readonly LocalRecordWrite[],
  ): Promise<void>;
}

/**
 * Device-local notification persistence. Records never enter the Outbox here:
 * read/dismiss/snooze convergence across devices is a separate, explicit sync
 * concern. Writes are restricted to two collections and use version CAS.
 */
export const localNotificationCollections = [
  "$local.notification",
  "$local.notificationPreferences",
] as const;
export interface LocalNotificationStore {
  list(workspaceId: string): Promise<readonly LocalEntity[]>;
  getPreferences(workspaceId: string): Promise<LocalEntity | null>;
  /** Atomic CAS batch. Any version mismatch aborts the whole batch. */
  commit(
    workspaceId: string,
    writes: readonly LocalRecordWrite[],
  ): Promise<void>;
  subscribe(workspaceId: string, listener: () => void): () => void;
}

export interface LocalBlobStore {
  listHashes?(workspaceId: string): Promise<readonly string[]>;
  digest?(bytes: Blob): Promise<string>;
  put(workspaceId: string, expectedSha256: string, bytes: Blob): Promise<void>;
  get(workspaceId: string, sha256: string): Promise<Blob | null>;
}

export interface LocalWorkspaceArchive {
  readonly schemaVersion: 2;
  readonly identity: LocalWorkspaceIdentity;
  readonly entities: readonly LocalEntity[];
  readonly mutations: readonly LocalMutation[];
  readonly syncState: LocalSyncState | null;
}

/** Incomplete uploads remain binary staging, never visible File entities. */
export interface LocalBlobUpload {
  readonly workspaceId: string;
  readonly sha256: string;
  readonly size: number;
  readonly mime: string;
  readonly chunkSize: number;
}
export interface LocalChunkBlobStore extends LocalBlobStore {
  begin(upload: LocalBlobUpload): Promise<void>;
  chunks(workspaceId: string, sha256: string): Promise<readonly number[]>;
  putChunk(
    workspaceId: string,
    sha256: string,
    index: number,
    chunkHash: string,
    bytes: Blob,
  ): Promise<void>;
  complete(workspaceId: string, sha256: string): Promise<void>;
}

export interface LocalOutboxStore {
  transitionMany(
    inputs: readonly LocalOutboxTransition[],
  ): Promise<readonly LocalMutation[]>;
  transition(input: LocalOutboxTransition): Promise<LocalMutation>;
  list(workspaceId: string): Promise<readonly LocalMutation[]>;
  recoverSending(workspaceId: string): Promise<number>;
}

export interface LocalOutboxTransition {
  readonly workspaceId: string;
  readonly mutationId: string;
  readonly binding: {
    readonly remotePrincipalId?: string | null;
    readonly version: number;
    readonly remoteWorkspaceId: string;
    readonly serverOrigin: string;
  };
  readonly expectedState: "PENDING" | "SENDING";
  readonly expectedAttemptCount: number;
  readonly expectedLastAttemptAt: string | null;
  readonly nextState: LocalMutation["state"];
  readonly at: string;
}

export interface LocalSyncState {
  /** Missing on legacy bindings; re-confirm identity before new automatic sync. */
  readonly remotePrincipalId?: string | null;
  readonly workspaceId: string;
  readonly remoteWorkspaceId: string | null;
  readonly serverOrigin: string | null;
  readonly epoch: string | null;
  readonly cursor: number;
  readonly version: number;
}

export interface LocalSyncStateStore {
  /** Initial binding only; rejects any existing entity/outbox/binding atomically. */
  bindEmpty?(state: LocalSyncState): Promise<void>;
  get(workspaceId: string): Promise<LocalSyncState | null>;
  save(state: LocalSyncState, expectedVersion: number | null): Promise<void>;
}

/** Installation-local identity; never a server credential or authorization proof. */
export interface LocalWorkspaceIdentity {
  readonly schemaVersion: 1;
  readonly workspaceId: string;
  readonly principalId: string;
  readonly deviceId: string;
}
export interface LocalWorkspaceIdentityStore {
  get(): Promise<LocalWorkspaceIdentity | null>;
  /** Concurrent first launches return the same transactionally chosen identity. */
  ensure(candidate: LocalWorkspaceIdentity): Promise<LocalWorkspaceIdentity>;
}

export class LocalStorageError extends Error {
  constructor(
    readonly code: "INVALID_WRITE" | "VERSION_CONFLICT" | "HASH_MISMATCH",
    readonly conflict?: {
      readonly collection: string;
      readonly entityId: string;
    },
  ) {
    super(code);
    this.name = "LocalStorageError";
  }
}
