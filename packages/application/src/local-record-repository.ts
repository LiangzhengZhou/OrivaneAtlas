import { type ActorContext, DomainError } from "@arclattice/domain";
import type { EntityRef } from "./connected";
import type { Clock, IdGenerator } from "./index";
import { localDto, localObject } from "./local-dto";
import type { LocalMutationTransaction } from "./local-mutation-transaction";
import type { LocalEntity } from "./local-persistence";
import type { WorkspaceChange } from "./workspace-change-log";

/** Request-scoped versioned mapping, not a second implementation of business rules. */
export class LocalRecordRepository {
  constructor(
    private readonly stage: LocalMutationTransaction,
    private readonly actor: ActorContext,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly publish: (change: Omit<WorkspaceChange, "seq">) => void,
  ) {}

  private decode<T>(entity: LocalEntity): T {
    const value = localObject(entity.value);
    if (
      entity.workspaceId !== this.actor.workspaceId ||
      value.workspaceId !== this.actor.workspaceId ||
      value.version !== entity.version
    )
      throw new Error("LOCAL_DATA_CORRUPT");
    return structuredClone(value) as T;
  }

  async get<T>(collection: string, id: string): Promise<T> {
    const entity = await this.stage.get(collection, id);
    if (!entity || localObject(entity.value).localTombstone === true)
      throw new DomainError("NOT_FOUND");
    return this.decode<T>(entity);
  }

  async list<T>(collection: string): Promise<T[]> {
    const entities = (await this.stage.list(collection)).filter(
      (entity) => localObject(entity.value).localTombstone !== true,
    );
    return entities.map((entity) => this.decode<T>(entity));
  }

  async save(
    collection: string,
    id: string,
    value: unknown,
    expectedVersion: number,
    type: string,
  ) {
    const data = localObject(localDto(value));
    if (
      data.workspaceId !== this.actor.workspaceId ||
      data.updatedBy !== this.actor.principalId
    )
      throw new DomainError("FORBIDDEN");
    const old = await this.stage.get(collection, id);
    if (
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 0 ||
      (old?.version ?? 0) !== expectedVersion ||
      data.version !== expectedVersion + 1
    )
      throw new DomainError("VERSION_CONFLICT");
    this.stage.stage(
      {
        workspaceId: this.actor.workspaceId,
        collection,
        id,
        version: expectedVersion + 1,
        value: data,
      },
      old?.version ?? null,
      old ? "PATCH" : "CREATE",
      data,
      old?.value ?? null,
    );
    const activityId = this.ids.next();
    this.stage.stageInternal(
      {
        workspaceId: this.actor.workspaceId,
        collection: "$local." + collection + "Activity",
        id: activityId,
        version: 1,
        value: localDto({
          entityId: id,
          principalId: this.actor.principalId,
          version: expectedVersion + 1,
          type,
          occurredAt: this.clock.now(),
        }),
      },
      null,
    );
    this.publish({
      workspaceId: this.actor.workspaceId,
      collection,
      entityId: id,
      version: expectedVersion + 1,
      op: "UPSERT",
    });
  }

  async purgeRelations(ref: EntityRef) {
    const sameRef = (value: unknown) => {
      if (!value || typeof value !== "object" || Array.isArray(value))
        return false;
      const data = localObject(
        value as import("./local-persistence").LocalJson,
      );
      return data.kind === ref.kind && data.id === ref.id;
    };
    for (const collection of [
      "links",
      "organization",
      "projectMaterials",
      "entityMemos",
    ]) {
      for (const entity of await this.stage.list(collection)) {
        const data = localObject(entity.value);
        if (data.localTombstone === true) continue;
        const matches =
          collection === "entityMemos"
            ? data.targetId === ref.id &&
              (ref.kind === "FILE"
                ? data.targetKind === "FILE"
                : ref.kind === "WORK" &&
                  ["PROJECT", "TASK", "MILESTONE"].includes(
                    String(data.targetKind),
                  ))
            : collection === "links"
              ? sameRef(data.from) || sameRef(data.to)
              : collection === "organization"
                ? data.kind === ref.kind && data.id === ref.id
                : ref.kind === "WORK"
                  ? data.projectId === ref.id
                  : data.targetId === ref.id;
        if (!matches) continue;
        if (data.workspaceId !== this.actor.workspaceId)
          throw new DomainError("FORBIDDEN");
        const value = { localTombstone: true };
        this.stage.stage(
          { ...entity, version: entity.version + 1, value },
          entity.version,
          "DELETE",
          value,
          entity.value,
        );
        this.publish({
          workspaceId: this.actor.workspaceId,
          collection,
          entityId: entity.id,
          op: "DELETE",
          version: entity.version + 1,
        });
      }
    }
  }
}
