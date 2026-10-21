import {
  DomainError,
  validateCalendarRule,
  type WorkItem,
} from "@arclattice/domain";
import type { UnitOfWork, WorkTransaction } from "./index";
import { requireStableUuid } from "./mutation-receipt";
import type { WorkflowRecord } from "./workflows";

export interface RecurrenceReplayEffect {
  readonly collection: "items" | "workflows";
  readonly id: string;
  readonly op: "UPSERT";
  readonly baseVersion: number;
}
export interface CanonicalRecurrenceReplayEffect {
  readonly collection: RecurrenceReplayEffect["collection"];
  readonly id: string;
  readonly op: "UPSERT";
  readonly version: number;
  readonly value: WorkItem | WorkflowRecord;
}
export function requireRecurrenceCreationId(
  collection: string,
  id: string,
): string {
  if (collection === "workflows" && id.startsWith("occurrence:")) {
    const match = /^occurrence:([^:]+):(\d{4}-\d{2}-\d{2})$/.exec(id);
    if (!match)
      throw new DomainError("VALIDATION_ERROR", { field: "effect.id" });
    requireStableUuid(match[1], "definitionId");
    validateCalendarRule({
      startDate: match[2]!,
      timezone: "UTC",
      frequency: "DAILY",
      interval: 1,
    });
    return id;
  }
  return requireStableUuid(id, "effect.id");
}

/** Guards ordinary lifecycle execution; the delegate owns business/receipt atomicity. */
export class RecurrenceReplayUnitOfWork implements UnitOfWork {
  private readonly effects: readonly RecurrenceReplayEffect[];
  private canonical: readonly CanonicalRecurrenceReplayEffect[] = [];
  get acceptedEffects(): readonly CanonicalRecurrenceReplayEffect[] {
    return structuredClone(this.canonical);
  }
  constructor(
    private readonly delegate: UnitOfWork,
    private readonly workspaceId: string,
    private readonly principalId: string,
    effects: readonly RecurrenceReplayEffect[],
  ) {
    this.effects = structuredClone(effects);
    const versions = new Map<string, number>();
    if (
      !workspaceId ||
      !principalId ||
      !effects.length ||
      effects.length > 2000
    )
      throw new DomainError("VALIDATION_ERROR", { field: "effects" });
    for (const effect of this.effects) {
      const key = JSON.stringify([effect.collection, effect.id]);
      if (
        !["items", "workflows"].includes(effect.collection) ||
        effect.op !== "UPSERT" ||
        !effect.id ||
        effect.id.length > 240 ||
        !Number.isSafeInteger(effect.baseVersion) ||
        effect.baseVersion < 0 ||
        (versions.has(key) && versions.get(key) !== effect.baseVersion)
      )
        throw new DomainError("VALIDATION_ERROR", { field: "effects" });
      versions.set(key, effect.baseVersion + 1);
    }
    if (!effects.some((effect) => effect.collection === "workflows"))
      throw new DomainError("VALIDATION_ERROR", { field: "effects" });
  }
  async run<T>(
    workspaceId: string,
    operation: (tx: WorkTransaction) => T | Promise<T>,
  ): Promise<T> {
    if (workspaceId !== this.workspaceId) throw new DomainError("FORBIDDEN");
    this.canonical = [];
    const outcome = await this.delegate.run(workspaceId, async (tx) => {
      const records = new Map(
        (await tx.workflows()).map((record) => [record.id, record]),
      );
      const items = new Map(
        (await tx.list(true)).map((item) => [item.id, item]),
      );
      const groups = new Map<string, RecurrenceReplayEffect[]>();
      const keyFor = (collection: string, id: string) =>
        JSON.stringify([collection, id]);
      for (const effect of this.effects) {
        const key = keyFor(effect.collection, effect.id),
          group = groups.get(key);
        if (group) group.push(effect);
        else {
          const existing =
            effect.collection === "items"
              ? items.get(effect.id)
              : records.get(effect.id);
          if (
            (existing?.version ?? 0) !== effect.baseVersion ||
            (existing && existing.workspaceId !== workspaceId)
          )
            throw new DomainError("VERSION_CONFLICT");
          groups.set(key, [effect]);
        }
      }
      let consumed = 0;
      const consume = (
        collection: RecurrenceReplayEffect["collection"],
        value: WorkItem | WorkflowRecord,
        baseVersion: number,
      ) => {
        const expected = groups.get(keyFor(collection, value.id))?.shift();
        if (
          !expected ||
          expected.baseVersion !== baseVersion ||
          value.version !== baseVersion + 1 ||
          value.workspaceId !== workspaceId ||
          value.updatedBy !== this.principalId ||
          (baseVersion === 0 && value.createdBy !== this.principalId) ||
          (collection === "workflows" &&
            "payload" in value &&
            value.payload.kind === "PLAN")
        )
          throw new DomainError("VERSION_CONFLICT");
        consumed++;
      };
      const guarded = new Proxy(tx, {
        get(target, property) {
          if (property === "saveWorkflow")
            return async (record: WorkflowRecord, version: number) => {
              consume("workflows", record, version);
              await target.saveWorkflow(record, version);
            };
          if (property === "insert")
            return async (item: WorkItem) => {
              consume("items", item, 0);
              await target.insert(item);
            };
          if (property === "replace")
            return async (item: WorkItem, version: number) => {
              consume("items", item, version);
              await target.replace(item, version);
            };
          if (
            property === "purge" ||
            property === "addEdge" ||
            property === "removeEdge" ||
            property === "appendCategoryChange" ||
            (typeof property === "string" && property.startsWith("save"))
          )
            return () => {
              throw new DomainError("VALIDATION_ERROR", {
                field: "replayCommand",
              });
            };
          const value: unknown = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const result = await operation(guarded);
      if (consumed !== this.effects.length)
        throw new DomainError("VERSION_CONFLICT");
      const final = new Map(
        this.effects.map((effect) => [
          keyFor(effect.collection, effect.id),
          effect,
        ]),
      );
      const workflows = new Map(
        (await tx.workflows()).map((record) => [record.id, record]),
      );
      const canonical: CanonicalRecurrenceReplayEffect[] = [];
      for (const effect of final.values()) {
        const value =
          effect.collection === "items"
            ? await tx.get(effect.id)
            : workflows.get(effect.id);
        if (
          !value ||
          value.workspaceId !== workspaceId ||
          value.id !== effect.id ||
          value.version !== effect.baseVersion + 1 ||
          value.updatedBy !== this.principalId
        )
          throw new DomainError("VERSION_CONFLICT");
        canonical.push({
          collection: effect.collection,
          id: effect.id,
          op: "UPSERT",
          version: value.version,
          value,
        });
      }
      return { result, canonical };
    });
    this.canonical = structuredClone(outcome.canonical);
    return outcome.result;
  }
}
