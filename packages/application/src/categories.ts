import {
  type ActorContext,
  DomainError,
  requireTitle,
} from "@arclattice/domain";
import type {
  AuthorizationService,
  Clock,
  IdGenerator,
  UnitOfWork,
} from "./index";

export interface ProjectCategory {
  id: string;
  workspaceId: string;
  name: string;
  projectIds: string[];
  version: number;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
export interface CategoryChange {
  id: string;
  workspaceId: string;
  principalId: string;
  categoryId: string;
  version: number;
  occurredAt: string;
}
export class CategoryService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly authorization: AuthorizationService,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}
  async list(context: ActorContext) {
    await this.authorization.require(context, "work:read");
    return this.uow.run(context.workspaceId, (tx) => tx.categories());
  }
  async save(
    context: ActorContext,
    input: {
      id?: string;
      version: number;
      name: string;
      projectIds: string[];
      deleted: boolean;
    },
  ) {
    await this.authorization.require(
      context,
      input.deleted ? "work:delete" : input.id ? "work:update" : "work:create",
    );
    const name = requireTitle(input.name);
    if (
      !Number.isSafeInteger(input.version) ||
      input.version < 0 ||
      typeof input.deleted !== "boolean" ||
      !Array.isArray(input.projectIds) ||
      input.projectIds.length > 100 ||
      input.projectIds.some(
        (id) => typeof id !== "string" || !id || id.length > 240,
      ) ||
      new Set(input.projectIds).size !== input.projectIds.length ||
      (!input.id && (input.version !== 0 || input.deleted))
    )
      throw new DomainError("VALIDATION_ERROR");
    return this.uow.run(context.workspaceId, async (tx) => {
      const categories = await tx.categories();
      const old = input.id
        ? categories.find((c) => c.id === input.id)
        : undefined;
      if (input.id && !old) throw new DomainError("NOT_FOUND");
      if ((old?.version ?? 0) !== input.version)
        throw new DomainError("VERSION_CONFLICT");
      if (
        categories.some(
          (c) =>
            c.id !== input.id &&
            !c.deletedAt &&
            c.name.toLocaleLowerCase("en-US") ===
              name.toLocaleLowerCase("en-US"),
        ) &&
        !input.deleted
      )
        throw new DomainError("VALIDATION_ERROR");
      const unchanged =
        old &&
        JSON.stringify(old.projectIds) === JSON.stringify(input.projectIds);
      if (!unchanged)
        for (const id of input.projectIds) {
          const project = await tx.get(id);
          if (project.type !== "PROJECT" || project.deletedAt)
            throw new DomainError("VALIDATION_ERROR");
        }
      const now = this.clock.now();
      const category: ProjectCategory = {
        id: old?.id ?? this.ids.next(),
        workspaceId: context.workspaceId,
        name,
        projectIds: [...input.projectIds],
        version: input.version + 1,
        createdBy: old?.createdBy ?? context.principalId,
        updatedBy: context.principalId,
        createdAt: old?.createdAt ?? now,
        updatedAt: now,
        deletedAt: input.deleted ? (old?.deletedAt ?? now) : null,
      };
      await tx.saveCategory(category, input.version);
      await tx.appendCategoryChange({
        id: this.ids.next(),
        workspaceId: context.workspaceId,
        principalId: context.principalId,
        categoryId: category.id,
        version: category.version,
        occurredAt: now,
      });
      return category;
    });
  }
}
