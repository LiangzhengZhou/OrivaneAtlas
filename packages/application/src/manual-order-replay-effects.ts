import {
  DomainError,
  type ManualOrderState,
  requireManualOrderState,
} from "@arclattice/domain";
import type { UnitOfWork, WorkTransaction } from "./index";

export interface ManualOrderReplayEffect {
  readonly collection: "manualOrders";
  readonly id: string;
  readonly op: "UPSERT";
  readonly baseVersion: number;
}
export interface CanonicalManualOrderReplayEffect {
  readonly collection: "manualOrders";
  readonly id: string;
  readonly op: "UPSERT";
  readonly version: number;
  readonly value: ManualOrderState;
}
export class ManualOrderReplayUnitOfWork implements UnitOfWork {
  private readonly effect: ManualOrderReplayEffect;
  private canonical: readonly CanonicalManualOrderReplayEffect[] = [];
  get acceptedEffects(): readonly CanonicalManualOrderReplayEffect[] {
    return structuredClone(this.canonical);
  }
  constructor(
    private readonly delegate: UnitOfWork,
    private readonly workspaceId: string,
    effects: readonly ManualOrderReplayEffect[],
  ) {
    const effect = effects[0];
    if (
      effects.length !== 1 ||
      !effect ||
      effect.collection !== "manualOrders" ||
      typeof effect.id !== "string" ||
      !effect.id ||
      effect.op !== "UPSERT" ||
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
    const effect = this.effect;
    const outcome = await this.delegate.run(workspaceId, async (tx) => {
      const previous = (await tx.manualOrders()).find(
        (state) => state.id === effect.id,
      );
      if ((previous?.version ?? 0) !== effect.baseVersion)
        throw new DomainError("VERSION_CONFLICT");
      let consumed = false;
      const guarded = new Proxy(tx, {
        get(target, property) {
          if (property === "saveManualOrder")
            return async (value: ManualOrderState, expected: number) => {
              const canonical = requireManualOrderState(value);
              if (
                consumed ||
                expected !== effect.baseVersion ||
                canonical.id !== effect.id ||
                canonical.workspaceId !== workspaceId ||
                canonical.version !== expected + 1
              )
                throw new DomainError("VERSION_CONFLICT");
              consumed = true;
              await target.saveManualOrder(canonical, expected);
            };
          if (
            [
              "insert",
              "replace",
              "purge",
              "addEdge",
              "removeEdge",
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
      const result = await operation(guarded),
        accepted = (await tx.manualOrders()).find(
          (state) => state.id === effect.id,
        );
      if (
        !consumed ||
        !accepted ||
        accepted.workspaceId !== workspaceId ||
        accepted.version !== effect.baseVersion + 1
      )
        throw new DomainError("VERSION_CONFLICT");
      return { result, value: requireManualOrderState(accepted) };
    });
    this.canonical = [
      {
        collection: "manualOrders",
        id: effect.id,
        op: "UPSERT",
        version: outcome.value.version,
        value: outcome.value,
      },
    ];
    return outcome.result;
  }
}
