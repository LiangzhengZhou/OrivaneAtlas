import { DomainError, type WorkEdge, type WorkItem } from "@arclattice/domain";
import type { CategoryChange, ProjectCategory } from "./categories";
import { requireCanonicalCategory } from "./category-replay-effects";
import type { UnitOfWork, WorkTransaction } from "./index";
import { validateLocalCanonicalWorkValue } from "./local-canonical-work";
import { validateLocalCanonicalWorkflowValue } from "./local-canonical-workflow";
import { localDto } from "./local-dto";
import { requireStableUuid } from "./mutation-receipt";
import type { WorkflowRecord } from "./workflows";

export interface PlanReplayEffect {
  readonly collection: "items" | "edges" | "categories" | "workflows";
  readonly id: string;
  readonly op: "UPSERT";
  readonly baseVersion: number;
}
type Value = WorkItem | WorkEdge | ProjectCategory | WorkflowRecord;
export interface CanonicalPlanReplayEffect {
  readonly collection: PlanReplayEffect["collection"];
  readonly id: string;
  readonly op: "UPSERT";
  readonly version: number;
  readonly value: Value;
}
/** Explicit PLAN boundary. Ordinary Application services retain all business rules. */
export class PlanReplayUnitOfWork implements UnitOfWork {
  private readonly effects: readonly PlanReplayEffect[];
  private canonical: readonly CanonicalPlanReplayEffect[] = [];
  private activeTransaction: WorkTransaction | undefined;
  get acceptedEffects() {
    return structuredClone(this.canonical);
  }
  constructor(
    private readonly delegate: UnitOfWork,
    private readonly workspaceId: string,
    private readonly principalId: string,
    effects: readonly PlanReplayEffect[],
  ) {
    this.effects = structuredClone(effects);
    if (
      !workspaceId ||
      !principalId ||
      !effects.length ||
      effects.length > 2000 ||
      !effects.some((e) => e.collection === "workflows")
    )
      throw new DomainError("VALIDATION_ERROR", { field: "planEffects" });
    const versions = new Map<string, number>();
    for (const e of this.effects) {
      const key = JSON.stringify([e.collection, e.id]),
        previous = versions.get(key);
      if (
        !["items", "edges", "categories", "workflows"].includes(e.collection) ||
        e.op !== "UPSERT" ||
        !e.id ||
        e.id.length > 240 ||
        !Number.isSafeInteger(e.baseVersion) ||
        e.baseVersion < 0 ||
        (e.collection === "edges" &&
          (e.baseVersion !== 0 || previous !== undefined)) ||
        (previous !== undefined && previous !== e.baseVersion)
      )
        throw new DomainError("VALIDATION_ERROR", { field: "planEffects" });
      if (!e.baseVersion) requireStableUuid(e.id, "effect.id");
      versions.set(key, e.baseVersion + 1);
    }
  }
  async run<T>(
    workspaceId: string,
    operation: (tx: WorkTransaction) => T | Promise<T>,
  ): Promise<T> {
    if (workspaceId !== this.workspaceId) throw new DomainError("FORBIDDEN");
    // Nested Application reads/writes belong to the same original effect group.
    // Only the outer operation checks and finalizes its complete receipt.
    if (this.activeTransaction) return operation(this.activeTransaction);
    this.canonical = [];
    const outcome = await this.delegate.run(workspaceId, async (tx) => {
      const maps: Record<PlanReplayEffect["collection"], Map<string, Value>> = {
        items: new Map((await tx.list(true)).map((v) => [v.id, v])),
        edges: new Map((await tx.edges()).map((v) => [v.id, v])),
        categories: new Map((await tx.categories()).map((v) => [v.id, v])),
        workflows: new Map((await tx.workflows()).map((v) => [v.id, v])),
      };
      const keyFor = (collection: string, id: string) =>
        JSON.stringify([collection, id]);
      const groups = new Map<string, PlanReplayEffect[]>();
      for (const e of this.effects) {
        const key = keyFor(e.collection, e.id),
          existing = maps[e.collection].get(e.id),
          group = groups.get(key);
        if (group) group.push(e);
        else {
          const version = existing
            ? "version" in existing
              ? existing.version
              : 1
            : 0;
          if (
            version !== e.baseVersion ||
            (existing && existing.workspaceId !== workspaceId)
          )
            throw new DomainError("VERSION_CONFLICT");
          groups.set(key, [e]);
        }
      }
      let consumed = 0;
      const categoryEvents = new Set<string>();
      const validate = (
        collection: PlanReplayEffect["collection"],
        value: Value,
        version: number,
      ) => {
        const json = localDto(value);
        if (collection === "workflows")
          validateLocalCanonicalWorkflowValue(
            value.id,
            workspaceId,
            version,
            json,
          );
        else if (collection === "categories")
          requireCanonicalCategory(json, value.id, workspaceId, version);
        else
          validateLocalCanonicalWorkValue(
            collection,
            value.id,
            workspaceId,
            version,
            json,
          );
        if (
          value.createdBy === undefined ||
          ("updatedBy" in value
            ? value.updatedBy !== this.principalId
            : value.createdBy !== this.principalId)
        )
          throw new DomainError("FORBIDDEN");
      };
      const consume = (
        collection: PlanReplayEffect["collection"],
        value: Value,
        base: number,
      ) => {
        const expected = groups.get(keyFor(collection, value.id))?.shift();
        if (
          !expected ||
          expected.baseVersion !== base ||
          (base === 0 && value.createdBy !== this.principalId)
        )
          throw new DomainError("VERSION_CONFLICT");
        validate(collection, value, base + 1);
        if (collection === "categories")
          categoryEvents.add(keyFor(value.id, String(base + 1)));
        consumed++;
      };
      const principalId = this.principalId;
      const guarded = new Proxy(tx, {
        get(target, property) {
          if (property === "insert")
            return async (v: WorkItem) => {
              consume("items", v, 0);
              await target.insert(v);
            };
          if (property === "replace")
            return async (v: WorkItem, base: number) => {
              consume("items", v, base);
              await target.replace(v, base);
            };
          if (property === "addEdge")
            return async (v: WorkEdge) => {
              consume("edges", v, 0);
              await target.addEdge(v);
            };
          if (property === "saveWorkflow")
            return async (v: WorkflowRecord, base: number) => {
              consume("workflows", v, base);
              await target.saveWorkflow(v, base);
            };
          if (property === "saveCategory")
            return async (v: ProjectCategory, base: number) => {
              consume("categories", v, base);
              await target.saveCategory(v, base);
            };
          if (property === "appendCategoryChange")
            return async (event: CategoryChange) => {
              if (
                event.workspaceId !== workspaceId ||
                event.principalId !== principalId ||
                !categoryEvents.delete(
                  keyFor(event.categoryId, String(event.version)),
                )
              )
                throw new DomainError("VERSION_CONFLICT");
              await target.appendCategoryChange(event);
            };
          if (
            property === "purge" ||
            property === "removeEdge" ||
            (typeof property === "string" && property.startsWith("save"))
          )
            return () => {
              throw new DomainError("VALIDATION_ERROR", {
                field: "undeclaredPlanEffect",
              });
            };
          const value: unknown = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      this.activeTransaction = guarded;
      let result: T;
      try {
        result = await operation(guarded);
      } finally {
        this.activeTransaction = undefined;
      }
      if (consumed !== this.effects.length || categoryEvents.size)
        throw new DomainError("VERSION_CONFLICT");
      const after = {
        items: new Map((await tx.list(true)).map((v) => [v.id, v])),
        edges: new Map((await tx.edges()).map((v) => [v.id, v])),
        categories: new Map((await tx.categories()).map((v) => [v.id, v])),
        workflows: new Map((await tx.workflows()).map((v) => [v.id, v])),
      };
      const final = new Map(
        this.effects.map((e) => [keyFor(e.collection, e.id), e]),
      );
      const canonical: CanonicalPlanReplayEffect[] = [];
      for (const e of final.values()) {
        const value = after[e.collection].get(e.id);
        if (!value) throw new DomainError("VERSION_CONFLICT");
        validate(e.collection, value, e.baseVersion + 1);
        canonical.push({
          collection: e.collection,
          id: e.id,
          op: "UPSERT",
          version: e.baseVersion + 1,
          value,
        });
      }
      return { result, canonical };
    });
    this.canonical = outcome.canonical;
    return outcome.result;
  }
}
