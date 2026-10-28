import { DomainError } from "@arclattice/domain";
import { stableUuidPattern } from "./mutation-receipt";
import type { Organization, OrganizationStore } from "./organization";

export interface OrganizationReplayEffect {
  readonly collection: "organization";
  readonly id: string;
  readonly op: "UPSERT";
  readonly baseVersion: number;
}
export interface CanonicalOrganizationReplayEffect {
  readonly collection: "organization";
  readonly id: string;
  readonly op: "UPSERT";
  readonly version: number;
  readonly value: Organization;
}
const stableFolderId = new RegExp(stableUuidPattern);
function validOptionalIdentity(value: unknown): boolean {
  return (
    value === undefined ||
    value === "" ||
    (typeof value === "string" &&
      value.length <= 240 &&
      stableFolderId.test(value))
  );
}
function validIcon(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "string" &&
      (value === "" || value.trim() !== "") &&
      [...value].length <= 16 &&
      !/[\x00-\x1f]/.test(value))
  );
}
/**
 * Canonical rows carry the same shape the service writes: WORK keeps only the
 * legacy label, NOTE may reference a stable folder, FOLDER owns name/parentId.
 */
export function requireCanonicalOrganization(
  input: unknown,
  id: string,
  workspaceId: string,
  version: number,
): Organization {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new DomainError("VALIDATION_ERROR");
  const value = input as Organization;
  const kindValid = ["WORK", "NOTE", "FOLDER"].includes(value.kind);
  const folderShapeValid =
    value.kind === "FOLDER"
      ? typeof value.name === "string" &&
        value.name === value.name.trim() &&
        value.name.length > 0 &&
        value.name.length <= 80 &&
        !/[\x00-\x1f]/.test(value.name) &&
        typeof value.parentId === "string" &&
        value.parentId.length <= 240 &&
        !/[\x00-\x1f]/.test(value.parentId) &&
        (value.parentId === "" || stableFolderId.test(value.parentId)) &&
        value.folderId === undefined &&
        validIcon(value.icon)
      : value.kind === "NOTE"
        ? value.name === undefined &&
          value.parentId === undefined &&
          validOptionalIdentity(value.folderId) &&
          validIcon(value.icon)
        : value.name === undefined &&
          value.parentId === undefined &&
          value.folderId === undefined &&
          value.icon === undefined;
  if (
    !kindValid ||
    !folderShapeValid ||
    typeof value.id !== "string" ||
    !value.id ||
    `${value.kind}:${value.id}` !== id ||
    value.workspaceId !== workspaceId ||
    value.version !== version ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    typeof value.archived !== "boolean" ||
    typeof value.folder !== "string" ||
    value.folder.length > 80 ||
    value.folder.trim() !== value.folder ||
    /[\x00-\x1f]/.test(value.folder) ||
    typeof value.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(value.updatedAt)) ||
    typeof value.updatedBy !== "string" ||
    !value.updatedBy
  )
    throw new DomainError("VALIDATION_ERROR", {
      field: "canonicalOrganization",
    });
  return structuredClone(value);
}

/** The host must enclose apply and finish in the same business/receipt transaction. */
export class OrganizationReplayStore implements OrganizationStore {
  private readonly effects: readonly OrganizationReplayEffect[];
  private readonly consumed = new Set<string>();
  private canonical: readonly CanonicalOrganizationReplayEffect[] = [];
  get acceptedEffects() {
    return structuredClone(this.canonical);
  }
  constructor(
    private readonly delegate: OrganizationStore,
    private readonly workspaceId: string,
    private readonly principalId: string,
    effects: readonly OrganizationReplayEffect[],
  ) {
    this.effects = structuredClone(effects);
    if (
      !workspaceId ||
      !principalId ||
      !effects.length ||
      effects.length > 100 ||
      new Set(effects.map((effect) => effect.id)).size !== effects.length ||
      effects.some(
        (effect) =>
          effect.collection !== "organization" ||
          effect.op !== "UPSERT" ||
          !/^(WORK|NOTE|FOLDER):.+$/.test(effect.id) ||
          !Number.isSafeInteger(effect.baseVersion) ||
          effect.baseVersion < 0,
      )
    )
      throw new DomainError("VALIDATION_ERROR", {
        field: "organizationEffects",
      });
  }
  async list() {
    return structuredClone(await this.delegate.list());
  }
  async save(value: Organization, expectedVersion: number) {
    const id = `${value.kind}:${value.id}`;
    const effect = this.effects.find((entry) => entry.id === id);
    if (
      !effect ||
      this.consumed.has(id) ||
      effect.baseVersion !== expectedVersion
    )
      throw new DomainError("VERSION_CONFLICT", {
        field: "organizationEffects",
      });
    const captured = requireCanonicalOrganization(
      value,
      id,
      this.workspaceId,
      expectedVersion + 1,
    );
    if (captured.updatedBy !== this.principalId)
      throw new DomainError("FORBIDDEN");
    const previous = (await this.delegate.list()).find(
      (entry) => entry.kind === value.kind && entry.id === value.id,
    );
    if ((previous?.version ?? 0) !== expectedVersion)
      throw new DomainError("VERSION_CONFLICT");
    await this.delegate.save(captured, expectedVersion);
    this.consumed.add(id);
  }
  async finish() {
    if (this.consumed.size !== this.effects.length)
      throw new DomainError("VERSION_CONFLICT", {
        field: "organizationEffects",
      });
    const current = await this.delegate.list();
    this.canonical = this.effects.map((effect) => ({
      collection: "organization",
      id: effect.id,
      op: "UPSERT",
      version: effect.baseVersion + 1,
      value: requireCanonicalOrganization(
        current.find((entry) => `${entry.kind}:${entry.id}` === effect.id),
        effect.id,
        this.workspaceId,
        effect.baseVersion + 1,
      ),
    }));
  }
}
