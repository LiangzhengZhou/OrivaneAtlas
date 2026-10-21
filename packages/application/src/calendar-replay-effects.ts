import { DomainError, requireCalendarTimezone } from "@arclattice/domain";
import type { CalendarSettings, UnitOfWork, WorkTransaction } from "./index";

export interface CalendarReplayEffect {
  readonly collection: "calendarSettings";
  readonly id: "workspace";
  readonly op: "UPSERT";
  readonly baseVersion: number;
}
export interface CanonicalCalendarReplayEffect {
  readonly collection: "calendarSettings";
  readonly id: "workspace";
  readonly op: "UPSERT";
  readonly version: number;
  readonly value: CalendarSettings;
}
export function requireCanonicalCalendarSettings(
  input: unknown,
  version: number,
): CalendarSettings {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new DomainError("VALIDATION_ERROR");
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).some((key) => !["version", "timezone"].includes(key)) ||
    value.version !== version ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    (value.timezone !== null && typeof value.timezone !== "string")
  )
    throw new DomainError("VALIDATION_ERROR", { field: "calendarSettings" });
  return {
    version,
    timezone:
      value.timezone === null
        ? null
        : requireCalendarTimezone(value.timezone as string),
  };
}
/** Caller supplies the authenticated business/receipt transaction. */
export class CalendarReplayUnitOfWork implements UnitOfWork {
  private readonly effect: CalendarReplayEffect;
  private canonical: readonly CanonicalCalendarReplayEffect[] = [];
  get acceptedEffects(): readonly CanonicalCalendarReplayEffect[] {
    return structuredClone(this.canonical);
  }
  constructor(
    private readonly delegate: UnitOfWork,
    private readonly workspaceId: string,
    effects: readonly CalendarReplayEffect[],
  ) {
    const effect = effects[0];
    if (
      effects.length !== 1 ||
      !effect ||
      effect.collection !== "calendarSettings" ||
      effect.id !== "workspace" ||
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
      if ((await tx.calendarSettings()).version !== effect.baseVersion)
        throw new DomainError("VERSION_CONFLICT");
      let consumed = false;
      const guarded = new Proxy(tx, {
        get(target, property) {
          if (property === "saveCalendarSettings")
            return async (value: CalendarSettings, expected: number) => {
              if (consumed || expected !== effect.baseVersion)
                throw new DomainError("VERSION_CONFLICT");
              requireCanonicalCalendarSettings(value, effect.baseVersion + 1);
              consumed = true;
              await target.saveCalendarSettings(value, expected);
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
      const result = await operation(guarded);
      if (!consumed) throw new DomainError("VERSION_CONFLICT");
      return {
        result,
        value: requireCanonicalCalendarSettings(
          await tx.calendarSettings(),
          effect.baseVersion + 1,
        ),
      };
    });
    this.canonical = [
      {
        collection: "calendarSettings",
        id: "workspace",
        op: "UPSERT",
        version: outcome.value.version,
        value: outcome.value,
      },
    ];
    return outcome.result;
  }
}
