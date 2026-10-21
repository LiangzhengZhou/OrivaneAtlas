import { type ActorContext, DomainError } from "@arclattice/domain";
import type { Clock, IdGenerator } from "./index";
import type { LibraryEntry } from "./library";
import {
  LocalBodyUnavailableError,
  remoteBodyUnavailable,
} from "./local-body-availability";
import { localDto, localObject } from "./local-dto";
import type { LocalMutationTransaction } from "./local-mutation-transaction";
import type { LocalEntity } from "./local-persistence";
import { LocalRecordRepository } from "./local-record-repository";
import type { Note } from "./notebook";
import { type BodyManifest, bodyManifest } from "./workspace-bootstrap";
import type { WorkspaceChange } from "./workspace-change-log";

/** A request-scoped port, sharing the enclosing Work transaction and outbox. */
export class LocalMarkdownStore<T extends Note | LibraryEntry> {
  constructor(
    protected readonly stage: LocalMutationTransaction,
    protected readonly actor: ActorContext,
    protected readonly clock: Clock,
    protected readonly ids: IdGenerator,
    protected readonly publish: (change: Omit<WorkspaceChange, "seq">) => void,
    protected readonly collection: "notes" | "library",
    private readonly prefix: "note" | "library",
  ) {}

  private metadata(entity: LocalEntity): BodyManifest<T> {
    const value = localObject(entity.value);
    if (
      entity.workspaceId !== this.actor.workspaceId ||
      value.workspaceId !== this.actor.workspaceId ||
      value.id !== entity.id ||
      value.version !== entity.version ||
      value.bodyState !== "UNLOADED" ||
      "bodyMd" in value ||
      typeof value.title !== "string" ||
      !(
        this.collection === "notes"
          ? ["NOTE", "JOURNAL"]
          : ["SPACE", "DOCUMENT"]
      ).includes(String(value.kind)) ||
      typeof value.bodyCharacterCount !== "number"
    )
      throw new Error("LOCAL_DATA_CORRUPT");
    // stage.get/list already return detached entities owned by this caller.
    return value as unknown as BodyManifest<T>;
  }

  async listMetadata() {
    return (await this.stage.list(this.collection))
      .filter((entity) => localObject(entity.value).localTombstone !== true)
      .map((entity) => this.metadata(entity))
      .sort(
        (a, b) =>
          b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
      );
  }

  async getMetadata(id: string): Promise<BodyManifest<T>> {
    const entity = await this.stage.get(this.collection, id);
    if (!entity || localObject(entity.value).localTombstone === true)
      throw new DomainError("NOT_FOUND");
    return this.metadata(entity);
  }

  async get(id: string): Promise<T> {
    const entity = await this.stage.get(this.collection, id);
    if (!entity || localObject(entity.value).localTombstone === true)
      throw new DomainError("NOT_FOUND");
    const manifest = this.metadata(entity);
    if (await this.bodyUnavailable(entity))
      throw new LocalBodyUnavailableError(
        this.collection,
        id,
        manifest.version,
      );
    const body = await this.stage.get(`$local.${this.prefix}Body`, id);
    if (!body) throw new Error("LOCAL_DATA_CORRUPT");
    const value = localObject(body.value);
    if (
      value.noteVersion !== manifest.version ||
      typeof value.bodyMd !== "string"
    )
      throw new Error("LOCAL_DATA_CORRUPT");
    const {
      bodyState: _state,
      bodyCharacterCount: _count,
      ...metadata
    } = manifest;
    return { ...metadata, bodyMd: value.bodyMd } as unknown as T;
  }

  protected async bodyUnavailable(entity: LocalEntity): Promise<boolean> {
    const availability = await this.stage.get(
      `$local.${this.prefix}BodyAvailability`,
      entity.id,
    );
    if (!availability) return false;
    const state = localObject(availability.value);
    if (state.state !== "MISSING" || state.entityVersion !== entity.version)
      return false;
    return remoteBodyUnavailable(
      this.collection,
      entity,
      availability,
      await this.stage.get(
        "$local.remoteBase",
        JSON.stringify([this.collection, entity.id]),
      ),
    );
  }

  async list() {
    return Promise.all(
      (await this.listMetadata()).map((value) => this.get(value.id)),
    );
  }

  private async internal(collection: string, id: string, value: unknown) {
    const old = await this.stage.get(collection, id);
    this.stage.stageInternal(
      {
        workspaceId: this.actor.workspaceId,
        collection,
        id,
        version: (old?.version ?? 0) + 1,
        value: localDto(value),
      },
      old?.version ?? null,
    );
  }

  async save(note: T, expectedVersion: number) {
    if (
      note.workspaceId !== this.actor.workspaceId ||
      note.updatedBy !== this.actor.principalId
    )
      throw new DomainError("FORBIDDEN");
    const old = await this.stage.get(this.collection, note.id);
    if (
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 0 ||
      (old?.version ?? 0) !== expectedVersion ||
      note.version !== expectedVersion + 1
    )
      throw new DomainError("VERSION_CONFLICT");
    const manifest = localDto(bodyManifest(note));
    this.stage.stage(
      {
        workspaceId: note.workspaceId,
        collection: this.collection,
        id: note.id,
        version: note.version,
        value: manifest,
      },
      old?.version ?? null,
      old ? "PATCH" : "CREATE",
      localDto(note),
      old ? localDto(await this.get(note.id)) : null,
    );
    await this.internal(`$local.${this.prefix}Body`, note.id, {
      noteVersion: note.version,
      bodyMd: note.bodyMd,
    });
    await this.internal(
      `$local.${this.prefix}Revision`,
      JSON.stringify([note.id, note.version]),
      note,
    );
    await this.internal(`$local.${this.prefix}Search`, note.id, {
      text: (note.title + "\n" + note.bodyMd)
        .normalize("NFKC")
        .toLocaleLowerCase(),
      deletedAt: note.deletedAt,
    });
    await this.internal(`$local.${this.prefix}Activity`, this.ids.next(), {
      entityId: note.id,
      principalId: this.actor.principalId,
      version: note.version,
      type: this.collection === "notes" ? "NOTE_CHANGED" : "LIBRARY_CHANGED",
      occurredAt: note.updatedAt,
    });
    this.publish({
      workspaceId: note.workspaceId,
      collection: this.collection,
      entityId: note.id,
      op: "UPSERT",
      version: note.version,
    });
  }

  async revisions(id: string): Promise<T[]> {
    await this.get(id);
    return (await this.stage.list(`$local.${this.prefix}Revision`))
      .map((entity) => localObject(entity.value))
      .filter(
        (value) =>
          value.id === id &&
          value.workspaceId === this.actor.workspaceId &&
          typeof value.bodyMd === "string",
      )
      .map((value) => structuredClone(value) as unknown as T)
      .sort((a, b) => b.version - a.version);
  }

  async searchIds(query: string) {
    const normalized = query.trim().normalize("NFKC").toLocaleLowerCase();
    if (!normalized || normalized.length > 1000) return [];
    const gram = Array.from(normalized).slice(0, 3).join("");
    return (
      await this.stage.searchCandidates(`$local.${this.prefix}Search`, gram)
    )
      .filter((entity) => {
        const value = localObject(entity.value);
        return (
          value.deletedAt === null &&
          typeof value.text === "string" &&
          value.text.includes(normalized)
        );
      })
      .map((entity) => entity.id);
  }

  async purge(id: string, expectedVersion: number) {
    const note = await this.get(id);
    if (note.version !== expectedVersion)
      throw new DomainError("VERSION_CONFLICT");
    if (!note.deletedAt) throw new DomainError("VALIDATION_ERROR");
    await new LocalRecordRepository(
      this.stage,
      this.actor,
      this.clock,
      this.ids,
      this.publish,
    ).purgeRelations({
      kind:
        this.collection === "notes"
          ? "NOTE"
          : note.kind === "SPACE"
            ? "SPACE"
            : "DOCUMENT",
      id,
    });
    const value = { localTombstone: true };
    this.stage.stage(
      {
        workspaceId: this.actor.workspaceId,
        collection: this.collection,
        id,
        version: expectedVersion + 1,
        value,
      },
      expectedVersion,
      "DELETE",
      value,
      localDto(note),
    );
    for (const collection of [
      `$local.${this.prefix}Body`,
      `$local.${this.prefix}Search`,
    ])
      await this.internal(collection, id, value);
    for (const entity of await this.stage.list(`$local.${this.prefix}Revision`))
      if (localObject(entity.value).id === id)
        await this.internal(`$local.${this.prefix}Revision`, entity.id, value);
    await this.internal(`$local.${this.prefix}Activity`, this.ids.next(), {
      entityId: id,
      principalId: this.actor.principalId,
      version: expectedVersion + 1,
      type: this.collection === "notes" ? "NOTE_PURGED" : "LIBRARY_PURGED",
      occurredAt: this.clock.now(),
    });
    this.publish({
      workspaceId: this.actor.workspaceId,
      collection: this.collection,
      entityId: id,
      op: "DELETE",
      version: expectedVersion + 1,
    });
  }
}
