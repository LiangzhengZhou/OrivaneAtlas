import { type ActorContext, DomainError } from "@arclattice/domain";
import type { Clock, IdGenerator } from "./index";
import { requireProjectedWikiLink } from "./local-canonical-wiki-read";
import {
  type LocalCommandIntent,
  localWorkCommandNames,
} from "./local-command";
import { localDto } from "./local-dto";
import {
  type LocalEntity,
  type LocalJson,
  type LocalMetadataStore,
  type LocalMutation,
  type LocalRecordWrite,
  type LocalWrite,
} from "./local-persistence";

/** A read-only snapshot changed before validation; no result may escape it. */
export class LocalReadSnapshotChangedError extends DomainError {
  constructor() {
    super("VERSION_CONFLICT");
    this.name = "LocalReadSnapshotChangedError";
  }
}

/** Stages asynchronous Application work; only the final adapter commit is live. */
export class LocalMutationTransaction {
  private readonly writes = new Map<string, LocalWrite>();
  private readonly records = new Map<string, LocalRecordWrite>();
  private readonly writeSequence: LocalWrite[] = [];
  private readonly recordSequence: LocalRecordWrite[] = [];
  private readonly collectionReads = new Map<
    string,
    Promise<readonly LocalEntity[]>
  >();
  private open = true;
  private commandRecorded = false;
  private validated: number | null | undefined;

  private constructor(
    private readonly store: LocalMetadataStore,
    private readonly actor: ActorContext,
    private readonly deviceId: string,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly revision: LocalEntity | null,
    private readonly readProjection: boolean,
  ) {}

  static async begin(
    store: LocalMetadataStore,
    actor: ActorContext,
    deviceId: string,
    clock: Clock,
    ids: IdGenerator,
    readProjection = false,
  ) {
    if (!actor.workspaceId || !actor.principalId || !deviceId)
      throw new DomainError("VALIDATION_ERROR");
    const revision = await store.get(
      actor.workspaceId,
      "$local.workspace",
      "revision",
    );
    return new LocalMutationTransaction(
      store,
      { ...actor },
      deviceId,
      clock,
      ids,
      revision,
      readProjection,
    );
  }

  private assertOpen() {
    if (!this.open) throw new Error("LOCAL_TRANSACTION_CLOSED");
  }

  detachResult<T>(value: T): T {
    this.assertOpen();
    return this.readProjection && this.store.detachedReads && !this.writes.size
      ? value
      : structuredClone(value);
  }

  validatedRevision(): number | null {
    if (this.validated === undefined)
      throw new Error("LOCAL_TRANSACTION_NOT_VALIDATED");
    return this.validated;
  }

  private key(collection: string, id: string) {
    return JSON.stringify([collection, id]);
  }

  async get(collection: string, id: string): Promise<LocalEntity | null> {
    this.assertOpen();
    const key = this.key(collection, id);
    const pending = this.writes.get(key) ?? this.records.get(key);
    const value =
      pending?.entity ??
      (await this.store.get(this.actor.workspaceId, collection, id));
    this.assertOpen();
    return structuredClone(value);
  }

  async list(collection: string): Promise<readonly LocalEntity[]> {
    this.assertOpen();
    let read = this.collectionReads.get(collection);
    if (!read) {
      read = this.store.list(this.actor.workspaceId, collection);
      this.collectionReads.set(collection, read);
    }
    const durable = await read;
    this.assertOpen();
    if (this.readProjection && !this.writes.size && !this.records.size)
      return durable;
    const values = new Map(durable.map((value) => [value.id, value]));
    for (const { entity } of [
      ...this.writes.values(),
      ...this.records.values(),
    ])
      if (entity.collection === collection) values.set(entity.id, entity);
    // Only the snapshot projection borrows these values. Its enclosing unit
    // detaches the final result before commit; no borrowed value may escape it.
    return this.readProjection
      ? [...values.values()]
      : structuredClone([...values.values()]);
  }

  async readCanonicalWikiLinks(sourceIds: readonly string[]) {
    this.assertOpen();
    if (!this.readProjection || !this.store.readCanonicalWikiLinks)
      return undefined;
    const sources = new Set(sourceIds);
    const links = await this.store.readCanonicalWikiLinks(
      this.actor.workspaceId,
      sourceIds,
    );
    this.assertOpen();
    return links.map((link) => requireProjectedWikiLink(link, sources));
  }

  async validateLibraryBodyAvailability(
    checks: Parameters<
      NonNullable<LocalMetadataStore["validateLibraryBodyAvailability"]>
    >[1],
  ) {
    this.assertOpen();
    if (!this.readProjection || !this.store.validateLibraryBodyAvailability)
      return undefined;
    const values = await this.store.validateLibraryBodyAvailability(
      this.actor.workspaceId,
      checks,
    );
    this.assertOpen();
    if (
      values.length !== checks.length ||
      values.some((value) => typeof value !== "boolean")
    )
      throw new Error("LOCAL_DATA_CORRUPT");
    return values;
  }

  async getMany(refs: readonly { collection: string; id: string }[]) {
    this.assertOpen();
    const captured = structuredClone(refs);
    const result: (LocalEntity | null)[] = [];
    for (let offset = 0; offset < captured.length; offset += 32) {
      const batch = captured.slice(offset, offset + 32);
      const values = this.store.getMany
        ? await this.store.getMany(this.actor.workspaceId, batch)
        : await Promise.all(
            batch.map((ref) =>
              this.store.get(this.actor.workspaceId, ref.collection, ref.id),
            ),
          );
      this.assertOpen();
      if (values.length !== batch.length) throw new Error("LOCAL_DATA_CORRUPT");
      for (const [index, ref] of batch.entries()) {
        const value = values[index];
        if (
          value &&
          (value.workspaceId !== this.actor.workspaceId ||
            value.collection !== ref.collection ||
            value.id !== ref.id)
        )
          throw new Error("LOCAL_DATA_CORRUPT");
        const key = this.key(ref.collection, ref.id);
        const selected =
          (this.writes.get(key) ?? this.records.get(key))?.entity ??
          value ??
          null;
        result.push(this.readProjection ? selected : structuredClone(selected));
      }
    }
    return result;
  }

  async searchCandidates(
    collection: string,
    gram: string,
  ): Promise<readonly LocalEntity[]> {
    this.assertOpen();
    if (!this.store.searchCandidates)
      throw new Error("LOCAL_SEARCH_INDEX_PORT_INCOMPLETE");
    const values = new Map(
      (
        await this.store.searchCandidates(
          this.actor.workspaceId,
          collection,
          gram,
        )
      ).map((value) => [value.id, value]),
    );
    this.assertOpen();
    // Pending writes override index candidates; the caller verifies full text.
    for (const { entity } of [
      ...this.writes.values(),
      ...this.records.values(),
    ])
      if (entity.collection === collection) values.set(entity.id, entity);
    return structuredClone([...values.values()]);
  }

  stage(
    entity: LocalEntity,
    expectedVersion: number | null,
    operation: LocalMutation["operation"],
    payload: LocalJson,
    basePayload?: LocalJson,
  ) {
    this.assertOpen();
    if (this.readProjection) throw new DomainError("FORBIDDEN");
    if (this.commandRecorded) throw new DomainError("VALIDATION_ERROR");
    if (
      entity.workspaceId !== this.actor.workspaceId ||
      entity.collection.startsWith("$local.")
    )
      throw new DomainError("FORBIDDEN");
    const key = this.key(entity.collection, entity.id);
    const previous = this.writes.get(key);
    if (previous && previous.entity.version !== expectedVersion)
      throw new DomainError("VERSION_CONFLICT");
    const write: LocalWrite = structuredClone({
      entity,
      expectedVersion,
      mutation: {
        ...(basePayload === undefined ? {} : { basePayload }),
        order: {
          transactionVersion: (this.revision?.version ?? 0) + 1,
          operationIndex: this.writeSequence.length,
        },
        id: this.ids.next(),
        deviceId: this.deviceId,
        workspaceId: this.actor.workspaceId,
        principalId: this.actor.principalId,
        operation,
        entityType: entity.collection,
        entityId: entity.id,
        baseVersion: expectedVersion,
        payload,
        createdAt: this.clock.now(),
        attemptCount: 0,
        lastAttemptAt: null,
        state: "PENDING",
      },
    });
    this.writes.set(key, write);
    this.writeSequence.push(write);
  }

  stageInternal(entity: LocalEntity, expectedVersion: number | null) {
    this.assertOpen();
    if (this.readProjection && entity.collection !== "$local.wikiSources")
      throw new DomainError("FORBIDDEN");
    if (
      entity.workspaceId !== this.actor.workspaceId ||
      !entity.collection.startsWith("$local.") ||
      entity.collection === "$local.workspace"
    )
      throw new DomainError("FORBIDDEN");
    const key = this.key(entity.collection, entity.id);
    const previous = this.records.get(key);
    if (previous && previous.entity.version !== expectedVersion)
      throw new DomainError("VERSION_CONFLICT");
    const record = structuredClone({ entity, expectedVersion });
    this.records.set(key, record);
    this.recordSequence.push(record);
  }

  recordCommand(intent: LocalCommandIntent) {
    this.assertOpen();
    if (this.commandRecorded || !localWorkCommandNames.includes(intent.name))
      throw new DomainError("VALIDATION_ERROR");
    this.commandRecorded = true;
    if (!this.writeSequence.length) return;
    const id = this.writeSequence[0]!.mutation.id;
    const value = localDto({
      id,
      schemaVersion: 1,
      workspaceId: this.actor.workspaceId,
      principalId: this.actor.principalId,
      name: intent.name,
      input: intent.input,
      mutationIds: this.writeSequence.map((write) => write.mutation.id),
    });
    for (let index = 0; index < this.writeSequence.length; index++) {
      const previous = this.writeSequence[index]!;
      const next = {
        ...previous,
        mutation: { ...previous.mutation, commandId: id },
      };
      this.writeSequence[index] = next;
      this.writes.set(this.key(next.entity.collection, next.entity.id), next);
    }
    this.stageInternal(
      {
        workspaceId: this.actor.workspaceId,
        collection: "$local.command",
        id,
        version: 1,
        value,
      },
      null,
    );
  }

  async commit() {
    this.assertOpen();
    this.open = false;
    if (!this.writes.size && !this.records.size) {
      const current = await this.store.get(
        this.actor.workspaceId,
        "$local.workspace",
        "revision",
      );
      if ((current?.version ?? null) !== (this.revision?.version ?? null))
        throw new LocalReadSnapshotChangedError();
      this.validated = current?.version ?? null;
      return;
    }
    const version = (this.revision?.version ?? 0) + 1;
    const records: LocalRecordWrite[] = [
      {
        entity: {
          workspaceId: this.actor.workspaceId,
          collection: "$local.workspace",
          id: "revision",
          version,
          value: { revision: version },
        },
        expectedVersion: this.revision?.version ?? null,
      },
      ...this.recordSequence,
    ];
    if (!this.writes.size) {
      if (
        !this.store.repairWikiIndex ||
        this.recordSequence.some(
          (value) => value.entity.collection !== "$local.wikiSources",
        )
      )
        throw new DomainError("VALIDATION_ERROR");
      await this.store.repairWikiIndex(
        this.actor.workspaceId,
        this.actor.principalId,
        records,
      );
    } else {
      await this.store.commit(
        this.actor.workspaceId,
        this.actor.principalId,
        this.writeSequence,
        records,
      );
    }
    this.validated = version;
  }

  abort() {
    this.open = false;
    this.validated = undefined;
    this.writes.clear();
    this.records.clear();
    this.writeSequence.length = 0;
    this.recordSequence.length = 0;
    this.collectionReads.clear();
  }
}
