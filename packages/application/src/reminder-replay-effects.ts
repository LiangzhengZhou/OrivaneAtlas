import { DomainError, type Reminder } from "@arclattice/domain";
import type { UnitOfWork, WorkTransaction } from "./index";

export interface ReminderReplayEffect {
  readonly collection: "reminders";
  readonly id: string;
  readonly op: "UPSERT";
  readonly baseVersion: number;
}
export interface CanonicalReminderReplayEffect {
  readonly collection: "reminders";
  readonly id: string;
  readonly op: "UPSERT";
  readonly version: number;
  readonly value: Reminder;
}

/** Runs ordinary Reminder rules inside the caller's business/receipt transaction. */
export class ReminderReplayUnitOfWork implements UnitOfWork {
  private readonly effect: ReminderReplayEffect;
  private canonical: readonly CanonicalReminderReplayEffect[] = [];
  get acceptedEffects(): readonly CanonicalReminderReplayEffect[] {
    return structuredClone(this.canonical);
  }
  constructor(
    private readonly delegate: UnitOfWork,
    private readonly workspaceId: string,
    effects: readonly ReminderReplayEffect[],
  ) {
    const effect = effects[0];
    if (
      effects.length !== 1 ||
      !effect ||
      effect.collection !== "reminders" ||
      effect.op !== "UPSERT" ||
      !effect.id ||
      effect.id.length > 240 ||
      !Number.isSafeInteger(effect.baseVersion) ||
      effect.baseVersion < 0
    )
      throw new DomainError("VALIDATION_ERROR", { field: "effects" });
    this.effect = structuredClone(effect);
  }
  async run<T>(
    workspaceId: string,
    operation: (tx: WorkTransaction) => T | Promise<T>,
  ): Promise<T> {
    if (workspaceId !== this.workspaceId) throw new DomainError("FORBIDDEN");
    this.canonical = [];
    const outcome = await this.delegate.run(workspaceId, async (tx) => {
      const old = (await tx.reminders()).find(
        (entry) => entry.id === this.effect.id,
      );
      if (
        (old?.version ?? 0) !== this.effect.baseVersion ||
        (old && old.workspaceId !== workspaceId)
      )
        throw new DomainError("VERSION_CONFLICT");
      let consumed = false;
      const effect = this.effect;
      const guarded = new Proxy(tx, {
        get(target, property) {
          if (property === "saveReminder")
            return async (value: Reminder, version: number) => {
              if (
                consumed ||
                value.id !== effect.id ||
                value.workspaceId !== workspaceId ||
                version !== effect.baseVersion ||
                value.version !== version + 1
              )
                throw new DomainError("VERSION_CONFLICT");
              consumed = true;
              await target.saveReminder(value, version);
            };
          if (
            [
              "insert",
              "replace",
              "purge",
              "addEdge",
              "removeEdge",
              "appendActivity",
              "appendOutbox",
              "appendCategoryChange",
            ].includes(String(property)) ||
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
      const value = (await tx.reminders()).find(
        (entry) => entry.id === effect.id,
      );
      if (
        !consumed ||
        !value ||
        value.workspaceId !== workspaceId ||
        value.version !== effect.baseVersion + 1
      )
        throw new DomainError("VERSION_CONFLICT");
      return { result, value };
    });
    this.canonical = [
      {
        collection: "reminders",
        id: this.effect.id,
        op: "UPSERT",
        version: outcome.value.version,
        value: structuredClone(outcome.value),
      },
    ];
    return outcome.result;
  }
}
