import {
  DomainError,
  type NavigationPreference,
  requireNavigationPreference,
} from "@arclattice/domain";
import type { UnitOfWork, WorkTransaction } from "./index";

export interface NavigationReplayEffect {
  readonly collection: "navigationPreference";
  readonly id: string;
  readonly op: "UPSERT";
  readonly baseVersion: number;
}
export interface CanonicalNavigationReplayEffect {
  readonly collection: "navigationPreference";
  readonly id: string;
  readonly op: "UPSERT";
  readonly version: number;
  readonly value: NavigationPreference;
}
export function requireCanonicalNavigationPreference(
  input: unknown,
  version: number,
): NavigationPreference {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new DomainError("VALIDATION_ERROR");
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).some(
      (key) => !["version", "desktop", "mobile"].includes(key),
    ) ||
    value.version !== version ||
    !Number.isSafeInteger(version) ||
    version < 1
  )
    throw new DomainError("VALIDATION_ERROR", {
      field: "navigationPreference",
    });
  for (const [name, keys] of [
    ["desktop", ["order", "hidden", "pinned"]],
    ["mobile", ["pinned"]],
  ] as const) {
    const section = value[name];
    if (
      !section ||
      typeof section !== "object" ||
      Array.isArray(section) ||
      Object.keys(section).some(
        (key) => !(keys as readonly string[]).includes(key),
      )
    )
      throw new DomainError("VALIDATION_ERROR", {
        field: "navigationPreference",
      });
  }
  requireNavigationPreference(input as NavigationPreference);
  return structuredClone(input as NavigationPreference);
}
/** Authenticated principal is explicit; the installation owner is never a remote target. */
export class NavigationReplayUnitOfWork implements UnitOfWork {
  private readonly effect: NavigationReplayEffect;
  private canonical: readonly CanonicalNavigationReplayEffect[] = [];
  get acceptedEffects(): readonly CanonicalNavigationReplayEffect[] {
    return structuredClone(this.canonical);
  }
  constructor(
    private readonly delegate: UnitOfWork,
    private readonly workspaceId: string,
    private readonly principalId: string,
    effects: readonly NavigationReplayEffect[],
  ) {
    const effect = effects[0];
    if (
      effects.length !== 1 ||
      !effect ||
      effect.collection !== "navigationPreference" ||
      effect.id !== principalId ||
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
    const effect = this.effect,
      principalId = this.principalId;
    const outcome = await this.delegate.run(workspaceId, async (tx) => {
      if (
        (await tx.navigationPreference(principalId)).version !==
        effect.baseVersion
      )
        throw new DomainError("VERSION_CONFLICT");
      let consumed = false;
      const guarded = new Proxy(tx, {
        get(target, property) {
          if (property === "saveNavigationPreference")
            return async (
              id: string,
              value: NavigationPreference,
              expected: number,
            ) => {
              if (
                consumed ||
                id !== principalId ||
                expected !== effect.baseVersion
              )
                throw new DomainError("VERSION_CONFLICT");
              requireCanonicalNavigationPreference(value, expected + 1);
              consumed = true;
              await target.saveNavigationPreference(id, value, expected);
            };
          if (property === "navigationPreference")
            return (id: string) => {
              if (id !== principalId) throw new DomainError("FORBIDDEN");
              return target.navigationPreference(id);
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
        value: requireCanonicalNavigationPreference(
          await tx.navigationPreference(principalId),
          effect.baseVersion + 1,
        ),
      };
    });
    this.canonical = [
      {
        collection: "navigationPreference",
        id: principalId,
        op: "UPSERT",
        version: outcome.value.version,
        value: outcome.value,
      },
    ];
    return outcome.result;
  }
}
